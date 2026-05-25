"""
NOVA Memory Routes
API endpoints for conversation history and long-term facts.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.memory_service import (
    load_recent_history,
    load_session_messages,
    clear_history,
    get_all_facts,
    upsert_fact,
    delete_fact,
    clear_facts,
)

router = APIRouter(prefix="/api/memory", tags=["memory"])


class FactRequest(BaseModel):
    key: str
    value: str


# ─── History ──────────────────────────────────────────────────────────────────

@router.get("/history")
async def get_history(limit: int = 40):
    """Load recent conversation history across all sessions."""
    messages = load_recent_history(limit=limit)
    return {"messages": messages, "count": len(messages)}


@router.get("/history/{session_id}")
async def get_session_history(session_id: str, limit: int = 100):
    """Load conversation history for a specific session."""
    messages = load_session_messages(session_id=session_id, limit=limit)
    return {"messages": messages, "count": len(messages)}


@router.delete("/history")
async def delete_history():
    """Clear all conversation history."""
    count = clear_history()
    return {"deleted": count, "message": f"Cleared {count} messages."}


# ─── Facts ────────────────────────────────────────────────────────────────────

@router.get("/facts")
async def get_facts():
    """Get all stored facts about Mr. V."""
    facts = get_all_facts()
    return {"facts": facts, "count": len(facts)}


@router.post("/facts")
async def add_fact(request: FactRequest):
    """Manually add or update a fact."""
    upsert_fact(request.key, request.value)
    return {"message": f"Saved: {request.key}"}


@router.delete("/facts/{key}")
async def remove_fact(key: str):
    """Delete a specific fact by key."""
    deleted = delete_fact(key)
    return {"deleted": deleted, "key": key}


@router.delete("/facts")
async def remove_all_facts():
    """Clear all facts."""
    count = clear_facts()
    return {"deleted": count, "message": f"Cleared {count} facts."}
