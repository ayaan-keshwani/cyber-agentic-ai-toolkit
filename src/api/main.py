"""FastAPI app: REST + NDJSON chat stream + static SPA from frontend/dist."""

import io
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader

from src.app import DEFAULT_BUSINESS_ID, is_onboarding_complete, reset_all_memory, run_agent_stream
from src.config import PROJECT_ROOT, UPLOADS_DIR, ensure_dirs
from src.insurance_parse import parse_policy_inclusions_exclusions
from src.storage.file_store import get_business_profile, merge_business_profile

DIST_DIR = PROJECT_ROOT / "frontend" / "dist"


def _safe_business_id(business_id: str) -> str:
    safe = "".join(c for c in business_id if c.isalnum() or c in "-_")
    return safe or "default"


def _key_configured() -> bool:
    return bool(os.environ.get("GOOGLE_API_KEY", "").strip())


def _extract_text_from_upload(filename: str, data: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(data))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts).strip()
    if lower.endswith((".txt", ".text")):
        return data.decode("utf-8", errors="replace").strip()
    raise ValueError("Unsupported file type. Upload a PDF or plain text file.")


def _remove_insurance_upload_file(profile: dict[str, Any]) -> None:
    rel = (profile.get("insurance_declarations_relpath") or "").strip()
    if not rel:
        return
    path = (UPLOADS_DIR / rel).resolve()
    uploads_root = UPLOADS_DIR.resolve()
    if str(path).startswith(str(uploads_root)) and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def _insurance_cleared_fields() -> dict[str, Any]:
    return {
        "policy_inclusions": "",
        "policy_exclusions": "",
        "insurance_declarations_original_name": "",
        "insurance_declarations_relpath": "",
        "insurance_declarations_onboarding_done": False,
    }


def create_app() -> FastAPI:
    app = FastAPI(title="Cyber Agentic AI Toolkit")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"key_configured": _key_configured()}

    @app.get("/api/onboarding")
    def onboarding() -> dict[str, Any]:
        return {"complete": is_onboarding_complete(DEFAULT_BUSINESS_ID)}

    class ChatBody(BaseModel):
        agent: str = Field(..., pattern="^(email|incident)$")
        message: str = Field(..., min_length=1)
        thread_id: str | None = None

    @app.post("/api/chat/stream")
    async def chat_stream(body: ChatBody) -> StreamingResponse:
        async def gen():
            try:
                async for chunk in run_agent_stream(
                    body.agent,
                    DEFAULT_BUSINESS_ID,
                    body.message,
                    body.thread_id,
                ):
                    yield json.dumps({"chunk": chunk}) + "\n"
            except Exception as e:
                yield json.dumps({"error": str(e)}) + "\n"

        return StreamingResponse(gen(), media_type="application/x-ndjson")

    @app.get("/api/profile")
    def get_profile() -> dict[str, Any]:
        return get_business_profile(DEFAULT_BUSINESS_ID)

    class ProfilePut(BaseModel):
        user_name: str | None = None
        business_name: str | None = None
        business_type: str | None = None
        country: str | None = None
        email_platform: str | None = None
        it_support: str | None = None
        has_cyber_insurance: bool | None = None
        policy_inclusions: str | None = None
        policy_exclusions: str | None = None
        has_mfa_for_all_users: bool | None = None
        sends_sensitive_files_via_email_regularly: bool | None = None
        uses_file_sharing_solutions: list[str] | None = None

    @app.put("/api/profile")
    def put_profile(updates: ProfilePut) -> dict[str, Any]:
        payload = {k: v for k, v in updates.model_dump().items() if v is not None}
        if payload.get("has_cyber_insurance") is False:
            ensure_dirs()
            prev = get_business_profile(DEFAULT_BUSINESS_ID)
            _remove_insurance_upload_file(prev)
            for k in (
                "policy_inclusions",
                "policy_exclusions",
                "insurance_declarations_original_name",
                "insurance_declarations_relpath",
                "insurance_declarations_onboarding_done",
            ):
                payload.pop(k, None)
            payload.update(_insurance_cleared_fields())
        return merge_business_profile(DEFAULT_BUSINESS_ID, payload)

    @app.post("/api/profile/insurance-declarations")
    async def upload_insurance(file: UploadFile = File(...)) -> dict[str, Any]:
        ensure_dirs()
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file.")
        name = file.filename or "declarations.pdf"
        try:
            text = _extract_text_from_upload(name, raw)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        inc, exc = parse_policy_inclusions_exclusions(text)
        bid = _safe_business_id(DEFAULT_BUSINESS_ID)
        ext = Path(name).suffix.lower() or ".pdf"
        if ext not in (".pdf", ".txt", ".text"):
            ext = ".pdf"
        stored = f"{uuid.uuid4().hex}{ext}"
        rel = f"{bid}/{stored}"
        dest_dir = UPLOADS_DIR / bid
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / stored
        dest_path.write_bytes(raw)
        return merge_business_profile(
            DEFAULT_BUSINESS_ID,
            {
                "has_cyber_insurance": True,
                "policy_inclusions": inc,
                "policy_exclusions": exc,
                "insurance_declarations_original_name": name,
                "insurance_declarations_relpath": rel,
                "insurance_declarations_onboarding_done": True,
            },
        )

    @app.delete("/api/profile/insurance-declarations")
    def delete_insurance() -> dict[str, Any]:
        ensure_dirs()
        profile = get_business_profile(DEFAULT_BUSINESS_ID)
        _remove_insurance_upload_file(profile)
        return merge_business_profile(DEFAULT_BUSINESS_ID, _insurance_cleared_fields())

    @app.get("/api/profile/insurance-declarations/file")
    def download_insurance_file() -> FileResponse:
        profile = get_business_profile(DEFAULT_BUSINESS_ID)
        rel = (profile.get("insurance_declarations_relpath") or "").strip()
        if not rel:
            raise HTTPException(status_code=404, detail="No file uploaded.")
        path = (UPLOADS_DIR / rel).resolve()
        uploads_root = UPLOADS_DIR.resolve()
        if not str(path).startswith(str(uploads_root)) or not path.is_file():
            raise HTTPException(status_code=404, detail="File not found.")
        orig = profile.get("insurance_declarations_original_name") or path.name
        return FileResponse(path, filename=str(orig), media_type="application/octet-stream")

    @app.post("/api/reset")
    def reset() -> dict[str, str]:
        reset_all_memory()
        return {"status": "ok"}

    if DIST_DIR.is_dir():
        app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")

    return app


app = create_app()
