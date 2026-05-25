"""
NOVA Memory Service
Handles persistent conversation history and long-term facts about Mr. V.
"""

import json
import re
import asyncio
from datetime import datetime
from typing import List, Optional
from database import SessionLocal, Conversation, NovaMemory


# ─── Conversation History ─────────────────────────────────────────────────────

def save_message(session_id: str, role: str, content: str) -> None:
    """Save a single message to the database."""
    # Skip tool-internal messages and very short system blips
    if not content or not content.strip():
        return
    db = SessionLocal()
    try:
        msg = Conversation(session_id=session_id, role=role, content=content.strip())
        db.add(msg)
        db.commit()
    finally:
        db.close()


def load_recent_history(limit: int = 40) -> List[dict]:
    """
    Load the most recent N messages from ALL sessions combined.
    Returns oldest-first so the LLM sees them in chronological order.
    """
    db = SessionLocal()
    try:
        rows = (
            db.query(Conversation)
            .order_by(Conversation.created_at.desc())
            .limit(limit)
            .all()
        )
        return [{"role": r.role, "content": r.content} for r in reversed(rows)]
    finally:
        db.close()


def load_session_messages(session_id: str, limit: int = 100) -> List[dict]:
    """Load messages from a specific session."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Conversation)
            .filter(Conversation.session_id == session_id)
            .order_by(Conversation.created_at.asc())
            .limit(limit)
            .all()
        )
        return [{"role": r.role, "content": r.content, "created_at": r.created_at.isoformat()} for r in rows]
    finally:
        db.close()


def clear_history() -> int:
    """Delete all conversation history. Returns number of rows deleted."""
    db = SessionLocal()
    try:
        count = db.query(Conversation).count()
        db.query(Conversation).delete()
        db.commit()
        return count
    finally:
        db.close()


# ─── Long-term Memory (Facts) ─────────────────────────────────────────────────

def get_all_facts() -> List[dict]:
    """Return all stored facts about Mr. V."""
    db = SessionLocal()
    try:
        rows = db.query(NovaMemory).order_by(NovaMemory.updated_at.desc()).all()
        return [{"key": r.key, "value": r.value, "updated_at": r.updated_at.isoformat()} for r in rows]
    finally:
        db.close()


def get_memory_context() -> str:
    """
    Build the memory block injected into every system prompt.
    Returns empty string if no facts stored yet.
    """
    facts = get_all_facts()
    if not facts:
        return ""
    lines = ["## What I know about Mr. V (remembered from past sessions):"]
    for f in facts:
        lines.append(f"- {f['key']}: {f['value']}")
    return "\n".join(lines)


def upsert_fact(key: str, value: str) -> None:
    """Create or update a memory fact."""
    db = SessionLocal()
    try:
        existing = db.query(NovaMemory).filter_by(key=key).first()
        if existing:
            existing.value = value
            existing.updated_at = datetime.utcnow()
        else:
            db.add(NovaMemory(key=key, value=value))
        db.commit()
    finally:
        db.close()


def delete_fact(key: str) -> bool:
    db = SessionLocal()
    try:
        row = db.query(NovaMemory).filter_by(key=key).first()
        if row:
            db.delete(row)
            db.commit()
            return True
        return False
    finally:
        db.close()


def clear_facts() -> int:
    db = SessionLocal()
    try:
        count = db.query(NovaMemory).count()
        db.query(NovaMemory).delete()
        db.commit()
        return count
    finally:
        db.close()


# ─── Automatic Fact Extraction ────────────────────────────────────────────────

async def extract_facts_from_conversation(messages: List[dict], groq_client) -> None:
    """
    After a conversation, silently extract and store key facts.
    Runs as a background task — never blocks the response.
    """
    if not groq_client or len(messages) < 2:
        return

    # Only look at the last 10 exchanges to keep it fast
    recent = messages[-10:]
    conv_text = "\n".join([f"{m['role'].upper()}: {m['content'][:500]}" for m in recent])

    prompt = f"""Read this conversation and extract any facts worth remembering about Mr. V long-term.

Focus ONLY on: file/folder locations, project names, preferences, tools he uses, personal context, repeated topics.
Ignore: one-off questions, weather, news, tasks already in his task list.

Return ONLY a JSON array. If nothing worth remembering, return [].
Format: [{{"key": "short label", "value": "the fact"}}]

Conversation:
{conv_text}

JSON only:"""

    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=400,
        ))

        content = response.choices[0].message.content.strip()
        match = re.search(r'\[.*?\]', content, re.DOTALL)
        if not match:
            return

        facts = json.loads(match.group())
        for fact in facts:
            k = str(fact.get("key", "")).strip()
            v = str(fact.get("value", "")).strip()
            if k and v and len(k) < 100 and len(v) < 500:
                upsert_fact(k, v)

    except Exception:
        pass  # Memory extraction is best-effort — never crash the main flow
