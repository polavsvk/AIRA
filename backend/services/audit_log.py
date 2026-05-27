"""
NOVA Audit Log
==============
Append-only record of every action NOVA takes on Mr. V's behalf.

CORE RULES (locked in by Mr. V):

  RULE — WRITE BEFORE ACT
    log_intent()   → BEFORE the action runs (so if it crashes, you still know)
    log_result()   → AFTER the action completes (success or failure)

  RULE — APPEND-ONLY
    No DELETE. No UPDATE. No clear(). The log is the safety net.
    Codebase exposes only: log_intent, log_result, get_recent, get_by_id.

Storage: SQLite at ~/.nova/audit.db
"""

import os
import json
import sqlite3
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Optional

# Single writer lock — SQLite handles concurrent readers fine
_LOCK = Lock()

_DB_DIR = Path.home() / ".nova"
_DB_PATH = _DB_DIR / "audit.db"


def _conn():
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(_DB_PATH), timeout=5)
    c.execute("PRAGMA journal_mode=WAL")  # crash-safe
    return c


def _init():
    with _LOCK, _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS audit (
                id              TEXT PRIMARY KEY,
                ts              REAL NOT NULL,
                phase           TEXT NOT NULL,   -- 'intent' or 'result'
                action          TEXT NOT NULL,
                tier            INTEGER,
                url             TEXT,
                target_label    TEXT,
                payload         TEXT,            -- JSON
                outcome         TEXT,            -- 'success' | 'failure' | 'denied'
                error           TEXT,
                undo_token      TEXT             -- opaque token for undo_service
            )
        """)
        # Helpful indexes
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action)")


_init()


# ─────────────────────────────── WRITE API ───────────────────────────────────

def log_intent(
    *,
    action: str,
    tier: int,
    url: Optional[str] = None,
    target_label: Optional[str] = None,
    payload: Optional[dict] = None,
) -> str:
    """
    Record what NOVA is ABOUT to do, BEFORE doing it.
    Returns an intent_id you must pass to log_result() afterwards.
    """
    intent_id = str(uuid.uuid4())
    try:
        with _LOCK, _conn() as c:
            c.execute(
                "INSERT INTO audit (id, ts, phase, action, tier, url, target_label, payload) "
                "VALUES (?, ?, 'intent', ?, ?, ?, ?, ?)",
                (
                    intent_id,
                    time.time(),
                    action,
                    int(tier) if tier is not None else None,
                    url,
                    target_label,
                    json.dumps(payload or {}, default=str),
                ),
            )
            c.commit()
    except Exception:
        # Never let logging failures block NOVA — but at least print
        import traceback; traceback.print_exc()
    return intent_id


def log_result(
    intent_id: str,
    *,
    outcome: str,           # 'success' | 'failure' | 'denied'
    error: Optional[str] = None,
    undo_token: Optional[str] = None,
) -> None:
    """Record the outcome of the action started in log_intent()."""
    try:
        with _LOCK, _conn() as c:
            # Insert a paired 'result' row referring to intent
            c.execute(
                "INSERT INTO audit (id, ts, phase, action, outcome, error, undo_token, payload) "
                "VALUES (?, ?, 'result', ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    time.time(),
                    f"result_of:{intent_id}",
                    outcome,
                    error,
                    undo_token,
                    json.dumps({"intent_id": intent_id}),
                ),
            )
            c.commit()
    except Exception:
        import traceback; traceback.print_exc()


def log_denied(
    *,
    action: str,
    tier: int,
    url: Optional[str] = None,
    target_label: Optional[str] = None,
    reason: str = "",
) -> str:
    """Record an action that was blocked (Tier 2 awaiting confirmation, etc.)."""
    return log_intent(
        action=action, tier=tier, url=url, target_label=target_label,
        payload={"denied_reason": reason},
    )


# ─────────────────────────────── READ API ────────────────────────────────────

def get_recent(limit: int = 50) -> list:
    """Return the N most recent audit entries (intent + result rows)."""
    try:
        with _LOCK, _conn() as c:
            rows = c.execute(
                "SELECT id, ts, phase, action, tier, url, target_label, "
                "payload, outcome, error, undo_token "
                "FROM audit ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def get_by_id(entry_id: str) -> Optional[dict]:
    try:
        with _LOCK, _conn() as c:
            r = c.execute(
                "SELECT id, ts, phase, action, tier, url, target_label, "
                "payload, outcome, error, undo_token FROM audit WHERE id=?",
                (entry_id,),
            ).fetchone()
        return _row_to_dict(r) if r else None
    except Exception:
        return None


def _row_to_dict(r) -> dict:
    return {
        "id": r[0], "ts": r[1], "phase": r[2], "action": r[3],
        "tier": r[4], "url": r[5], "target_label": r[6],
        "payload": _safe_json(r[7]),
        "outcome": r[8], "error": r[9], "undo_token": r[10],
    }


def _safe_json(s):
    try:
        return json.loads(s) if s else {}
    except Exception:
        return {"_raw": s}


# NOTE: No delete / clear / update methods are exposed. By design.

__all__ = ["log_intent", "log_result", "log_denied", "get_recent", "get_by_id"]
