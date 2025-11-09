# project/settings/__init__.py
import os

env = os.environ.get("DJANGO_ENV", "prod")

if env == "dev":
    from .dev import *
else:
    from .prod import *
