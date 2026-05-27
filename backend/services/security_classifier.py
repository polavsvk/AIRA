"""
NOVA Security Classifier
========================
Single source of truth for: "is this action safe to auto-execute, or does it need
Mr. V's explicit confirmation?"

CORE RULES (locked in by Mr. V — never bypass):

  RULE 1 — FAIL CLOSED
    Any exception, timeout, None, or uncertain classification → Tier 2.
    Errors must NEVER result in auto-execution.

  RULE 2 — BEHAVIORAL DETECTION, NOT KEYWORDS
    A button labeled "Continue" that pays = Tier 2.
    A button labeled "Buy" that just opens a product page = Tier 1.
    Classify by what the action DOES, not what it's called.

  RULE 3 — DOMAIN-INDEPENDENT PAYMENT/SENSITIVE DETECTION
    Credit card / CVV / SSN / password fields anywhere → Tier 2.
    All .gov domains → Tier 2 (Mr. V is on a visa).
    Send action on messaging apps → Tier 2 even though browsing is fine.

Every tool call in NOVA routes through classify_action(). No exceptions.
"""

import re
import logging
from urllib.parse import urlparse
from typing import Optional

log = logging.getLogger("nova.security")


# ───────────────────────────── DOMAIN SEED LIST ──────────────────────────────
# Approved by Mr. V. Add only with his go.

SENSITIVE_DOMAINS = {
    # ── US BANKING ──
    "usbank.com",
    "americanexpress.com",
    "amex.com",
    "chime.com",
    "discover.com",
    "discovercard.com",

    # ── INDIA BANKING (SBI + BOB only — per Mr. V) ──
    "onlinesbi.sbi",
    "onlinesbi.com",
    "sbi.co.in",
    "bankofbaroda.in",
    "bobibanking.com",

    # ── IMMIGRATION (CRITICAL — Mr. V on visa) ──
    "uscis.gov",
    "ice.gov",
    "studyinthestates.dhs.gov",
    "travel.state.gov",
    "sevp.ice.gov",

    # ── UNIVERSITY ──
    "mst.edu",

    # ── PAYMENT PROCESSORS ──
    "stripe.com",
    "paypal.com",
    "razorpay.com",
    "venmo.com",
    "wise.com",
}

# Messaging domains: browsing/reading allowed, SEND action is Tier 2.
MESSAGING_DOMAINS = {
    "web.whatsapp.com",
    "linkedin.com",  # /messaging path + Easy Apply submit
}

# Send-action verbs (used to detect Tier 2 actions on messaging domains
# AND on any form anywhere)
SEND_ACTION_KEYWORDS = {
    "send", "submit", "post", "publish", "apply", "easy apply",
    "place order", "complete order", "complete purchase", "pay", "pay now",
    "checkout", "confirm", "confirm payment", "buy", "buy now",
    "subscribe", "agree", "accept", "i agree", "delete", "remove account",
    "deactivate", "close account", "transfer", "withdraw",
}


# ───────────────────────────── TIER DEFINITIONS ──────────────────────────────

TIER_1 = 1   # Auto-execute (reversible, safe)
TIER_2 = 2   # Always confirm (irreversible, sensitive, or in doubt)


# ───────────────────────────── DOMAIN HELPERS ────────────────────────────────

def _hostname(url: Optional[str]) -> str:
    """Extract hostname from URL. Fail closed: bad URL → empty string (Tier 2)."""
    if not url:
        return ""
    try:
        h = urlparse(url).hostname or ""
        return h.lower()
    except Exception:
        return ""


def is_gov_domain(url: Optional[str]) -> bool:
    """Any .gov host (incl. subdomains) → True. Unparseable → True (fail closed)."""
    if not url:
        return True
    try:
        host = _hostname(url)
        if not host:
            return True  # fail closed
        return host == "gov" or host.endswith(".gov")
    except Exception:
        return True  # fail closed


def is_sensitive_domain(url: Optional[str]) -> bool:
    """Match seed list (exact host or subdomain). Fail closed on parse error."""
    if not url:
        return True
    try:
        host = _hostname(url)
        if not host:
            return True
        if host in SENSITIVE_DOMAINS:
            return True
        # Subdomain match: my.uscis.gov matches uscis.gov
        for d in SENSITIVE_DOMAINS:
            if host.endswith("." + d):
                return True
        return False
    except Exception:
        return True


