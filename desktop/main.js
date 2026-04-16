const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectRoot = app.isPackaged
  ? path.join(process.resourcesPath, "runwith")
  : path.resolve(__dirname, "..");
const startupScript = path.join(projectRoot, "runwith-start.bat");
const appUrl = "http://127.0.0.1:8000/manim/";
const appIcon = path.join(__dirname, "build", "icon.ico");
const startupLogPath = () => path.join(app.getPath("userData"), "startup.log");
const dockerDesktopCandidates = [
  "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
  "C:\\Program Files\\Docker\\Docker\\frontend\\Docker Desktop.exe",
  "C:\\Program Files\\Docker\\Docker\\resources\\Docker Desktop.exe",
];

const backendProcesses = [];
let mainWindow = null;
let shuttingDown = false;

function writeStartupLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;

  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(startupLogPath(), line, "utf8");
  } catch {
    // File logging is best-effort; console logging still carries the message in dev.
  }
}

function createLoadingHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>RunWith</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }

      body {
        align-items: center;
        background: #111827;
        color: #f9fafb;
        display: flex;
        height: 100vh;
        justify-content: center;
        margin: 0;
      }

      main {
        max-width: 520px;
        padding: 32px;
        text-align: center;
      }

      h1 {
        font-size: 28px;
        font-weight: 650;
        margin: 0 0 12px;
      }

      p {
        color: #cbd5e1;
        font-size: 15px;
        line-height: 1.5;
        margin: 0;
      }

      .spinner {
        animation: spin 0.9s linear infinite;
        border: 3px solid rgba(249, 250, 251, 0.24);
        border-radius: 50%;
        border-top-color: #38bdf8;
        height: 42px;
        margin: 0 auto 24px;
        width: 42px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <h1>Starting RunWith</h1>
      <p id="startup-status">Preparing the local renderer...</p>
    </main>
  </body>
</html>`;
}

function updateLoadingStatus(message) {
  console.log(message);
  writeStartupLog(message);

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents
    .executeJavaScript(
      `document.getElementById("startup-status").textContent = ${JSON.stringify(message)};`,
    )
    .catch(() => {});
}

function logProcessOutput(name, stream, isError = false) {
  stream.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      const message = `[${name}] ${line}`;
      writeStartupLog(message);
      if (isError) {
        console.error(message);
      } else {
        console.log(message);
      }
    }
  });
}

function getBackendVenvDir() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "backend-env");
  }

  return path.join(projectRoot, "env");
}

function getBackendPythonPath() {
  return path.join(getBackendVenvDir(), "Scripts", "python.exe");
}

function getBackendEnv() {
  return {
    ...process.env,
    RUNWITH_DESKTOP: "1",
    RUNWITH_VENV_DIR: getBackendVenvDir(),
    DJANGO_SECRET_KEY: "devsecret123",
    DJANGO_ENV: "dev",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

function spawnStartupTarget(name, target) {
  const child = spawn("cmd.exe", ["/d", "/c", startupScript, target], {
    cwd: projectRoot,
    env: getBackendEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  backendProcesses.push({ name, child });
  logProcessOutput(name, child.stdout);
  logProcessOutput(name, child.stderr, true);

  child.on("exit", (code, signal) => {
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    const logger = shuttingDown || code === 0 ? console.log : console.error;
    logger(`[${name}] exited with ${detail}`);
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start:`, error);
  });

  return child;
}

async function runDjangoManagementCommand(args) {
  return runCommand(getBackendPythonPath(), ["manage.py", ...args], {
    cwd: projectRoot,
    env: getBackendEnv(),
  });
}

function commandLineForLog(command, args) {
  return [command, ...args].map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" ");
}

