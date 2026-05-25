"""
NOVA Chat Routes
Streaming chat with tool use, confirmations, memory saving, and greeting.
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
from services.memory_service import save_message

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    session_id: Optional[str] = "default"


class ConfirmRequest(BaseModel):
    confirmation_id: str


@router.post("/")
async def chat(request: ChatRequest):
    """Sync chat — returns full response."""
    history = [{"role": m.role, "content": m.content} for m in (request.history or [])]
    response = get_chat_response(request.message, history)
    # Save both sides
    save_message(request.session_id or "default", "user", request.message)
    save_message(request.session_id or "default", "assistant", response)
    return {"response": response, "model": "llama-3.3-70b-versatile"}


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat with full tool use + auto memory save."""
    history = [{"role": m.role, "content": m.content} for m in (request.history or [])]
    session_id = request.session_id or "default"

    # Save user message immediately
    save_message(session_id, "user", request.message)

    async def generate():
        full_response = ""
        async for event in get_chat_response_stream_with_tools(
            request.message, history, session_id
        ):
            if event.get("type") == "token":
                full_response += event.get("content", "")
            elif event.get("type") == "done":
                # Save assistant response
                if full_response:
                    save_message(session_id, "assistant", full_response)
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/confirm")
async def confirm(request: ConfirmRequest):
    """Execute a confirmed sensitive action."""
    result = await confirm_action(request.confirmation_id)
    return result


@router.get("/greeting")
async def greeting():
    """NOVA's time-aware, memory-aware opening greeting."""
    prompt = get_opening_greeting()
    text = get_chat_response(prompt, [])
    return {"greeting": text}
