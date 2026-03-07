"""
Main application: session service, runners, and run loop.
Uses persistent session state (SQLite) and shared business_id so both agents
retain context and can share knowledge via the business profile.
"""

import asyncio
import logging
import warnings
from typing import AsyncIterator

# Suppress genai "non-text parts" warning when model returns function_call + text
warnings.filterwarnings("ignore", message=".*non-text parts in the response.*")
logging.getLogger("google_genai.types").setLevel(logging.ERROR)

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.config import (
    APP_NAME,
    DATA_DIR,
    ensure_dirs,
    SESSION_DB_URL,
    BUSINESS_PROFILES_DIR,
)
from src.agents import create_email_protection_agent, create_incident_support_agent

logger = logging.getLogger(__name__)

# Lazy-initialized session service and runners
_session_service = None
_email_runner = None
_incident_runner = None


def _get_session_service():
    """Create or return the shared session service (SQLite-backed when possible)."""
    global _session_service
    if _session_service is not None:
        return _session_service
    ensure_dirs()
    try:
        from google.adk.sessions import DatabaseSessionService
        _session_service = DatabaseSessionService(db_url=SESSION_DB_URL)
        logger.info("Using DatabaseSessionService (SQLite) for persistent sessions.")
    except Exception as e:
        logger.warning("DatabaseSessionService unavailable (%s), using in-memory sessions.", e)
        _session_service = InMemorySessionService()
    return _session_service


def get_email_runner() -> Runner:
    """Return the Runner for the Email Protection agent."""
    global _email_runner
    if _email_runner is None:
        agent = create_email_protection_agent()
        _email_runner = Runner(
            agent=agent,
            app_name=APP_NAME,
            session_service=_get_session_service(),
        )
    return _email_runner


def get_incident_runner() -> Runner:
    """Return the Runner for the Incident Support agent."""
    global _incident_runner
    if _incident_runner is None:
        agent = create_incident_support_agent()
        _incident_runner = Runner(
            agent=agent,
            app_name=APP_NAME,
            session_service=_get_session_service(),
        )
    return _incident_runner


def _user_id_for_business(business_id: str) -> str:
    """Use business_id as the ADK user_id so sessions are keyed by business."""
    return (business_id or "default").strip() or "default"


def _session_id_for_thread(business_id: str, agent_type: str, thread_id: str | None = None) -> str:
    """One session per (business, agent, thread). Default thread_id = 'main'."""
    uid = _user_id_for_business(business_id)
    tid = (thread_id or "main").strip() or "main"
    return f"{uid}_{agent_type}_{tid}"


async def ensure_session(
    runner: Runner,
    business_id: str,
    agent_type: str,
    thread_id: str | None = None,
) -> tuple[str, str]:
    """
    Get or create a session for this business and agent. Initial state includes business_id
    so tools can load the shared business profile. Returns (user_id, session_id).
    """
    user_id = _user_id_for_business(business_id)
    session_id = _session_id_for_thread(business_id, agent_type, thread_id)
    session = await runner.session_service.get_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    if session is None:
        await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={"business_id": business_id},
        )
    return user_id, session_id


async def run_agent(
    agent_type: str,
    business_id: str,
    user_message: str,
    thread_id: str | None = None,
) -> str:
    """
    Run one turn of the specified agent (email or incident) and return the final text response.
    """
    if agent_type == "email":
        runner = get_email_runner()
    elif agent_type == "incident":
        runner = get_incident_runner()
    else:
        raise ValueError("agent_type must be 'email' or 'incident'")

    user_id, session_id = await ensure_session(runner, business_id, agent_type, thread_id)
    content = types.Content(role="user", parts=[types.Part(text=user_message)])
    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    ):
        if not event.is_final_response() or not event.content or not event.content.parts:
            continue
        has_function_call = any(
            getattr(p, "function_call", None) for p in event.content.parts
        )
        if has_function_call:
            continue
        for part in event.content.parts:
            if hasattr(part, "text") and part.text:
                final_text += part.text
    return final_text.strip() or "(No response generated)"


async def run_agent_stream(
    agent_type: str,
    business_id: str,
    user_message: str,
    thread_id: str | None = None,
) -> AsyncIterator[str]:
    """
    Run one turn and stream response text chunks (e.g. for a UI).
    Yields incremental text; after the iterator is exhausted, the full response is complete.
    """
    if agent_type == "email":
        runner = get_email_runner()
    elif agent_type == "incident":
        runner = get_incident_runner()
    else:
        raise ValueError("agent_type must be 'email' or 'incident'")

    user_id, session_id = await ensure_session(runner, business_id, agent_type, thread_id)
    content = types.Content(role="user", parts=[types.Part(text=user_message)])
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    yield part.text


# Single business; no prompt for business ID
DEFAULT_BUSINESS_ID = "default"


def reset_all_memory() -> None:
    """
    Clear all persisted data so the next run is like a brand-new user.
    - Deletes the business profile (default).
    - Deletes the session database (all conversation history and state).
    """
    ensure_dirs()
    removed = []
    profile_path = BUSINESS_PROFILES_DIR / "default.json"
    if profile_path.exists():
        profile_path.unlink()
        removed.append(str(profile_path))
    sessions_path = DATA_DIR / "sessions.db"
    if sessions_path.exists():
        sessions_path.unlink()
        removed.append(str(sessions_path))
    if removed:
        logger.info("Reset complete. Removed: %s", ", ".join(removed))
        print("Removed:", ", ".join(removed))
    else:
        logger.info("Reset complete. No stored data was found to remove.")
        print("No stored data was found to remove.")


def _is_onboarding_complete(business_id: str) -> bool:
    """True if the business has completed onboarding (profile has email_platform and onboarding_complete)."""
    from src.storage.file_store import get_business_profile
    profile = get_business_profile(business_id)
    return bool(profile.get("onboarding_complete")) and bool(
        (profile.get("email_platform") or "").strip()
    )


def _welcome_back_message(agent_type: str | None, business_id: str) -> str:
    """Greeting for returning users, shown before picking an agent. Uses name from profile if set."""
    from src.storage.file_store import get_business_profile
    profile = get_business_profile(business_id)
    name = (profile.get("user_name") or "").strip()
    if name:
        greeting = f"Welcome back, {name}!"
    else:
        greeting = "Welcome back!"
    greeting += " What do you need help with today?"
    return greeting


async def main_cli() -> None:
    """CLI: first-time users get onboarding before agent choice; returning users choose agent."""
    ensure_dirs()
    business_id = DEFAULT_BUSINESS_ID

    if not _is_onboarding_complete(business_id):
        print("Agent: ", end="", flush=True)
        response = await run_agent(
            "email",
            business_id,
            "I'm new. Please welcome me and get started with your setup questions.",
        )
        print(f"{response}\n")
        agent_type = "email"
    else:
        print(f"Agent: {_welcome_back_message(None, business_id)}\n")
        print("Agent: 1 = Email Protection, 2 = Incident Support")
        choice = input("Choose (1 or 2): ").strip()
        agent_type = "incident" if choice == "2" else "email"
        print()
    print("(Type 'quit' or 'exit' anytime to end the conversation.)\n")

    while True:
        try:
            msg = input("You: ").strip()
            if not msg:
                continue
            if msg.lower() in ("quit", "exit", "q"):
                print("Goodbye!")
                break
            response = await run_agent(agent_type, business_id, msg)
            print(f"Agent: {response}\n")
        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            logger.exception("Error in agent turn")
            print(f"Error: {e}\n")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main_cli())
