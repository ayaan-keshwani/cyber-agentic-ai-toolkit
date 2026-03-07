"""Tools for reading and updating the business profile (shared across agents)."""

from typing import Any

from google.adk.tools import ToolContext

from src.storage.file_store import get_business_profile as load_profile, merge_business_profile


def _business_id(tool_context: ToolContext) -> str:
    state = tool_context.state or {}
    return (state.get("business_id") or "default").strip() or "default"


def get_business_profile(tool_context: ToolContext) -> dict[str, Any]:
    """
    Load the current business profile for this session.
    Use this at the start of a conversation to know the business type, email platform (GSuite/M365),
    and security posture. If the profile is incomplete, ask the user the onboarding questions
    and then call update_business_profile to save their answers.
    """
    business_id = _business_id(tool_context)
    return load_profile(business_id)


def update_business_profile(
    updates: dict[str, Any],
    tool_context: ToolContext,
) -> dict[str, Any]:
    """
    Update the business profile with new information (e.g. from onboarding answers).
    Pass a dictionary of fields to set, e.g. {"email_platform": "gsuite", "business_name": "Acme Inc"}.
    Only include fields the user has confirmed. Returns the updated profile.
    """
    if not updates:
        return get_business_profile(tool_context)
    business_id = _business_id(tool_context)
    return merge_business_profile(business_id, updates)
