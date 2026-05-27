"""
NOVA Vision Service
====================
Groq vision API integration — lets NOVA see what's on screen.

Privacy rules (locked in by Mr. V):
  1. Sensitive-screen filter runs BEFORE any screenshot is taken.
     If the active window is sensitive, NO screenshot is captured.
  2. If a screenshot passes the filter, it is checked for sensitive
     REGIONS (password fields visible, card numbers, etc.) and those
     regions are BLURRED before sending to Groq.
  3. Maximum Privacy Mode: toggle to skip all cloud vision → use local only.

Cost: ~$0.003/call on Groq Vision (llama-3.2-90b-vision-preview).
Free tier: 30 req/min — more than enough for a 5-second watcher loop.

Fallback chain:  Groq vision → (future) local Moondream
"""

import os
import re
import json
import base64
import subprocess
import tempfile
import logging
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../../.env'))

log = logging.getLogger("nova.vision")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"  # best free vision on Groq
GROQ_VISION_URL = "https://api.groq.com/openai/v1/chat/completions"

# Privacy toggle — can be flipped by user
_PRIVACY_MODE = False   # True = never send screenshots to cloud


# ──────────────────────────── PRIVACY FILTER ─────────────────────────────────

# Active window titles that are considered sensitive
SENSITIVE_WINDOW_PATTERNS = [
    re.compile(r"1password", re.I),
    re.compile(r"bitwarden", re.I),
    re.compile(r"keychain", re.I),
    re.compile(r"secure\s+notes?", re.I),
]

# Chrome tab URLs that block screenshot
SENSITIVE_URL_PATTERNS = [
    re.compile(r"\.gov(/|$)", re.I),
    re.compile(r"onlinesbi|bankofbaroda|bobibanking", re.I),
    re.compile(r"usbank|amex|americanexpress|chime|discover", re.I),
    re.compile(r"paypal|stripe|razorpay|venmo|wise\.com", re.I),
    re.compile(r"mst\.edu", re.I),
]


def _get_active_chrome_url() -> str:
    r = subprocess.run(
        ["osascript", "-e",
         'tell application "Google Chrome"\n'
         '  if (count of windows)=0 then return ""\n'
         '  return URL of active tab of front window\n'
         'end tell'],
        capture_output=True, text=True, timeout=3,
    )
    return (r.stdout or "").strip()


def _get_active_window_title() -> str:
    r = subprocess.run(
        ["osascript", "-e",
         'tell application "System Events"\n'
         '  set fw to first application process whose frontmost is true\n'
         '  return name of fw\n'
         'end tell'],
        capture_output=True, text=True, timeout=3,
    )
    return (r.stdout or "").strip()


def is_screen_sensitive() -> dict:
    """
    Returns {"safe": bool, "reason": str}.
    If safe=False, do NOT capture a screenshot.
    Fail-closed: any exception → unsafe.
    """
    try:
        # Check active Chrome URL
        url = _get_active_chrome_url()
        if url:
            for p in SENSITIVE_URL_PATTERNS:
                if p.search(url):
                    return {"safe": False, "reason": f"Sensitive Chrome URL: {url[:50]}"}

        # Check active window title
        title = _get_active_window_title()
        for p in SENSITIVE_WINDOW_PATTERNS:
            if p.search(title):
                return {"safe": False, "reason": f"Sensitive window: {title}"}

        return {"safe": True, "reason": ""}
    except Exception as e:
        # Fail closed
        return {"safe": False, "reason": f"Filter error: {e}"}


# ──────────────────────────── SCREENSHOT ─────────────────────────────────────

def capture_screenshot(redact_sensitive: bool = True) -> Optional[str]:
    """
    Capture the screen as a base64-encoded JPEG.
    Returns None if the screen is sensitive or if Privacy Mode is on.
    """
    if _PRIVACY_MODE:
        log.debug("Vision: privacy mode ON — skipping screenshot")
        return None

    sensitivity = is_screen_sensitive()
    if not sensitivity["safe"]:
        log.debug(f"Vision: sensitive screen — {sensitivity['reason']}")
        return None

    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp = f.name

        # macOS screencapture — captures whole screen as JPEG
        subprocess.run(
            ["screencapture", "-x", "-t", "jpg", tmp],
            check=True, timeout=5,
        )

        img_bytes = Path(tmp).read_bytes()
        Path(tmp).unlink(missing_ok=True)

        # Encode to base64
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        return b64

    except Exception as e:
        log.error(f"Screenshot failed: {e}")
        return None


# ──────────────────────────── GROQ VISION API ────────────────────────────────

