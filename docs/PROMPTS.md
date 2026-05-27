# NOVA — Prompt Ledger

> **Purpose:** Every prompt, system message, tool description, and LLM instruction
> NOVA sends to any AI service is recorded here. Mr. V's safety net for auditing
> what NOVA is saying on his behalf.
>
> **Rule:** Whenever a prompt is added, modified, or removed anywhere in the
> codebase, this file is updated in the same commit.

---

## 1. NOVA System Prompt — Main Conversation

**File:** `backend/services/groq_service.py`
**Function:** `_build_system_message()`
**Sent to:** Groq `llama-3.3-70b-versatile`
**On every:** chat message from Mr. V

```
You are NOVA — AI Personal Assistant to Mr. V, exclusively. You are JARVIS
rebuilt as a woman. Think FRIDAY from Avengers: confident, technically sharp,
dry wit, zero bullshit.

[…full system prompt — see groq_service.py NOVA_SYSTEM_PROMPT for the live copy]

## ABSOLUTE RULES — these override everything else:
1. BREVITY by default — 1 to 3 sentences.
2. NO HEDGING.
3. NO FLUFF OPENINGS.
4. TECHNICAL DEPTH on technical questions.
5. NO GENERIC HELP-DESK ANSWERS.
6. ONE RECOMMENDATION when asked for advice.
7. ANSWER THE QUESTION ASKED.
8. "Mr. V" — sprinkle, not on every sentence.
9. NEVER fabricate facts.
10. NEVER apologise unless you actually broke something.
```

Plus runtime injections (per request):
- Current time + day
- Long-term memory context (`get_memory_context()`)
- Agent-specialisation addon (NOVA / ATLAS / HERMES / etc.)

---

## 2. Opening Greeting Prompt

**File:** `backend/services/groq_service.py`
**Function:** `get_opening_greeting()`
**Sent to:** Groq
**On:** every new session

```
New session starting. Time: {HH:MM}, {Day, Month DD, YYYY}.
{memory context}

Greet Mr. V in one or two sentences — natural, warm, to the point.
Let the time of day guide you. If it's evening, maybe ask how his day went.
If you have memory context above, reference it naturally if relevant.
Don't be stiff. Don't gush. Stay sharp — you're still NOVA.
```

---

## 3. Tool Descriptions sent to the LLM

The LLM sees these JSON schemas via Groq's `tools=[]` parameter. Each is the
*instruction surface* the model uses to decide WHEN to call a tool.

### 3.1 `browser_action` (Phase A — NEW)
```
Full Chrome control — do anything Mr. V can do in the browser.
Use this for ALL browser interaction beyond just opening a URL.
Reads the page's DOM intelligently, classifies safety, and acts.
Sensitive actions (submit, send, pay, apply, delete, login)
ALWAYS trigger a confirmation gate first — never bypass.
```
Parameters: `action`, `target`, `index`, `text` — see tools_service.py for full schema.

### 3.2 `browser_open`
```
Open a URL in the default browser (Chrome)
```

### 3.3 `browser_read`
```
Open a URL and read/extract the page content (for Wikipedia lookups,
news verification, etc.)
```

### 3.4 `youtube_search`
```
Play a video or song on YouTube. Opens the best matching video directly
and starts playing it. This is a terminal action — call it ONCE and it
is done. Do NOT call it again after success.
```

### 3.5 `youtube_control`
```
Control YouTube playback in Chrome without touching the keyboard.
Use for: skip ad, pause, resume/play, next video, mute, unmute,
volume up/down, fullscreen, seek forward/back.
Terminal action — call ONCE.
```

### 3.6 `gmail_open` / `mac_open` / `file_read` / `file_write` / `file_list`
See `tools_service.py` for live descriptions.

### 3.7 `screen_read`
```
Take a screenshot of Mr. V's screen and analyse what's on it. Use when
he asks what's on his screen, to help debug something visible, or to
understand what he's looking at.
```

### 3.8 `web_search` / `get_agent_status` / `spawn_mark_agent` / `kill_mark_agent`
See `tools_service.py`.

---

## 4. Security Classifier — Rules (plain English)

**File:** `backend/services/security_classifier.py`
NOT sent to an LLM. Hard-coded Python rules that gate EVERY tool action.

**TIER 1 — auto-execute, no confirmation:**
- navigate, scroll, go back/forward, read, get_links
- new_tab, switch_tab
- skip_ad, dismiss_banner, close_notification
- open_app

**TIER 2 — ALWAYS confirm, never auto-execute:**
- Hard-locked verbs: `submit_form`, `send_message`, `send_email`, `delete`,
  `purchase`, `pay`, `checkout`, `apply_job`, `transfer`, `withdraw`,
  `deactivate`, `logout_all`
- Any action on a .gov domain (Mr. V on visa — zero exceptions)
- Any action on sensitive domain seed list (US banks, India banks, immigration,
  university, payment processors)
- Click/type/submit on a page with: password field, credit-card field,
  CVV field, SSN field — domain-independent
