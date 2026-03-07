"""Tools for searching and retrieving pre-approved scenario playbooks."""

from typing import Any

from google.adk.tools import ToolContext

from src.storage.load_guidance import search_scenarios as search_scenarios_impl, get_scenario_by_id as get_scenario_impl
from src.tools.profile import get_business_profile


def _business_id(tool_context: ToolContext) -> str:
    state = tool_context.state or {}
    return (state.get("business_id") or "default").strip() or "default"


def search_scenarios(
    query: str,
    category: str | None = None,
    tool_context: ToolContext = None,
) -> list[dict[str, Any]]:
    """
    Search for pre-approved scenarios (playbooks) that match the user's situation.
    Call this when the user describes a problem (e.g. unusual login, phishing, wire fraud, ransomware).
    - query: short description of what the user said (e.g. "unusual login from another country").
    - category: optional filter - "email_security" or "incident_response".
    Returns a list of matching scenarios; use get_scenario_by_id to fetch full steps for the best match.
    """
    if not tool_context:
        return []
    profile = get_business_profile(tool_context)
    return search_scenarios_impl(query=query, category=category, business_profile=profile)


def get_scenario_by_id(
    scenario_id: str,
    tool_context: ToolContext = None,
) -> dict[str, Any] | None:
    """
    Get a single scenario (playbook) by its id, including all steps.
    Use this after search_scenarios to get the full step-by-step guidance to present to the user.
    Only recommend actions that appear in these steps; do not invent new steps.
    """
    if not scenario_id:
        return None
    return get_scenario_impl(scenario_id)