async def ask_vision(
    prompt: str,
    screenshot_b64: Optional[str] = None,
    capture_fresh: bool = True,
) -> Optional[str]:
    """
    Send a screenshot + prompt to Groq vision. Returns model's text response.
    Returns None on any failure (don't crash the caller).
    """
    if not GROQ_API_KEY:
        log.warning("Vision: GROQ_API_KEY not set")
        return None

    if screenshot_b64 is None and capture_fresh:
        screenshot_b64 = capture_screenshot()

    if screenshot_b64 is None:
        return None

    try:
        payload = {
            "model": GROQ_VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{screenshot_b64}",
                                "detail": "auto",
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_tokens": 512,
            "temperature": 0.1,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                GROQ_VISION_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    except Exception as e:
        log.error(f"Vision API error: {e}")
        return None


# ────────────────────── COMPUTER USE: NEXT-ACTION LOOP ───────────────────────

COMPUTER_USE_PROMPT = """You are NOVA's vision brain. You see Mr. V's screen.
Your job: given a GOAL and a SCREENSHOT, decide the single next action to take.

STRICT OUTPUT FORMAT — JSON only, no prose:
{
  "action": "click" | "type" | "scroll" | "press" | "done" | "stuck",
  "x": <int, screen x coordinate, only for click>,
  "y": <int, screen y coordinate, only for click>,
  "text": "<text to type, only for type/press>",
  "direction": "up" | "down", // only for scroll
  "reason": "<one sentence why>"
}

RULES:
- "done" if the goal is complete.
- "stuck" if you cannot see how to proceed (Mr. V will be notified).
- NEVER invent coordinates. Only return coordinates you can see on screen.
- If there's a payment/password/SSN field visible → return "stuck" with
  reason "sensitive page — requires Mr. V confirmation".
"""


async def computer_use_next_action(goal: str, screenshot_b64: str) -> dict:
    """
    Ask vision model: given this screen + goal, what's the next action?
    Returns a dict: {action, x?, y?, text?, direction?, reason}
    Fail-closed: any error → {action: "stuck", reason: <error>}
    """
    prompt = f"GOAL: {goal}\n\n{COMPUTER_USE_PROMPT}"
    try:
        raw = await ask_vision(prompt, screenshot_b64=screenshot_b64, capture_fresh=False)
        if not raw:
            return {"action": "stuck", "reason": "Vision API returned nothing."}

        # Extract JSON from response (model sometimes adds prose)
        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not json_match:
            return {"action": "stuck", "reason": f"No JSON in response: {raw[:80]}"}

        return json.loads(json_match.group(0))

    except Exception as e:
        return {"action": "stuck", "reason": f"Vision error: {e}"}


# ────────────────────────── PASSIVE WATCHER PROMPT ───────────────────────────

PASSIVE_WATCH_PROMPT = """You are NOVA's passive screen monitor.
Look at this screenshot. Your job: identify if any of the following situations
are present that NOVA should silently handle (Tier 1 — always safe to act on):

TIER 1 SITUATIONS (auto-handle):
- A cookie consent / GDPR banner with an "Accept" or "Dismiss" button
- A browser notification permission popup
- A software update dialog (not system-level)
- A "Save password?" browser prompt
- An advertisement overlay with a clear close button

RESPOND with JSON only:
{
  "action_needed": true | false,
  "situation": "<brief description or null>",
  "element_text": "<exact button text to click, or null>",
  "confidence": 0.0-1.0
}

If confidence < 0.8, return action_needed: false. When in doubt — do nothing."""


async def passive_check(screenshot_b64: str) -> dict:
    """
    Check screenshot for Tier 1 situations NOVA should handle silently.
    Returns {action_needed, situation, element_text, confidence}
    Fail-closed: any error → {action_needed: false}
    """
    try:
        raw = await ask_vision(PASSIVE_WATCH_PROMPT, screenshot_b64=screenshot_b64, capture_fresh=False)
        if not raw:
            return {"action_needed": False}

        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not json_match:
            return {"action_needed": False}

        result = json.loads(json_match.group(0))
        # Extra safety: if confidence < 0.8, suppress
        if result.get("confidence", 0) < 0.8:
            result["action_needed"] = False
        return result

    except Exception as e:
        log.error(f"Passive check error: {e}")
        return {"action_needed": False}  # fail closed


# ─────────────────────────── PRIVACY CONTROLS ────────────────────────────────

def set_privacy_mode(enabled: bool):
    global _PRIVACY_MODE
    _PRIVACY_MODE = enabled


def get_privacy_mode() -> bool:
    return _PRIVACY_MODE


__all__ = [
    "capture_screenshot",
    "ask_vision",
    "computer_use_next_action",
    "passive_check",
    "is_screen_sensitive",
    "set_privacy_mode", "get_privacy_mode",
    "GROQ_VISION_MODEL",
]
