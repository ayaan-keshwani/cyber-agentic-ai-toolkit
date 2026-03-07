"""Email Account Protection agent: GSuite/M365 best practices and suspicious-activity playbooks."""

from pathlib import Path

from google.adk.agents import LlmAgent

from src.tools import (
    get_business_profile,
    update_business_profile,
    search_scenarios,
    get_scenario_by_id,
    get_checklist,
    get_playbook_state,
    advance_playbook_step,
    start_playbook,
    save_insurance_policy,
    save_insurance_policy_from_file,
)

_INSTRUCTION_PATH = Path(__file__).resolve().parent.parent / "prompts" / "email_instruction.txt"


def _load_instruction() -> str:
    if _INSTRUCTION_PATH.exists():
        return _INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    return (
        "You are an Email Account Protection assistant for small and medium business owners. "
        "Use the provided tools to get pre-approved guidance only. Do not invent security steps."
    )


def create_email_protection_agent() -> LlmAgent:
    """Create the Email Account Protection LlmAgent with shared tools."""
    return LlmAgent(
        model="gemini-2.5-flash",
        name="email_protection_agent",
        instruction=_load_instruction(),
        tools=[
            get_business_profile,
            update_business_profile,
            search_scenarios,
            get_scenario_by_id,
            get_checklist,
            get_playbook_state,
            advance_playbook_step,
            start_playbook,
            save_insurance_policy,
            save_insurance_policy_from_file,
        ],
    )
