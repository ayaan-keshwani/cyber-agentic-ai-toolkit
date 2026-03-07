"""Tools for tracking playbook progress so the agent can work through steps across turns."""

from typing import Any

from google.adk.tools import ToolContext


def _state_dict(tool_context: ToolContext) -> dict[str, Any]:
    """Read state as a dict. ADK State has to_dict(); avoid dict(state) which can raise."""
    s = tool_context.state
    if s is None:
        return {}
    if hasattr(s, "to_dict"):
        return s.to_dict()
    return {}


def get_playbook_state(tool_context: ToolContext) -> dict[str, Any]:
    """
    Get the current playbook state for this session: which scenario is active and which step index.
    - active_scenario_id: id of the scenario being followed (e.g. email_phishing_suspected).
    - current_step_index: 0-based index of the current step to present.
    - scenario_steps_count: total number of steps (for "Step X of Y").
    If no playbook is active, returns empty or default state. Use this to know where to continue
    when the user returns or answers a question, so you can eventually work through the full list of steps.
    """
    state = _state_dict(tool_context)
    scenario_id = state.get("active_scenario_id")
    step_index = state.get("current_step_index") or 0
    steps_count = state.get("scenario_steps_count") or 0
    return {
        "active_scenario_id": scenario_id,
        "current_step_index": step_index,
        "scenario_steps_count": steps_count,
        "has_next_step": steps_count > 0 and step_index < steps_count,
    }


def advance_playbook_step(tool_context: ToolContext) -> dict[str, Any]:
    """
    Mark the current playbook step as done and advance to the next.
    Call this after the user has acknowledged or completed the current step, so the next turn
    can present the following step. Updates session state; returns the new playbook state.
    """
    state = _state_dict(tool_context)
    step_index = int(state.get("current_step_index") or 0)
    steps_count = int(state.get("scenario_steps_count") or 0)
    next_index = min(step_index + 1, max(0, steps_count))
    tool_context.state["current_step_index"] = next_index
    return get_playbook_state(tool_context)


def set_active_playbook(
    tool_context: ToolContext,
    scenario_id: str,
    steps_count: int,
) -> None:
    """
    Set the active playbook (scenario) and reset to step 0.
    Call this when you have identified that the user's situation matches a scenario and you
    are starting to guide them through it. Steps_count should be the length of the scenario's steps list.
    """
    if tool_context.state is None:
        return
    tool_context.state["active_scenario_id"] = scenario_id
    tool_context.state["current_step_index"] = 0
    tool_context.state["scenario_steps_count"] = steps_count


def start_playbook(
    scenario_id: str,
    steps_count: int,
    tool_context: ToolContext,
) -> dict[str, Any]:
    """
    Start guiding the user through a playbook. Call this when you have identified that their
    situation matches a scenario (from search_scenarios/get_scenario_by_id). Sets the active
    scenario and step index to 0 so you can present the first step. steps_count must be the
    number of steps in that scenario (length of the scenario's "steps" list).
    Returns the new playbook state.
    """
    set_active_playbook(tool_context, scenario_id, steps_count)
    return get_playbook_state(tool_context)
