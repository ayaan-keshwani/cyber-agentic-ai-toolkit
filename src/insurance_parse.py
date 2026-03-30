"""Use Gemini to extract policy inclusions and exclusions as literal bullet lists from declarations text."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


def _format_bullet_lines(items: list[str]) -> str:
    lines = [ln.strip() for ln in items if ln and ln.strip()]
    return "\n".join(f"- {ln}" for ln in lines)


def _heuristic_split(full: str) -> tuple[str, str]:
    if not full.strip():
        return "", ""
    m = re.search(r"\b(exclusions?|not covered|what is not covered)\b", full, re.I)
    if m and m.start() > 80:
        inc_raw, exc_raw = full[: m.start()].strip(), full[m.start() :].strip()
    else:
        inc_raw, exc_raw = full.strip(), ""
    # Turn line-ish chunks into bullets
    def to_bullets(block: str) -> str:
        parts = [p.strip() for p in re.split(r"[\n;]+", block) if p.strip()]
        if len(parts) <= 1 and block.strip():
            return _format_bullet_lines([block.strip()])
        return _format_bullet_lines(parts[:40])

    return to_bullets(inc_raw), to_bullets(exc_raw) if exc_raw else ""


def parse_policy_inclusions_exclusions(raw_text: str) -> tuple[str, str]:
    """
    Returns (inclusions, exclusions) as newline-separated bullet lines for storage and profile display.
    Each line starts with "- " and uses wording drawn from the document, not marketing-style summaries.
    """
    text = (raw_text or "").strip()
    if not text:
        return "", ""

    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not key:
        return _heuristic_split(text)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "inclusions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of covered items or coverages, phrased as short literal lines taken from the document (no essay-style summary).",
            },
            "exclusions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of exclusions or not-covered items, literal lines from the document.",
            },
        },
        "required": ["inclusions", "exclusions"],
    }

    try:
        client = genai.Client(api_key=key)
        prompt = (
            "Read this cyber insurance declarations or policy excerpt. "
            "Extract TWO lists of short bullet lines.\n"
            "- inclusions: each string is one coverage or included item, using wording as close as possible to the document (trim wording slightly only if needed for clarity). Do NOT write a narrative summary. "
            "Put monetary coverages first in the inclusions list: limits, dollar amounts, sub-limits, and financial loss coverages before other items.\n"
            "- exclusions: each string is one exclusion or limitation, same style.\n"
            "If a section is missing, return an empty array for that list."
        )
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt, "\n\n--- DOCUMENT ---\n\n", text[:120000]],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
                response_json_schema=schema,
            ),
        )
        out = (response.text or "").strip()
        data = json.loads(out)
        inc_list = data.get("inclusions") or []
        exc_list = data.get("exclusions") or []
        if not isinstance(inc_list, list):
            inc_list = []
        if not isinstance(exc_list, list):
            exc_list = []
        inc = _format_bullet_lines([str(x).strip() for x in inc_list if str(x).strip()])
        exc = _format_bullet_lines([str(x).strip() for x in exc_list if str(x).strip()])
        if inc or exc:
            return inc, exc
    except Exception as e:
        logger.warning("Gemini policy parse failed, using heuristic split: %s", e)

    return _heuristic_split(text)
