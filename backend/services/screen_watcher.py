"""
NOVA Screen Watcher
====================
Background loop that watches the screen every N seconds.
When it finds a Tier-1 situation, it acts silently.
When it finds something requiring attention, it notifies Mr. V.

Privacy rules enforced:
  - is_screen_sensitive() runs BEFORE every screenshot
  - Sensitive screens → no screenshot, no API call, no action
  - Confidence < 0.8 → do nothing (fail conservative)

Cost: ~$0.003 per check × 12/min = ~$0.04/hour if running.
In practice: only calls vision when a non-YouTube, non-sensitive tab
is active — most checks are filtered before any API call.

NOTE: This runs as an asyncio background task started by the FastAPI
app on startup. It is NOT an Electron process.
"""

import asyncio
import logging
import subprocess
from datetime import datetime

log = logging.getLogger("nova.screen_watcher")

# How often to check (seconds). 5s = 12 API calls/min max.
WATCHER_INTERVAL_S = 5

# Whether the watcher loop is active
_running = False
_task: asyncio.Task = None

# Callback to notify the frontend (set by FastAPI startup)
_notify_cb = None


def set_notify_callback(cb):
    """Register a callback(event_type, data) for frontend notifications."""
    global _notify_cb
    _notify_cb = cb


def _notify(event_type: str, data: dict):
    if _notify_cb:
        try:
            _notify_cb(event_type, data)
        except Exception:
            pass


def _click_element_by_text(text: str) -> bool:
    """Click a Chrome element by visible text (reuses browser_action logic)."""
    try:
        from .browser_action import _chrome_js, _click_link_by_text_js
        r = _chrome_js(_click_link_by_text_js(text), timeout=4)
        return r.get("ok") and (r.get("output") or "").startswith("OK")
    except Exception:
        return False


async def _watcher_tick():
    """Single watcher iteration. Called every WATCHER_INTERVAL_S seconds."""
    try:
        from .vision_service import capture_screenshot, passive_check, is_screen_sensitive
        from .pattern_service import get_active_rules, is_frozen

        # Never act when frozen
        if is_frozen():
            return

        # Sensitive-screen check — fail closed
        sensitivity = is_screen_sensitive()
        if not sensitivity["safe"]:
            return

        # Take screenshot
        b64 = capture_screenshot(redact_sensitive=True)
        if not b64:
            return

        # Passive check — what Tier 1 situations are visible?
        result = await passive_check(b64)

        if not result.get("action_needed"):
            return

        situation = result.get("situation", "")
        element_text = result.get("element_text", "")
        confidence = result.get("confidence", 0)

        log.info(f"[Watcher] Detected: {situation} (conf={confidence:.2f})")

        if element_text:
            clicked = _click_element_by_text(element_text)
            _notify("watcher_action", {
                "situation": situation,
                "element": element_text,
                "success": clicked,
                "ts": datetime.now().isoformat(),
            })
        else:
            # No clickable element found — just notify
            _notify("watcher_observation", {
                "situation": situation,
                "ts": datetime.now().isoformat(),
            })

    except Exception as e:
        log.error(f"[Watcher] tick error: {e}")


async def _watcher_loop():
    global _running
    log.info("[Watcher] Screen watcher started")
    while _running:
        await asyncio.sleep(WATCHER_INTERVAL_S)
        if _running:
            await _watcher_tick()
    log.info("[Watcher] Screen watcher stopped")


def start():
    global _running, _task
    if _running:
        return
    _running = True
    loop = asyncio.get_event_loop()
    _task = loop.create_task(_watcher_loop())
    log.info("[Watcher] Task created")


def stop():
    global _running
    _running = False
    if _task and not _task.done():
        _task.cancel()


def is_running() -> bool:
    return _running


__all__ = ["start", "stop", "is_running", "set_notify_callback", "WATCHER_INTERVAL_S"]