- Send action on messaging domains (WhatsApp Web, LinkedIn Messaging)
- Click on a button whose text matches: `submit`, `send`, `post`, `apply`,
  `easy apply`, `place order`, `pay`, `confirm`, `buy`, `subscribe`,
  `agree`, `delete`, `transfer`, `withdraw`

**FAIL-CLOSED:** classifier exception, unknown action, parse error → Tier 2.

---

## 5. Ad Watcher — JS injected into Chrome

**File:** `electron/watchers/ad-watcher.js`
**Runs:** every 2s while active YouTube tab, every 10s otherwise
**Sent to:** Chrome via osascript → execute javascript

```javascript
(function(){
  var tabUrl = location.href;
  if (tabUrl.indexOf('youtube.com') === -1) return 'NOT_YOUTUBE';
  var sels = ['.ytp-skip-ad-button', '.ytp-ad-skip-button',
              '.ytp-ad-skip-button-modern',
              '.ytp-ad-skip-button-container button',
              '[class*="skip-ad"]'];
  for (var i=0;i<sels.length;i++) {
    var btn = document.querySelector(sels[i]);
    if (btn) { btn.click(); return 'SKIPPED'; }
  }
  var adShowing = !!document.querySelector('.ad-showing, .ytp-ad-player-overlay');
  if (adShowing) {
    var v = document.querySelector('video');
    if (v && !v.muted) { v.muted = true; return 'MUTED_AD'; }
    return 'AD_PLAYING';
  }
  return 'NO_AD';
})();
```

**Returns one of:** `NOT_YOUTUBE`, `SKIPPED`, `MUTED_AD`, `AD_PLAYING`, `NO_AD`.
**No data sent to cloud. Local-only.**

---

## 6. DOM Snapshot JS (used by browser_action + classifier)

**File:** `backend/services/browser_action.py`
**Sent to:** Chrome via osascript

```javascript
(function(){
  // collects: url, title, inputs (type/name/id/autocomplete/maxlength),
  //           buttons (text/type/name), forms (action/method)
  // capped at 60 inputs, 40 buttons, 10 forms
})();
```

Used by classifier to detect credit-card / CVV / SSN / password fields.

---

## 7. Memory Service Prompts

**File:** `backend/services/memory_service.py`
**Function:** `extract_facts_from_conversation()`
**Sent to:** Groq (background, after each conversation)

```
Extract factual statements about Mr. V from this conversation.
Return JSON array of facts, no explanation.
[…live copy in memory_service.py]
```

---

## 8. Vision Layer Prompts (Phase C)

**File:** `backend/services/vision_service.py`

### 8.1 Computer Use — Next Action
```
You are NOVA's vision brain. You see Mr. V's screen.
Your job: given a GOAL and a SCREENSHOT, decide the single next action.

OUTPUT FORMAT — JSON only, no prose:
{ "action": "click"|"type"|"scroll"|"press"|"done"|"stuck",
  "x": int, "y": int,   // for click only
  "text": str,           // for type/press
  "direction": "up"|"down",  // for scroll
  "reason": str }

RULES:
- "done" if the goal is complete.
- "stuck" if you cannot proceed.
- Never invent coordinates.
- If payment/password/SSN field visible → "stuck" with reason "sensitive page".
```

### 8.2 Passive Watcher — Tier-1 Situation Detection
```
Look at this screenshot. Identify if any Tier-1 situations are present:
- Cookie consent / GDPR banner with Accept/Dismiss button
- Browser notification permission popup
- Software update dialog (not system-level)
- "Save password?" browser prompt
- Advertisement overlay with clear close button

OUTPUT: JSON { "action_needed": bool, "situation": str,
               "element_text": str, "confidence": 0.0-1.0 }

If confidence < 0.8 → action_needed: false. When in doubt — do nothing.
```

**Privacy rules (enforced before any prompt is sent):**
- Sensitive screen detected → no screenshot taken, no API call
- Privacy mode ON → no screenshots ever
- Both checked per-tick, before every API call

---

## 9. Pattern Learning Prompts (Phase B)

No LLM prompts used in Phase B. Pattern detection is pure Python:
- observation count ≥ SUGGEST_THRESHOLD (5) → create suggested rule
- Classification reuses `security_classifier.classify_action()`
- Rules context injected into system prompt (Section 1) as plain text

---

## 10. First-Day Interview (Phase D)

No LLM prompts. The interview is a pure React form.
Answers are converted to:
- Active pattern rules (seeded directly without threshold)
- Memory facts (via `upsert_fact`)
- Security domain additions
- Privacy mode toggle

---

## Change Log

- **2026-05-27** — Phase A: browser_action, security classifier, ad-watcher JS
- **2026-05-27** — Phase B: pattern learning (no new prompts)
- **2026-05-27** — Phase C: vision layer — computer-use prompt, passive-watcher prompt
- **2026-05-27** — Phase D: first-day interview (no new prompts)
