"""Tool for retrieving pre-approved checklists (e.g. email hardening)."""

from typing import Any

from google.adk.tools import ToolContext

from src.storage.load_guidance import get_checklist_for_topic_and_stack
from src.tools.profile import get_business_profile


def get_checklist(
    topic: str,
    stack: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any] | None:
    """
    Get a pre-approved checklist for ongoing hygiene (e.g. email account hardening).
    - topic: e.g. "email_account_hardening".
    - stack: "gsuite" or "m365" (if not provided, uses the business profile's email_platform).
    The checklist may include transition_after_q6 (no insurance or skipping upload),
    transition_after_insurance_upload (after declarations upload), and strong_password_reset_only
    (short password-change steps after phishing—no long intro). Use the one that matches the flow.
    Use the checklist items to walk the user through best practices. Do not add steps not in the checklist.
    """
    if not tool_context:
        return None
    profile = get_business_profile(tool_context)
    if not stack:
        stack = (profile.get("email_platform") or "gsuite").strip() or "gsuite"
    return get_checklist_for_topic_and_stack(topic=topic, stack=stack)
