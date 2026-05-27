"""
NOVA Onboarding Routes
Handles the First Day Interview — seeds rules, memory facts,
and sensitive-domain customisations from Mr. V's answers.
"""

import json
import time
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.pattern_service import accept_rule, SUGGEST_THRESHOLD
from services.memory_service import upsert_fact

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

# ── Onboarding completion flag ────────────────────────────────────────────────

_ONBOARDING_FILE = None   # set lazily

def _flag_path():
    from pathlib import Path
    return Path.home() / ".nova" / "onboarding_done"

def is_onboarded() -> bool:
    return _flag_path().exists()

def mark_onboarded():
    p = _flag_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(time.time()))


# ── Answer schema ─────────────────────────────────────────────────────────────

class OnboardingAnswers(BaseModel):
    # Identity
    preferred_name: Optional[str] = None       # e.g. "Mr. V" or first name

    # Automation preferences
    skip_youtube_ads: bool = True
    dismiss_cookie_banners: bool = True
    dismiss_browser_notifications: bool = True

    # Morning routine apps (open at morning briefing time)
    morning_apps: list = []    # ["Gmail", "Slack", "Notion"]

    # Things NOVA should NEVER do without asking (beyond built-in Tier 2)
    extra_confirm_list: list = []   # ["LinkedIn job apply", "any purchase"]

    # Privacy
    max_privacy_mode: bool = False   # True → no cloud screenshots

    # Extra sensitive domains to add
    extra_sensitive_domains: list = []  # ["mybank.com"]

    # Memory seeds — facts about Mr. V
    full_name: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    profession: Optional[str] = None
    university: Optional[str] = None
    extra_facts: list = []   # list of "key: value" strings


# ── Conversion to rules ───────────────────────────────────────────────────────

def _seed_rules_from_answers(answers: OnboardingAnswers):
    """
    Convert onboarding answers into active pattern rules + memory facts.
    These are pre-seeded without needing the 5-repetition threshold.
    """
    from services.pattern_service import _conn, _LOCK, _signature
    from pathlib import Path
    import sqlite3
    import uuid

    rules_to_seed = []

    if answers.skip_youtube_ads:
        rules_to_seed.append({
            "tool": "youtube_control",
            "args": {"action": "skip_ad"},
            "description": "Skip YouTube ads automatically",
            "tier": 1,
        })

    if answers.dismiss_cookie_banners:
        rules_to_seed.append({
            "tool": "browser_action",
            "args": {"action": "dismiss_banners"},
            "description": "Dismiss cookie consent banners",
            "tier": 1,
        })

    if answers.dismiss_browser_notifications:
        rules_to_seed.append({
            "tool": "browser_action",
            "args": {"action": "dismiss_banners"},
            "description": "Dismiss browser notification popups",
            "tier": 1,
        })

    # Morning routine
    for app in (answers.morning_apps or []):
        rules_to_seed.append({
            "tool": "mac_open",
            "args": {"target": app},
            "description": f"Open {app} in morning routine",
            "tier": 1,
        })

    # Write rules directly as 'active' — bypassing threshold
    with _LOCK, _conn() as c:
        for r in rules_to_seed:
            sig = _signature(r["tool"], r["args"])
            existing = c.execute("SELECT id FROM rules WHERE signature=?", (sig,)).fetchone()
            if not existing:
                c.execute(
                    "INSERT INTO rules (id, signature, tool, tier, description, payload, "
                    "status, count_seen, count_fired, created_ts, activated_ts) "
                    "VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)",
                    (
                        str(uuid.uuid4()), sig, r["tool"], r["tier"],
                        r["description"], json.dumps(r["args"]),
                        time.time(), time.time(),
                    ),
                )

    # Add extra sensitive domains
    if answers.extra_sensitive_domains:
        from services.security_classifier import SENSITIVE_DOMAINS
        SENSITIVE_DOMAINS.update(answers.extra_sensitive_domains)

    # Privacy mode
    if answers.max_privacy_mode:
        from services.vision_service import set_privacy_mode
        set_privacy_mode(True)

    # Ensure DB tables exist before writing memory facts
    from database import create_tables
    create_tables()

    # Memory seeds
    if answers.preferred_name:
        upsert_fact("preferred_name", answers.preferred_name)
    if answers.full_name:
        upsert_fact("full_name", answers.full_name)
    if answers.email:
        upsert_fact("email", answers.email)
    if answers.location:
        upsert_fact("location", answers.location)
    if answers.profession:
        upsert_fact("profession", answers.profession)
    if answers.university:
        upsert_fact("university", answers.university)
    for fact_str in (answers.extra_facts or []):
        if ":" in fact_str:
            k, v = fact_str.split(":", 1)
            upsert_fact(k.strip(), v.strip())

    return len(rules_to_seed)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def onboarding_status():
    return {"completed": is_onboarded()}


@router.post("/complete")
async def complete_onboarding(answers: OnboardingAnswers):
    if is_onboarded():
        return {"success": True, "message": "Already onboarded.", "rules_created": 0}

    rules_count = _seed_rules_from_answers(answers)
    mark_onboarded()

    return {
        "success": True,
        "message": f"NOVA initialised with {rules_count} rules and your profile.",
        "rules_created": rules_count,
    }


@router.post("/reset")
async def reset_onboarding():
    """Dev/admin: reset onboarding so the interview shows again."""
    p = _flag_path()
    if p.exists():
        p.unlink()
    return {"success": True, "message": "Onboarding reset. Interview will show on next launch."}
