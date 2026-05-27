"""
NOVA Undo Service
=================
Reverse the last N auto-actions NOVA took on Mr. V's behalf.

Currently supports browser actions. As new action types are added (file, mail,
calendar, etc.), register an undo handler here.
"""

import logging
from typing import Callable, Optional, Dict
from . import audit_log

log = logging.getLogger("nova.undo")


# Registry: action_name → async function(payload) -> dict
_UNDO_HANDLERS: Dict[str, Callable] = {}


def register_undo(action_name: str, handler: Callable):
    """Register an undo handler for a given action type."""
    _UNDO_HANDLERS[action_name] = handler


async def undo_last(n: int = 1) -> list:
    """
    Undo the last N undoable actions. Skips actions with no undo handler.
    Returns a list of {action, outcome, message} dicts.
    """
    results = []
    recent = audit_log.get_recent(limit=200)
    # filter to intents that have an undo_token in their result
    intents_with_undo = []
    seen = set()
    for r in recent:
        if r["phase"] == "intent" and r["id"] not in seen:
            seen.add(r["id"])
            # find paired result
            paired = next(
                (x for x in recent if x["phase"] == f"result_of:{r['id']}"),
                None,
            )
            if paired and paired.get("undo_token") and paired.get("outcome") == "success":
                intents_with_undo.append((r, paired))

    for intent, result in intents_with_undo[:n]:
        action = intent.get("action")
        handler = _UNDO_HANDLERS.get(action)
        if not handler:
            results.append({
                "action": action,
                "outcome": "skipped",
                "message": f"No undo handler for {action}.",
            })
            continue
        try:
            outcome = await handler(intent, result)
            results.append({
                "action": action, "outcome": "success",
                "message": outcome.get("message", "Undone."),
            })
        except Exception as e:
            log.exception("Undo handler failed")
            results.append({
                "action": action, "outcome": "failure",
                "message": f"Undo failed: {e}",
            })
    return results


def list_undoable(limit: int = 20) -> list:
    """List recent actions that could be undone."""
    recent = audit_log.get_recent(limit=200)
    out = []
    seen = set()
    for r in recent:
        if r["phase"] == "intent" and r["id"] not in seen:
            seen.add(r["id"])
            paired = next(
                (x for x in recent if x["phase"] == f"result_of:{r['id']}"),
                None,
            )
            if paired and paired.get("undo_token") and paired.get("outcome") == "success":
                if r.get("action") in _UNDO_HANDLERS:
                    out.append({
                        "id": r["id"], "ts": r["ts"],
                        "action": r["action"], "url": r.get("url"),
                        "target_label": r.get("target_label"),
                    })
                    if len(out) >= limit:
                        break
    return out


__all__ = ["register_undo", "undo_last", "list_undoable"]
