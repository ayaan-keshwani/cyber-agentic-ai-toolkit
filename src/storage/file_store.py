"""File-based storage for business profiles (no external database)."""

import json
from pathlib import Path
from typing import Any

from src.config import BUSINESS_PROFILES_DIR

# Default profile schema; all keys optional for gradual onboarding
DEFAULT_PROFILE: dict[str, Any] = {
    "business_id": "",
    "user_name": "",  # what to call the user (e.g. first name)
    "business_name": "",
    "business_type": "",
    "country": "US",
    "state": "",
    "email_platform": "",  # gsuite | m365 | other
    "it_support": "",  # in-house | outsourced | none
    "has_cyber_insurance": None,  # True | False
    "policy_inclusions": "",  # raw text from declarations page; used to check coverage
    "has_mfa_for_admins": None,
    "has_mfa_for_all_users": None,
    "regular_security_training": None,
    "sends_sensitive_files_via_email_regularly": None,
    "uses_file_sharing_solutions": [],  # e.g. ["drive", "sharepoint"]
    "onboarding_complete": False,
    "notes": [],
}


def _profile_path(business_id: str) -> Path:
    if not business_id or not business_id.strip():
        raise ValueError("business_id is required")
    safe_id = "".join(c for c in business_id if c.isalnum() or c in "-_")
    if not safe_id:
        safe_id = "default"
    BUSINESS_PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    return BUSINESS_PROFILES_DIR / f"{safe_id}.json"


def get_business_profile(business_id: str) -> dict[str, Any]:
    """Load business profile from JSON file. Returns default profile if missing."""
    path = _profile_path(business_id)
    if not path.exists():
        profile = dict(DEFAULT_PROFILE)
        profile["business_id"] = business_id
        return profile
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for key, default in DEFAULT_PROFILE.items():
        if key not in data:
            data[key] = default
    data["business_id"] = business_id
    return data


def save_business_profile(business_id: str, profile: dict[str, Any]) -> None:
    """Save business profile to JSON file."""
    path = _profile_path(business_id)
    profile = {k: v for k, v in profile.items() if k in DEFAULT_PROFILE or k == "business_id"}
    profile["business_id"] = business_id
    with open(path, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)


def merge_business_profile(business_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Merge updates into existing profile and save. Returns updated profile."""
    profile = get_business_profile(business_id)
    for k, v in updates.items():
        if k in DEFAULT_PROFILE or k == "business_id":
            profile[k] = v
    save_business_profile(business_id, profile)
    return profile
