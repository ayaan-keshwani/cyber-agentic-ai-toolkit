"""Configuration and paths for the cybersecurity agent toolkit."""

import os
from pathlib import Path

# Project root (parent of src/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Data directories
DATA_DIR = PROJECT_ROOT / "data"
GUIDANCE_DIR = DATA_DIR / "guidance"
SCENARIOS_DIR = GUIDANCE_DIR / "scenarios"
CHECKLISTS_DIR = GUIDANCE_DIR / "checklists"
BUSINESS_PROFILES_DIR = DATA_DIR / "business_profiles"
UPLOADS_DIR = DATA_DIR / "uploads"  # for insurance documents etc.

# Session DB: local SQLite file (no external database)
_db_path = (DATA_DIR / "sessions.db").resolve()
SESSION_DB_URL = os.environ.get(
    "SESSION_DB_URL",
    f"sqlite+aiosqlite:///{_db_path.as_posix()}",
)

# App name used for ADK sessions (shared across both agents)
APP_NAME = "cyber_hygiene_toolkit"


def ensure_dirs() -> None:
    """Create data directories if they do not exist."""
    BUSINESS_PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GUIDANCE_DIR.mkdir(parents=True, exist_ok=True)
    SCENARIOS_DIR.mkdir(parents=True, exist_ok=True)
    CHECKLISTS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