def is_messaging_domain(url: Optional[str]) -> bool:
    if not url:
        return False
    try:
        host = _hostname(url)
        if host in MESSAGING_DOMAINS:
            return True
        for d in MESSAGING_DOMAINS:
            if host.endswith("." + d):
                return True
        return False
    except Exception:
        return False


# ───────────────────────────── BEHAVIORAL DETECTION ──────────────────────────
# These run on a DOM snapshot dict (provided by browser_action when it inspects
# the page). DOM snapshot shape:
# {
#   "url": "https://...",
#   "title": "...",
#   "inputs": [{"type": "password", "name": "...", "autocomplete": "...", ...}],
#   "forms":  [{"action": "/checkout", "method": "POST", ...}],
#   "buttons": [{"text": "Place order", "type": "submit", ...}],
# }

def has_password_field(dom: dict) -> bool:
    """Any visible password field on the page → Tier 2."""
    try:
        for inp in dom.get("inputs", []) or []:
            t = (inp.get("type") or "").lower()
            if t == "password":
                return True
        return False
    except Exception:
        return True  # fail closed


def has_credit_card_field(dom: dict) -> bool:
    """
    Behavioral CC detection — catches payment sites NOT in the seed list.
    Mr. V: 'Don't rely only on the domain list. Detect PAYMENT BEHAVIOR.'
    """
    try:
        cc_autocomplete = {"cc-number", "cc-csc", "cc-exp", "cc-name"}
        cc_name_patterns = re.compile(
            r"(card[\s_-]?number|cardnum|ccnum|cc[\s_-]?number|"
            r"cvv|cvc|security[\s_-]?code|card[\s_-]?cvv|"
            r"exp[\s_-]?date|expiry|expiration)",
            re.IGNORECASE,
        )
        for inp in dom.get("inputs", []) or []:
            ac = (inp.get("autocomplete") or "").lower()
            if ac in cc_autocomplete:
                return True
            name = (inp.get("name") or "") + " " + (inp.get("id") or "") + " " + (inp.get("placeholder") or "")
            if cc_name_patterns.search(name):
                return True
            # CVV heuristic: maxlength 3 or 4 with "security"/"cvv" label nearby
            ml = inp.get("maxlength")
            label = (inp.get("aria_label") or "") + " " + (inp.get("label") or "")
            if ml in (3, 4, "3", "4") and re.search(r"cvv|cvc|security", label, re.IGNORECASE):
                return True
        return False
    except Exception:
        return True  # fail closed


def has_ssn_field(dom: dict) -> bool:
    try:
        ssn_re = re.compile(r"(ssn|social[\s_-]?security)", re.IGNORECASE)
        for inp in dom.get("inputs", []) or []:
            label = " ".join([
                str(inp.get("name") or ""),
                str(inp.get("id") or ""),
                str(inp.get("placeholder") or ""),
                str(inp.get("aria_label") or ""),
                str(inp.get("label") or ""),
            ])
            if ssn_re.search(label):
                return True
        return False
    except Exception:
        return True  # fail closed


def is_send_action(action_label: Optional[str]) -> bool:
    """Does this button/action text imply a send/submit/pay/apply?"""
    if not action_label:
        return False
    try:
        label = action_label.strip().lower()
        # Exact and substring matches against the SEND_ACTION_KEYWORDS list
        for kw in SEND_ACTION_KEYWORDS:
            if kw in label:
                return True
        return False
    except Exception:
        return True  # fail closed


# ─────────────────────── MAIN CLASSIFIER (single entry point) ────────────────

