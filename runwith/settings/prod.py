from .base import *

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = False

ALLOWED_HOSTS = ['runwith.cloud', 'www.runwith.cloud', 'manim.runwith.cloud']


# CSRF and Cookie Security Settings
CSRF_TRUSTED_ORIGINS = ["https://runwith.cloud", "https://www.runwith.cloud", "https://manim.runwith.cloud"]
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SECURE = True

    #so that login in any app ensures login in all apps
SESSION_COOKIE_DOMAIN = ".runwith.cloud"
CSRF_COOKIE_DOMAIN = ".runwith.cloud"