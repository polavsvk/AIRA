"""
NOVA Pattern Service — Habit Memory
====================================
Watches what NOVA does for Mr. V over time, detects repetition, suggests rules.

CORE RULES (locked in by Mr. V):

  RULE — TIER 1 PATTERNS CAN AUTO-EXECUTE
    After Mr. V accepts the rule, NOVA does it silently.
    Examples: skip ads, dismiss cookie banners, archive newsletter X.

  RULE — TIER 2 PATTERNS NEVER AUTO-EXECUTE
    Even after 100 repetitions, Tier 2 actions ALWAYS show confirmation.
    NOVA's best automation here: pre-fill the action and present
    "Ready to send. Confirm?" — single tap, but still requires the tap.

  RULE — EVERY AUTO-ACTION IS UNDOABLE + LOGGED
    Via audit_log + undo_service (already built in Phase A).

  RULE — KILL SWITCH
    Voice "NOVA freeze" or tray toggle → all pattern auto-execution stops.

Storage: SQLite at ~/.nova/patterns.db
"""

import json
import sqlite3
import time
import uuid
import hashlib
from pathlib import Path
from threading import Lock
from typing import Optional

from .security_classifier import classify_action, TIER_1, TIER_2

_LOCK = Lock()
_DB_DIR = Path.home() / ".nova"
_DB_PATH = _DB_DIR / "patterns.db"

# Threshold for suggesting a pattern as an automation rule
SUGGEST_THRESHOLD = 5

# Global automation kill switch (set by voice "NOVA freeze" / tray toggle)
_FROZEN = False


