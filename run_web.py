#!/usr/bin/env python3
"""
Run the FastAPI web UI: serves the built React app from frontend/dist and /api/* routes.

Environment (optional):
  WEB_HOST       bind address (default 127.0.0.1)
  WEB_PORT       port (default 8000)
  DEV_RELOAD     set to 1 to enable uvicorn reload (dev only)
  OPEN_BROWSER   set to 0 to skip opening the browser (default: open on start)

Requires: pip install -r requirements.txt, GOOGLE_API_KEY in .env, and npm run build in frontend/.
"""

from __future__ import annotations

import os
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def main() -> None:
    import uvicorn

    host = os.environ.get("WEB_HOST", "127.0.0.1")
    port = int(os.environ.get("WEB_PORT", "8000"))
    dist = ROOT / "frontend" / "dist"
    dev_reload = os.environ.get("DEV_RELOAD", "").strip() in ("1", "true", "yes")
    if not dist.is_dir() or not (dist / "index.html").is_file():
        dev_reload = True

    open_browser = os.environ.get("OPEN_BROWSER", "1").strip().lower()
    if open_browser not in ("0", "false", "no"):
        webbrowser.open(f"http://{host}:{port}/")

    uvicorn.run(
        "src.api.main:app",
        host=host,
        port=port,
        reload=dev_reload,
        reload_dirs=[str(ROOT / "src")] if dev_reload else None,
    )


if __name__ == "__main__":
    main()
