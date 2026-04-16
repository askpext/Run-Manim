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
const dockerDesktopCandidates = [
  "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
  "C:\\Program Files\\Docker\\Docker\\frontend\\Docker Desktop.exe",
  "C:\\Program Files\\Docker\\Docker\\resources\\Docker Desktop.exe",
];

const backendProcesses = [];
let mainWindow = null;
let shuttingDown = false;

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
      if (isError) {
        console.error(message);
      } else {
        console.log(message);
      }
    }
  });
}

function spawnStartupTarget(name, target) {
  const child = spawn("cmd.exe", ["/d", "/c", startupScript, target], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RUNWITH_DESKTOP: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
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

function startBackend() {
  spawnStartupTarget("heartbeat", "heartbeat");
  spawnStartupTarget("qcluster", "qcluster");
  spawnStartupTarget("django", "server");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
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
      resolve({ ok: false, code: null, stdout, stderr: error.message });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
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
  createWindow();
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
