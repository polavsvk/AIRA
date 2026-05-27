"""
NOVA Vision Routes
API endpoints for vision layer control and status.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.vision_service import (
    set_privacy_mode, get_privacy_mode,
    capture_screenshot, is_screen_sensitive,
    ask_vision, GROQ_VISION_MODEL,
)
from services.screen_watcher import start as watcher_start, stop as watcher_stop, is_running

router = APIRouter(prefix="/api/vision", tags=["vision"])


@router.get("/status")
async def status():
    sensitivity = is_screen_sensitive()
    return {
        "watcher_running": is_running(),
        "privacy_mode": get_privacy_mode(),
        "screen_safe": sensitivity["safe"],
        "screen_reason": sensitivity.get("reason", ""),
        "model": GROQ_VISION_MODEL,
    }


@router.post("/privacy")
async def set_privacy(enabled: bool):
    set_privacy_mode(enabled)
    return {"privacy_mode": enabled}


@router.post("/watcher/start")
async def start_watcher():
    watcher_start()
    return {"running": True}


@router.post("/watcher/stop")
async def stop_watcher():
    watcher_stop()
    return {"running": False}


class AskRequest(BaseModel):
    question: str
    capture: bool = True


@router.post("/ask")
async def ask(body: AskRequest):
    """Ask a question about what's on screen. Used by 'What's on my screen?'"""
    answer = await ask_vision(body.question, capture_fresh=body.capture)
    if answer is None:
        sensitivity = is_screen_sensitive()
        if not sensitivity["safe"]:
            return {"success": False, "result": f"Sensitive screen: {sensitivity['reason']}"}
        return {"success": False, "result": "Could not capture or analyse screen."}
    return {"success": True, "result": answer}
