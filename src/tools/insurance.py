"""Tool for saving cyber insurance policy information from declarations page."""

from pathlib import Path

from google.adk.tools import ToolContext

from src.storage.file_store import merge_business_profile
from src.tools.profile import get_business_profile


def save_insurance_policy(text_content: str, tool_context: ToolContext) -> dict:
    """
    Save cyber insurance policy text (e.g. pasted from declarations page).
    Call this when the user pastes or provides the text of their policy declarations.
    The text is stored and used to check coverage when an incident occurs.
    """
    profile = get_business_profile(tool_context)
    business_id = (profile.get("business_id") or "default").strip() or "default"
    merge_business_profile(business_id, {"has_cyber_insurance": True, "policy_inclusions": text_content})
    return {"status": "saved", "message": "Policy information saved. We'll use this to check coverage when needed."}


def save_insurance_policy_from_file(file_path: str, tool_context: ToolContext) -> dict:
    """
    Read a file (PDF or .txt) containing the cyber insurance declarations page and save its contents.
    The user provides the path to the file on their computer (e.g. C:\\Users\\...\\declarations.pdf).
    Supports .pdf and .txt files.
    """
    path = Path(file_path).expanduser().resolve()
    if not path.exists():
        return {"status": "error", "message": f"File not found: {path}"}
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            return {"status": "error", "message": "PDF support requires pypdf. Install with: pip install pypdf"}
        try:
            reader = PdfReader(str(path))
            text_parts = []
            for page in reader.pages:
                text_parts.append(page.extract_text() or "")
            text_content = "\n".join(text_parts).strip()
        except Exception as e:
            return {"status": "error", "message": f"Could not read PDF: {e}"}
    elif path.suffix.lower() == ".txt":
        try:
            text_content = path.read_text(encoding="utf-8", errors="replace").strip()
        except Exception as e:
            return {"status": "error", "message": f"Could not read file: {e}"}
    else:
        return {"status": "error", "message": "Only .pdf and .txt files are supported."}
    if not text_content:
        return {"status": "error", "message": "No text could be extracted from the file."}
    profile = get_business_profile(tool_context)
    business_id = (profile.get("business_id") or "default").strip() or "default"
    merge_business_profile(business_id, {"has_cyber_insurance": True, "policy_inclusions": text_content})
    return {"status": "saved", "message": "Policy information saved. We'll use this to check coverage when needed."}
