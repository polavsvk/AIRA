"""
NOVA Pattern Routes
API endpoints for Mr. V to view, accept, decline, and manage habit rules.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.pattern_service import (
    get_active_rules,
    get_suggested_rules,
    list_all_rules,
    accept_rule,
    decline_rule,
    pause_rule,
    resume_rule,
    freeze,
    unfreeze,
    is_frozen,
    reset_pattern_data,
    get_rules_context,
    SUGGEST_THRESHOLD,
)
from services.audit_log import get_recent

router = APIRouter(prefix="/api/patterns", tags=["patterns"])


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def pattern_status():
    return {
        "frozen": is_frozen(),
        "threshold": SUGGEST_THRESHOLD,
        "active_count": len(get_active_rules()),
        "suggested_count": len(get_suggested_rules()),
    }


# ── Rules ─────────────────────────────────────────────────────────────────────

@router.get("/rules")
async def get_rules(status: Optional[str] = None):
    """List all rules. Optional ?status=active|suggested|paused|declined"""
    rules = list_all_rules()
    if status:
        rules = [r for r in rules if r.get("status") == status]
    return {"rules": rules}


@router.get("/rules/suggested")
async def get_pending_suggestions():
    return {"rules": get_suggested_rules()}


@router.get("/rules/active")
async def get_active():
    return {"rules": get_active_rules()}


class RuleAction(BaseModel):
    rule_id: str


@router.post("/rules/accept")
async def accept(body: RuleAction):
    ok = accept_rule(body.rule_id)
    return {"success": ok, "message": "Rule activated." if ok else "Rule not found."}


@router.post("/rules/decline")
async def decline(body: RuleAction):
    ok = decline_rule(body.rule_id)
    return {"success": ok}


@router.post("/rules/pause")
async def pause(body: RuleAction):
    ok = pause_rule(body.rule_id)
    return {"success": ok}


@router.post("/rules/resume")
async def resume(body: RuleAction):
    ok = resume_rule(body.rule_id)
    return {"success": ok}


# ── Freeze switch ─────────────────────────────────────────────────────────────

@router.post("/freeze")
async def freeze_all():
    freeze()
    return {"frozen": True, "message": "All pattern auto-execution paused."}


@router.post("/unfreeze")
async def unfreeze_all():
    unfreeze()
    return {"frozen": False, "message": "Pattern automation resumed."}


# ── Audit trail ───────────────────────────────────────────────────────────────

@router.get("/audit")
async def audit_trail(limit: int = 50):
    return {"entries": get_recent(limit)}


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.post("/reset")
async def reset():
    ok = reset_pattern_data()
    return {"success": ok, "message": "All observations and rules cleared."}
