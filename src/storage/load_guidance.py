"""Load scenarios and checklists from YAML guidance files."""

import re
from pathlib import Path
from typing import Any

import yaml

from src.config import CHECKLISTS_DIR, SCENARIOS_DIR

# In-memory cache after first load
_scenarios_cache: list[dict[str, Any]] | None = None
_checklists_cache: list[dict[str, Any]] | None = None


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _collect_scenario_files() -> list[Path]:
    files: list[Path] = []
    if not SCENARIOS_DIR.exists():
        return files
    for item in SCENARIOS_DIR.iterdir():
        if item.is_file() and item.suffix in (".yaml", ".yml"):
            files.append(item)
        elif item.is_dir():
            files.extend(
                p for p in item.iterdir()
                if p.suffix in (".yaml", ".yml")
            )
    return sorted(files)


def _collect_checklist_files() -> list[Path]:
    if not CHECKLISTS_DIR.exists():
        return []
    return sorted(
        p for p in CHECKLISTS_DIR.iterdir()
        if p.suffix in (".yaml", ".yml")
    )


def _normalize_id(raw: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", raw.lower()).strip("_")


def get_all_scenarios() -> list[dict[str, Any]]:
    """Load and cache all scenario definitions from guidance YAML."""
    global _scenarios_cache
    if _scenarios_cache is not None:
        return _scenarios_cache
    scenarios: list[dict[str, Any]] = []
    for path in _collect_scenario_files():
        data = _load_yaml(path)
        if isinstance(data, dict) and data.get("id"):
            scenarios.append(data)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("id"):
                    scenarios.append(item)
    _scenarios_cache = scenarios
    return scenarios


def get_scenario_by_id(scenario_id: str) -> dict[str, Any] | None:
    """Return a single scenario by id, or None."""
    for s in get_all_scenarios():
        if s.get("id") == scenario_id:
            return s
    return None


def search_scenarios(
    query: str,
    category: str | None = None,
    business_profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Return scenarios that match the query and optional filters.
    Matching is by trigger_signals (keywords) and category/applies_to.
    """
    scenarios = get_all_scenarios()
    query_lower = (query or "").lower()
    results: list[dict[str, Any]] = []
    profile_stack = set()
    if business_profile:
        stack = business_profile.get("email_platform") or business_profile.get("email_platforms")
        if isinstance(stack, str) and (stack or "").strip():
            profile_stack.add((stack or "").strip().lower())
        elif isinstance(stack, list):
            profile_stack.update((str(s).strip().lower() for s in stack if s))
        profile_stack.add("us-based")
    known_platforms = profile_stack - {"us-based"}
    for s in scenarios:
        if category and s.get("category") != category:
            continue
        applies_to = [str(a).lower() for a in (s.get("applies_to") or [])]
        if applies_to:
            if "us-based" in applies_to:
                pass
            elif known_platforms and not (known_platforms & set(applies_to)):
                continue
        signals = s.get("trigger_signals") or []
        if not query_lower and not signals and s.get("id") == "fallback_no_specific_playbook":
            results.append(s)
            continue
        if not query_lower:
            continue
        for sig in signals:
            if sig.lower() in query_lower or query_lower in sig.lower():
                results.append(s)
                break
    if not results and query_lower:
        fallback = get_scenario_by_id("fallback_no_specific_playbook")
        if fallback:
            results.append(fallback)
    return results


def get_all_checklists() -> list[dict[str, Any]]:
    """Load and cache all checklist definitions from guidance YAML."""
    global _checklists_cache
    if _checklists_cache is not None:
        return _checklists_cache
    checklists: list[dict[str, Any]] = []
    for path in _collect_checklist_files():
        data = _load_yaml(path)
        if isinstance(data, dict) and data.get("id"):
            checklists.append(data)
    _checklists_cache = checklists
    return checklists


def get_checklist_by_id(checklist_id: str) -> dict[str, Any] | None:
    """Return a single checklist by id, or None."""
    for c in get_all_checklists():
        if c.get("id") == checklist_id:
            return c
    return None


def get_checklist_for_topic_and_stack(
    topic: str,
    stack: str,
) -> dict[str, Any] | None:
    """Return the best-matching checklist for topic (e.g. email_account_hardening) and stack (gsuite or m365)."""
    stack_lower = (stack or "").lower()
    for c in get_all_checklists():
        if (c.get("topic") or "").lower() != (topic or "").lower():
            continue
        applies = (c.get("applies_to") or "").lower()
        if applies == stack_lower:
            return c
    for c in get_all_checklists():
        if (c.get("topic") or "").lower() == (topic or "").lower():
            return c
    return None