def classify_action(
    *,
    action: str,
    url: Optional[str] = None,
    target_label: Optional[str] = None,
    dom: Optional[dict] = None,
) -> dict:
    """
    Classify an action as Tier 1 (auto-execute) or Tier 2 (require confirmation).

    Args:
      action       — what NOVA is about to do, one of:
                     'navigate', 'click_link', 'click_element', 'type',
                     'scroll', 'go_back', 'go_forward', 'new_tab',
                     'close_tab', 'switch_tab', 'address_bar',
                     'skip_ad', 'press', 'submit_form', 'send_message',
                     'delete', 'file_write', 'file_delete', etc.
      url          — current page URL (for browser actions)
      target_label — visible text of the button/link being clicked
      dom          — DOM snapshot (see shape above). Optional but boosts accuracy.

    Returns:
      {
        "tier": 1 | 2,
        "reason": str,         # human-readable explanation
        "signals": list[str],  # which rules fired
      }

    FAIL-CLOSED — any error/uncertainty → Tier 2.
    """
    signals = []
    try:
        action = (action or "").lower().strip()

        # ── HARD-LOCKED ACTION VERBS — always Tier 2 ──
        always_tier2_actions = {
            "submit_form", "send_message", "send_email", "delete",
            "file_delete", "purchase", "pay", "checkout", "apply_job",
            "transfer", "withdraw", "logout_all", "deactivate",
        }
        if action in always_tier2_actions:
            signals.append(f"action_type:{action}")
            return _result(TIER_2, "Action type is always sensitive.", signals)

        # ── DOMAIN RULES ──
        if url:
            if is_gov_domain(url):
                signals.append("gov_domain")
                return _result(TIER_2, ".gov domain — confirm any action.", signals)
            if is_sensitive_domain(url):
                signals.append("sensitive_domain")
                # Allow pure navigation/scroll/read on these — but not click/type
                if action in {"navigate", "scroll", "go_back", "go_forward", "read", "new_tab"}:
                    pass  # fall through to other checks
                else:
                    return _result(TIER_2, "Sensitive domain — non-read action confirm-only.", signals)

        # ── DOM-BASED PAYMENT/PASSWORD DETECTION ──
        if dom:
            if has_credit_card_field(dom):
                signals.append("credit_card_field_detected")
                # Even reading is allowed; only click/type/submit is Tier 2
                if action in {"click_link", "click_element", "type", "press", "submit_form"}:
                    return _result(TIER_2, "Credit card / CVV field present on page.", signals)
            if has_password_field(dom):
                signals.append("password_field_detected")
                if action in {"click_element", "click_link", "submit_form", "type", "press"}:
                    # Typing into the password field itself, or clicking submit, → Tier 2
                    if action == "type" or (action in {"click_element", "click_link"} and is_send_action(target_label)):
                        return _result(TIER_2, "Password-field flow — confirm before submit.", signals)
            if has_ssn_field(dom):
                signals.append("ssn_field_detected")
                if action in {"click_element", "click_link", "type", "submit_form"}:
                    return _result(TIER_2, "SSN field present — confirm.", signals)

        # ── MESSAGING DOMAINS: reading OK, sending NOT OK ──
        if url and is_messaging_domain(url):
            signals.append("messaging_domain")
            if action in {"click_link", "click_element", "submit_form", "send_message", "press"}:
                if is_send_action(target_label) or action in {"submit_form", "send_message"}:
                    return _result(TIER_2, "Send action on messaging domain.", signals)
            # else navigate/scroll/read → fall through to Tier 1

        # ── SEND-ACTION LABEL DETECTION (domain-independent) ──
        if action in {"click_link", "click_element", "press"} and is_send_action(target_label):
            signals.append(f"send_keyword_label:{target_label!r}")
            return _result(TIER_2, "Button text implies submit/send/pay/apply.", signals)

        # ── TIER 1 ALLOWLIST (explicit safe actions) ──
        tier1_safe = {
            "navigate", "scroll", "scroll_up", "scroll_down",
            "go_back", "go_forward", "read", "get_links",
            "new_tab", "switch_tab", "skip_ad",
            "dismiss_banner", "close_notification",
            "open_app",
        }
        if action in tier1_safe:
            signals.append(f"safe_action:{action}")
            return _result(TIER_1, "Reversible, safe action.", signals)

        # ── DEFAULT: unknown → Tier 2 (fail closed) ──
        signals.append("unknown_action_default_tier2")
        return _result(TIER_2, "Unknown action — defaulting to confirm.", signals)

    except Exception as e:
        # ABSOLUTE FAIL-CLOSED
        log.exception("security_classifier crashed; defaulting to Tier 2")
        return _result(TIER_2, f"Classifier error: {e!r}", signals + ["classifier_exception"])


def _result(tier: int, reason: str, signals: list) -> dict:
    return {"tier": tier, "reason": reason, "signals": signals}


# ───────────────────────────── EXPORTED API ──────────────────────────────────

__all__ = [
    "TIER_1", "TIER_2",
    "classify_action",
    "is_gov_domain", "is_sensitive_domain", "is_messaging_domain",
    "has_password_field", "has_credit_card_field", "has_ssn_field",
    "is_send_action",
    "SENSITIVE_DOMAINS", "MESSAGING_DOMAINS", "SEND_ACTION_KEYWORDS",
]
