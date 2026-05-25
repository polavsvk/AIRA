"""
NOVA Chat Routes
Handles streaming chat with tool use, confirmations, and the opening greeting.
"""

import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional

from services.groq_service import (
    get_chat_response_stream_with_tools,
    confirm_action,
    get_opening_greeting,
    get_chat_response,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []


class ConfirmRequest(BaseModel):
    confirmation_id: str


@router.post("/")
async def chat(request: ChatRequest):
    """Sync chat — returns full response (used by briefing)."""
    history = [{"role": m.role, "content": m.content} for m in (request.history or [])]
    response = get_chat_response(request.message, history)
    return {"response": response, "model": "llama-3.3-70b-versatile"}


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat with full tool use support."""
    history = [{"role": m.role, "content": m.content} for m in (request.history or [])]

    async def generate():
        async for event in get_chat_response_stream_with_tools(request.message, history):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/confirm")
async def confirm(request: ConfirmRequest):
    """Execute a confirmed sensitive action (file write, etc.)."""
    result = await confirm_action(request.confirmation_id)
    return result


@router.get("/greeting")
async def greeting():
    """Get NOVA's time-aware opening greeting (AI-generated, not hardcoded)."""
    prompt = get_opening_greeting()
    text = get_chat_response(prompt, [])
    return {"greeting": text}