def _conn():
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(_DB_PATH), timeout=5)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init():
    with _LOCK, _conn() as c:
        # observations: every (action, signature) Mr. V performs
        c.execute("""
            CREATE TABLE IF NOT EXISTS observations (
                signature   TEXT NOT NULL,
                tool        TEXT NOT NULL,
                tier        INTEGER NOT NULL,
                description TEXT,
                payload     TEXT,
                ts          REAL NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_obs_sig ON observations(signature)")

        # rules: active automation patterns
        c.execute("""
            CREATE TABLE IF NOT EXISTS rules (
                id          TEXT PRIMARY KEY,
                signature   TEXT NOT NULL,
                tool        TEXT NOT NULL,
                tier        INTEGER NOT NULL,
                description TEXT,
                payload     TEXT,
                status      TEXT NOT NULL,    -- 'suggested' | 'active' | 'paused' | 'declined'
                count_seen  INTEGER NOT NULL DEFAULT 0,
                count_fired INTEGER NOT NULL DEFAULT 0,
                created_ts  REAL NOT NULL,
                activated_ts REAL,
                last_fired_ts REAL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_rules_sig ON rules(signature)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_rules_status ON rules(status)")


_init()


# ─────────────────────────── SIGNATURE / DESCRIPTION ─────────────────────────

def _signature(tool: str, args: dict) -> str:
    """
    Stable hash that identifies the 'shape' of an action.

    For browser_action: signature includes the action verb but NOT the target text
    (so "click_link Easy Apply" on different jobs all match).
    Adjust this list when adding new tools.
    """
    if tool == "browser_action":
        key = {"tool": tool, "action": (args or {}).get("action")}
    elif tool == "youtube_search":
        key = {"tool": tool}  # any search counts
    elif tool == "youtube_control":
        key = {"tool": tool, "action": (args or {}).get("action")}
    elif tool == "gmail_open":
        key = {"tool": tool, "action": (args or {}).get("action")}
    elif tool == "mac_open":
        key = {"tool": tool, "target": (args or {}).get("target")}  # specific app
    else:
        key = {"tool": tool}
    serial = json.dumps(key, sort_keys=True)
    return hashlib.sha1(serial.encode()).hexdigest()[:16]


def _describe(tool: str, args: dict) -> str:
    """Human-readable summary of the action."""
    a = args or {}
    if tool == "browser_action":
        act = a.get("action", "?")
        return f"Chrome: {act}"
    if tool == "youtube_search":
        return "Play YouTube video"
    if tool == "youtube_control":
        return f"YouTube: {a.get('action','?')}"
    if tool == "gmail_open":
        return f"Gmail: {a.get('action','?')}"
    if tool == "mac_open":
        return f"Open app: {a.get('target','?')}"
    return f"{tool}"


# ──────────────────────────────── PUBLIC API ─────────────────────────────────

def record_observation(tool: str, args: dict, url: str = "", target_label: str = "") -> dict:
    """
    Called after EVERY successful tool execution. Records the action and,
    if it crosses the threshold, creates a 'suggested' rule.
    """
    try:
        sig = _signature(tool, args)
        desc = _describe(tool, args)

        # classify (re-use main classifier; record tier with observation)
        # for browser_action we already classified — recompute for safety
        action_for_class = (args or {}).get("action") if tool == "browser_action" else tool
        decision = classify_action(action=action_for_class, url=url, target_label=target_label)
        tier = decision["tier"]

        ts = time.time()
        with _LOCK, _conn() as c:
            c.execute(
                "INSERT INTO observations (signature, tool, tier, description, payload, ts) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (sig, tool, tier, desc, json.dumps(args or {}), ts),
            )

            count = c.execute(
                "SELECT COUNT(*) FROM observations WHERE signature=?", (sig,)
            ).fetchone()[0]

            existing = c.execute(
                "SELECT id, status FROM rules WHERE signature=?", (sig,)
            ).fetchone()

            # If already active/declined/paused, just bump count_seen
            if existing:
                rule_id, status = existing
                c.execute(
                    "UPDATE rules SET count_seen=count_seen+1 WHERE id=?", (rule_id,)
                )
                return {"signature": sig, "count": count, "rule_status": status}

            # Crossed threshold → create a 'suggested' rule
            if count >= SUGGEST_THRESHOLD:
                rule_id = str(uuid.uuid4())
                c.execute(
                    "INSERT INTO rules (id, signature, tool, tier, description, payload, "
                    "status, count_seen, count_fired, created_ts) "
                    "VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?, 0, ?)",
                    (rule_id, sig, tool, tier, desc, json.dumps(args or {}), count, ts),
                )
                return {"signature": sig, "count": count, "rule_status": "suggested_new", "rule_id": rule_id}

            return {"signature": sig, "count": count, "rule_status": "below_threshold"}
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}


def get_active_rules() -> list:
    """Return all active rules (used to inject into the LLM system prompt)."""
    try:
        with _LOCK, _conn() as c:
            rows = c.execute(
                "SELECT id, signature, tool, tier, description, payload, "
                "count_seen, count_fired, activated_ts "
                "FROM rules WHERE status='active' ORDER BY count_fired DESC"
            ).fetchall()
        return [_row(r) for r in rows]
    except Exception:
        return []


def get_suggested_rules() -> list:
    try:
        with _LOCK, _conn() as c:
            rows = c.execute(
                "SELECT id, signature, tool, tier, description, payload, "
                "count_seen, count_fired, activated_ts "
                "FROM rules WHERE status='suggested' ORDER BY created_ts DESC"
            ).fetchall()
        return [_row(r) for r in rows]
    except Exception:
        return []


def list_all_rules() -> list:
    try:
        with _LOCK, _conn() as c:
            rows = c.execute(
                "SELECT id, signature, tool, tier, description, payload, "
                "count_seen, count_fired, activated_ts, status "
                "FROM rules ORDER BY created_ts DESC"
            ).fetchall()
        out = []
        for r in rows:
            d = _row(r[:9])
            d["status"] = r[9]
            out.append(d)
        return out
    except Exception:
        return []


def accept_rule(rule_id: str) -> bool:
    """Mr. V accepted a suggested rule → activate it."""
    try:
        with _LOCK, _conn() as c:
            row = c.execute(
                "SELECT tier FROM rules WHERE id=?", (rule_id,)
            ).fetchone()
            if not row:
                return False
            c.execute(
                "UPDATE rules SET status='active', activated_ts=? WHERE id=?",
                (time.time(), rule_id),
            )
        return True
    except Exception:
        return False


def decline_rule(rule_id: str) -> bool:
    try:
        with _LOCK, _conn() as c:
            c.execute("UPDATE rules SET status='declined' WHERE id=?", (rule_id,))
        return True
    except Exception:
        return False


def pause_rule(rule_id: str) -> bool:
    try:
        with _LOCK, _conn() as c:
            c.execute("UPDATE rules SET status='paused' WHERE id=?", (rule_id,))
        return True
    except Exception:
        return False


def resume_rule(rule_id: str) -> bool:
    try:
        with _LOCK, _conn() as c:
            c.execute("UPDATE rules SET status='active' WHERE id=?", (rule_id,))
        return True
    except Exception:
        return False


def mark_fired(rule_id: str):
    try:
        with _LOCK, _conn() as c:
            c.execute(
                "UPDATE rules SET count_fired=count_fired+1, last_fired_ts=? WHERE id=?",
                (time.time(), rule_id),
            )
    except Exception:
        pass


# ──────────────────────── AUTO-EXECUTE GATE ─────────────────────────────────

def should_auto_execute(tool: str, args: dict) -> Optional[dict]:
    """
    Check if this proposed action matches an ACTIVE TIER-1 rule.
    If yes → return the rule (caller can fire silently).
    If not → None (normal flow — go through LLM / classifier / confirmation).

    NEVER returns a rule for Tier 2 actions, no matter how many times learned.
    NEVER returns a rule when the freeze switch is on.
    """
    if _FROZEN:
        return None
    try:
        sig = _signature(tool, args)
        with _LOCK, _conn() as c:
            row = c.execute(
                "SELECT id, tier FROM rules WHERE signature=? AND status='active'",
                (sig,),
            ).fetchone()
        if not row:
            return None
        rule_id, tier = row
        if int(tier) == TIER_2:
            return None  # HARD-LOCKED — Tier 2 never auto-executes
        return {"rule_id": rule_id, "tier": tier}
    except Exception:
        return None  # fail closed → no auto-execute


# ──────────────────────── FREEZE SWITCH ─────────────────────────────────────

def freeze():
    global _FROZEN
    _FROZEN = True


def unfreeze():
    global _FROZEN
    _FROZEN = False


def is_frozen() -> bool:
    return _FROZEN


# ──────────────────────── SYSTEM PROMPT INJECTION ───────────────────────────

def get_rules_context() -> str:
    """Render active rules as a system-prompt block."""
    rules = get_active_rules()
    if not rules:
        return ""
    lines = ["## Mr. V's established habits (auto-applied by NOVA):"]
    for r in rules:
        marker = "•" if r["tier"] == TIER_1 else "·"
        lines.append(f"  {marker} {r['description']}  (used {r['count_fired']}x)")
    lines.append(
        "If a Tier-1 habit fits the current request, NOVA acts on it without asking. "
        "Tier-2 habits still require Mr. V's confirmation each time."
    )
    return "\n".join(lines)


# ─────────────────────── ADMIN / READING HELPERS ────────────────────────────

def _row(r) -> dict:
    return {
        "id": r[0], "signature": r[1], "tool": r[2], "tier": r[3],
        "description": r[4],
        "payload": json.loads(r[5]) if r[5] else {},
        "count_seen": r[6], "count_fired": r[7],
        "activated_ts": r[8],
    }


def reset_pattern_data():
    """Admin: wipe all observations + rules. Used by the UI 'reset' button."""
    try:
        with _LOCK, _conn() as c:
            c.execute("DELETE FROM observations")
            c.execute("DELETE FROM rules")
        return True
    except Exception:
        return False


__all__ = [
    "record_observation",
    "get_active_rules", "get_suggested_rules", "list_all_rules",
    "accept_rule", "decline_rule", "pause_rule", "resume_rule",
    "should_auto_execute", "mark_fired",
    "freeze", "unfreeze", "is_frozen",
    "get_rules_context", "reset_pattern_data",
    "SUGGEST_THRESHOLD",
]
