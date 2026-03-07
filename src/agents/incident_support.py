"""Incident Support agent: wire fraud, ransomware, and other incident next steps."""

from pathlib import Path

from google.adk.agents import LlmAgent

from src.tools import (
    get_business_profile,
    update_business_profile,
    search_scenarios,
    get_scenario_by_id,
    get_playbook_state,
    advance_playbook_step,
    start_playbook,
)

_INSTRUCTION_PATH = Path(__file__).resolve().parent.parent / "prompts" / "incident_instruction.txt"


def _load_instruction() -> str:
    if _INSTRUCTION_PATH.exists():
        return _INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    return (
        "You are an Incident Support assistant for small and medium business owners. "
        "Use the provided tools to get pre-approved steps only. Direct users to insurers and authorities."
    )


def create_incident_support_agent() -> LlmAgent:
    """Create the Incident Support LlmAgent with shared tools (no checklist tool)."""
    return LlmAgent(
        model="gemini-2.5-flash",
        name="incident_support_agent",
        instruction=_load_instruction(),
        tools=[
            get_business_profile,
            update_business_profile,
            search_scenarios,
            get_scenario_by_id,
            get_playbook_state,
            advance_playbook_step,
            start_playbook,
        ],
    )
