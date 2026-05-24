from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models import ChatRequest, ChatResponse
from services.groq_service import get_chat_response, get_chat_response_stream
import json

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Standard chat endpoint — returns full response."""
    history = [{"role": m.role, "content": m.content} for m in request.history]
    response = get_chat_response(request.message, history)
    return ChatResponse(response=response, model="llama-3.3-70b-versatile")


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat endpoint — returns response token by token."""
    history = [{"role": m.role, "content": m.content} for m in request.history]

    def generate():
        for token in get_chat_response_stream(request.message, history):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