function startBackend() {
  spawnStartupTarget("heartbeat", "heartbeat");
  spawnStartupTarget("qcluster", "qcluster");
  spawnStartupTarget("django", "server");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    writeStartupLog(`Running command: ${commandLineForLog(command, args)}`);
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      writeStartupLog(`Command failed to start: ${commandLineForLog(command, args)} :: ${error.message}`);
      resolve({ ok: false, code: null, stdout, stderr: error.message });
    });

    child.on("close", (code) => {
      if (stdout.trim()) {
        writeStartupLog(stdout.trim());
      }
      if (stderr.trim()) {
        writeStartupLog(stderr.trim());
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function canImportDjango() {
  const pythonPath = getBackendPythonPath();

  if (!fs.existsSync(pythonPath)) {
    return false;
  }

  const result = await runCommand(pythonPath, ["-c", "import django; print(django.get_version())"]);
  return result.ok;
}

async function findPythonLauncher() {
  const candidates = [
    { command: "py.exe", args: ["-3"] },
    { command: "python.exe", args: [] },
  ];

  for (const candidate of candidates) {
    const result = await runCommand(candidate.command, [...candidate.args, "--version"]);
    if (result.ok) {
      return candidate;
    }
  }

  throw new Error("Python was not found. Install Python 3, then reopen RunWith.");
}

async function ensureBackendPythonEnvironment() {
  updateLoadingStatus("Checking local Python environment...");

  if (await canImportDjango()) {
    updateLoadingStatus("Python environment is ready.");
    return;
  }

  const venvDir = getBackendVenvDir();
  const requirementsPath = path.join(projectRoot, "requirements.txt");
  const python = await findPythonLauncher();

  updateLoadingStatus("Creating backend Python environment...");
  fs.rmSync(venvDir, { recursive: true, force: true });

  const createVenv = await runCommand(python.command, [...python.args, "-m", "venv", venvDir]);
  if (!createVenv.ok) {
    throw new Error(`Could not create backend Python environment: ${createVenv.stderr || createVenv.stdout}`);
  }

  updateLoadingStatus("Installing backend dependencies. This can take a few minutes on first launch...");
  const pipInstall = await runCommand(getBackendPythonPath(), [
    "-m",
    "pip",
    "install",
    "--upgrade",
    "pip",
  ]);

  if (!pipInstall.ok) {
    throw new Error(`Could not upgrade pip: ${pipInstall.stderr || pipInstall.stdout}`);
  }

  const installRequirements = await runCommand(getBackendPythonPath(), [
    "-m",
    "pip",
    "install",
    "-r",
    requirementsPath,
  ]);

  if (!installRequirements.ok) {
    throw new Error(`Could not install backend dependencies: ${installRequirements.stderr || installRequirements.stdout}`);
  }

  if (!(await canImportDjango())) {
    throw new Error("Backend Python environment was created, but Django is still unavailable.");
  }

  updateLoadingStatus("Python environment is ready.");
}

async function ensureDatabaseReady() {
  updateLoadingStatus("Preparing local database...");

  const result = await runDjangoManagementCommand(["migrate", "--noinput"]);
  if (!result.ok) {
    throw new Error(`Could not prepare the local database: ${result.stderr || result.stdout}`);
  }

  updateLoadingStatus("Local database is ready.");
}

async function isDockerReady() {
  const result = await runCommand("docker.exe", ["info", "--format", "{{.ServerVersion}}"]);

  if (result.ok) {
    console.log(`Docker is ready: ${result.stdout.trim()}`);
    return true;
  }

  const message = (result.stderr || result.stdout || "").trim();
  if (message) {
    console.log(`Docker is not ready yet: ${message}`);
  }

  return false;
}

function startDockerDesktop() {
  const dockerDesktopPath = dockerDesktopCandidates.find((candidate) => fs.existsSync(candidate));

  if (!dockerDesktopPath) {
    throw new Error("Docker Desktop.exe was not found. Install Docker Desktop or start Docker manually.");
  }

  updateLoadingStatus("Starting Docker Desktop...");
  const child = spawn(dockerDesktopPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

async function waitForDocker() {
  updateLoadingStatus("Checking Docker...");

  if (await isDockerReady()) {
    updateLoadingStatus("Docker is ready. Starting RunWith backend...");
    return;
  }

  startDockerDesktop();

  while (!shuttingDown) {
    await sleep(3000);

    if (await isDockerReady()) {
      updateLoadingStatus("Docker is ready. Starting RunWith backend...");
      return;
    }

    updateLoadingStatus("Waiting for Docker Desktop to finish starting...");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkServerReady() {
  return new Promise((resolve) => {
    let settled = false;

    function finish(value) {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    }

    const request = http.get(appUrl, (response) => {
      response.resume();
      finish(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.setTimeout(1000, () => {
      request.destroy();
      finish(false);
    });

    request.on("error", () => finish(false));
  });
}

async function waitForServer() {
  updateLoadingStatus("Starting Django server and worker...");
  console.log(`Waiting for Django at ${appUrl}`);

  while (!shuttingDown) {
    if (await checkServerReady()) {
      updateLoadingStatus("RunWith is ready. Opening the playground...");
      return;
    }

    await sleep(1000);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createLoadingHtml())}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killProcessTree(child) {
  return new Promise((resolve) => {
    if (!child.pid || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

async function shutdownBackend() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log("Stopping RunWith backend processes...");
  await Promise.all(backendProcesses.map(({ child }) => killProcessTree(child)));
}

async function boot() {
  writeStartupLog("Starting RunWith desktop app.");
  createWindow();
  await ensureBackendPythonEnvironment();
  await ensureDatabaseReady();
  await waitForDocker();
  startBackend();
  await waitForServer();

  if (mainWindow && !shuttingDown) {
    await mainWindow.loadURL(appUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  boot().catch((error) => {
    console.error("Failed to start RunWith desktop app:", error);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown) {
    return;
  }

  event.preventDefault();
  shutdownBackend().finally(() => app.exit(0));
});

process.on("SIGINT", () => {
  shutdownBackend().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdownBackend().finally(() => process.exit(0));
});
