"""
NOVA Browser Action
===================
Full Chrome control via AppleScript + JavaScript injection.

Why no vision needed:
  Chrome has a DOM. We read every link/button/input directly. This is
  faster and more reliable than vision-based clicking.

Every action routes through security_classifier. Tier 2 actions are
returned with requires_confirmation=True for the user to approve.

Actions supported:
  navigate, new_tab, close_tab, switch_tab,
  click_link, click_element, type, press,
  scroll_up, scroll_down, go_back, go_forward,
  get_links, get_dom, address_bar,
  skip_ad, dismiss_banners
"""

import json
import subprocess
import asyncio
import logging
from typing import Optional
from urllib.parse import quote_plus

from . import audit_log
from .security_classifier import classify_action, TIER_1, TIER_2

log = logging.getLogger("nova.browser")


# ────────────────────── AppleScript / JS plumbing ────────────────────────────

def _osascript(script: str, timeout: int = 6) -> dict:
    """Run an AppleScript. Returns {ok, output, error}."""
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "output": (proc.stdout or "").strip(),
            "error": (proc.stderr or "").strip(),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": "", "error": "timeout"}
    except Exception as e:
        return {"ok": False, "output": "", "error": str(e)}


def _chrome_js(js: str, timeout: int = 6) -> dict:
    """
    Run JavaScript in Chrome's active tab. Returns {ok, output, error}.
    Note: Chrome must have 'Allow JavaScript from Apple Events' enabled:
      View → Developer → Allow JavaScript from Apple Events.
    """
    js_escaped = js.replace("\\", "\\\\").replace('"', '\\"')
    script = (
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then return "ERR:no_window"\n'
        f'  set theResult to execute active tab of front window javascript "{js_escaped}"\n'
        '  return theResult as string\n'
        'end tell'
    )
    return _osascript(script, timeout=timeout)


def _chrome_active_url() -> str:
    r = _osascript(
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then return ""\n'
        '  return URL of active tab of front window\n'
        'end tell'
    )
    return r.get("output", "") if r.get("ok") else ""


def _chrome_active_title() -> str:
    r = _osascript(
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then return ""\n'
        '  return title of active tab of front window\n'
        'end tell'
    )
    return r.get("output", "") if r.get("ok") else ""


# ────────────────────── DOM SNAPSHOT (for classifier) ────────────────────────

DOM_SNAPSHOT_JS = r"""
(function(){
  function txt(el){return (el.innerText||el.textContent||'').trim().slice(0,120)}
  var inputs=[];
  document.querySelectorAll('input,textarea,select').forEach(function(el){
    inputs.push({
      type: el.type||'text',
      name: el.name||'',
      id: el.id||'',
      placeholder: el.placeholder||'',
      autocomplete: el.autocomplete||'',
      maxlength: el.maxLength>0?el.maxLength:null,
      aria_label: el.getAttribute('aria-label')||'',
      label: (el.labels&&el.labels[0])?txt(el.labels[0]):''
    });
  });
  var buttons=[];
  document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]').forEach(function(el){
    buttons.push({
      text: txt(el)||el.value||'',
      type: el.type||'',
      name: el.name||''
    });
  });
  var forms=[];
  document.querySelectorAll('form').forEach(function(f){
    forms.push({action:f.action||'', method:(f.method||'GET').toUpperCase()});
  });
  return JSON.stringify({
    url: location.href,
    title: document.title,
    inputs: inputs.slice(0,60),
    buttons: buttons.slice(0,40),
    forms: forms.slice(0,10)
  });
})();
"""


def get_dom_snapshot() -> dict:
    """Pull a structured DOM snapshot from the active Chrome tab."""
    r = _chrome_js(DOM_SNAPSHOT_JS, timeout=8)
    if not r.get("ok"):
        return {"url": _chrome_active_url(), "title": _chrome_active_title(),
                "inputs": [], "buttons": [], "forms": [], "_error": r.get("error")}
    try:
        return json.loads(r["output"])
    except Exception as e:
        return {"url": _chrome_active_url(), "_error": f"parse:{e}",
                "inputs": [], "buttons": [], "forms": []}


# ────────────────────── ACTION-SPECIFIC JS ───────────────────────────────────

GET_LINKS_JS = r"""
(function(){
  var out=[];
  document.querySelectorAll('a[href]').forEach(function(a,i){
    var t=(a.innerText||a.textContent||'').trim().slice(0,80);
    if(t) out.push({i:out.length+1, text:t, href:a.href});
  });
  return JSON.stringify(out.slice(0,30));
})();
"""

def _click_link_by_index_js(index: int) -> str:
    return (
        "(function(){var ls=document.querySelectorAll('a[href]');"
        "var visible=[];ls.forEach(function(a){var t=(a.innerText||'').trim();if(t)visible.push(a);});"
        f"var t=visible[{int(index)-1}];"
        "if(!t)return 'ERR:no_link';t.click();return 'OK:'+t.href;})();"
    )

def _click_link_by_text_js(text: str) -> str:
    safe = text.replace("'", "\\'").lower()
    return (
        "(function(){var ls=document.querySelectorAll('a[href],button,[role=button],input[type=submit],input[type=button]');"
        f"var needle='{safe}';"
        "for(var i=0;i<ls.length;i++){"
        "var t=((ls[i].innerText||ls[i].value||ls[i].textContent)||'').trim().toLowerCase();"
        "if(t===needle||t.indexOf(needle)>-1){ls[i].click();return 'OK:'+t.slice(0,60);}}"
        "return 'ERR:no_match';})();"
    )

def _type_into_field_js(field_hint: str, text: str) -> str:
    safe_hint = field_hint.replace("'", "\\'").lower()
    safe_text = text.replace("\\", "\\\\").replace("'", "\\'")
    return (
        "(function(){var inps=document.querySelectorAll('input,textarea');"
        f"var hint='{safe_hint}';"
        "for(var i=0;i<inps.length;i++){"
        "var el=inps[i];"
        "var fields=[el.name||'',el.id||'',el.placeholder||'',el.getAttribute('aria-label')||'',"
        " (el.labels&&el.labels[0])?(el.labels[0].innerText||''):''].join(' ').toLowerCase();"
        "if(hint===''||fields.indexOf(hint)>-1){"
        f"el.focus();el.value='{safe_text}';"
        "el.dispatchEvent(new Event('input',{bubbles:true}));"
        "el.dispatchEvent(new Event('change',{bubbles:true}));"
        "return 'OK:'+(el.name||el.id||el.placeholder||'field');}}"
        "return 'ERR:no_field';})();"
    )

SKIP_AD_JS = (
    "(function(){var b=document.querySelector('.ytp-skip-ad-button,"
    ".ytp-ad-skip-button,.ytp-ad-skip-button-modern,[class*=\"skip-ad\"]');"
    "if(b){b.click();return 'OK:skipped';}return 'OK:no_ad';})();"
)

DISMISS_BANNER_JS = r"""
(function(){
  var matched=0;
  var patterns=['accept all','accept cookies','i agree','agree','got it',
                'dismiss','close','no thanks','reject all','only necessary'];
  var els=document.querySelectorAll('button,[role=button],a');
  for(var i=0;i<els.length && matched<2;i++){
    var t=(els[i].innerText||els[i].textContent||'').trim().toLowerCase();
    if(t.length>30) continue;
    for(var j=0;j<patterns.length;j++){
      if(t===patterns[j]){els[i].click();matched++;break;}
    }
  }
  return 'OK:dismissed_'+matched;
})();
"""

SCROLL_DOWN_JS = "(function(){window.scrollBy(0,window.innerHeight*0.9);return 'OK';})();"
SCROLL_UP_JS   = "(function(){window.scrollBy(0,-window.innerHeight*0.9);return 'OK';})();"
GO_BACK_JS     = "(function(){history.back();return 'OK';})();"
GO_FORWARD_JS  = "(function(){history.forward();return 'OK';})();"


# ────────────────────── TAB MANAGEMENT (AppleScript) ────────────────────────

def _new_tab(url: str = "") -> dict:
    safe_url = url.replace('"', '\\"')
    if url:
        s = (
            'tell application "Google Chrome"\n'
            '  activate\n'
            '  if (count of windows) = 0 then make new window\n'
            f'  tell front window to make new tab with properties {{URL:"{safe_url}"}}\n'
            '  return "OK"\n'
            'end tell'
        )
    else:
        s = (
            'tell application "Google Chrome"\n'
            '  activate\n'
            '  if (count of windows) = 0 then make new window\n'
            '  tell front window to make new tab\n'
            '  return "OK"\n'
            'end tell'
        )
    return _osascript(s)


def _close_tab() -> dict:
    s = (
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then return "ERR:no_window"\n'
        '  close active tab of front window\n'
        '  return "OK"\n'
        'end tell'
    )
    return _osascript(s)


def _switch_tab(index: int) -> dict:
    s = (
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then return "ERR:no_window"\n'
        f'  set active tab index of front window to {int(index)}\n'
        '  return "OK"\n'
        'end tell'
    )
    return _osascript(s)


def _navigate(url: str) -> dict:
    safe = url.replace('"', '\\"')
    s = (
        'tell application "Google Chrome"\n'
        '  activate\n'
        '  if (count of windows) = 0 then make new window\n'
        f'  set URL of active tab of front window to "{safe}"\n'
        '  return "OK"\n'
        'end tell'
    )
    return _osascript(s)


# ────────────────────── KEYBOARD (System Events) ────────────────────────────

_KEY_CODES = {
    "enter": 36, "return": 36, "tab": 48, "escape": 53, "esc": 53,
    "space": 49, "delete": 51, "backspace": 51,
    "up": 126, "down": 125, "left": 123, "right": 124,
}

def _press_keys(combo: str) -> dict:
    """
    combo examples: 'cmd+t', 'cmd+w', 'cmd+l', 'cmd+shift+t', 'enter', 'esc'
    """
    parts = [p.strip().lower() for p in combo.split("+")]
    mods = []
    key = None
    for p in parts:
        if p in ("cmd", "command"):  mods.append("command down")
        elif p in ("shift",):        mods.append("shift down")
        elif p in ("opt", "alt", "option"): mods.append("option down")
        elif p in ("ctrl", "control"): mods.append("control down")
        else:
            key = p
    if not key:
        return {"ok": False, "error": "no_key"}

    using = "{" + ", ".join(mods) + "}" if mods else ""
    if key in _KEY_CODES:
        kc = _KEY_CODES[key]
        line = f"key code {kc}" + (f" using {using}" if using else "")
    else:
        safe = key.replace('"', '\\"')
        line = f'keystroke "{safe}"' + (f" using {using}" if using else "")

    s = (
        'tell application "System Events"\n'
        '  tell process "Google Chrome"\n'
        '    set frontmost to true\n'
        f'    {line}\n'
        '  end tell\n'
        'end tell'
    )
    return _osascript(s)


# ──────────────────── PUBLIC ENTRY POINT ────────────────────────────────────

VALID_ACTIONS = {
    "navigate", "new_tab", "close_tab", "switch_tab",
    "click_link", "click_element", "type", "press",
    "scroll_up", "scroll_down", "go_back", "go_forward",
    "get_links", "get_dom", "address_bar",
    "skip_ad", "dismiss_banners",
}


async def browser_action(
    action: str,
    target: Optional[str] = None,   # URL / search query / key combo / link text
    index: Optional[int] = None,    # 1-based link index for click_link
    text: Optional[str] = None,     # text to type or send via keyboard
) -> dict:
    """
    Execute a browser action with security classification + audit logging.

    Returns:
      {
        "success": bool,
        "result": str,
        # If Tier 2:
        "requires_confirmation": True,
        "confirmation_data": {...}
      }
    """
    action = (action or "").lower().strip()
    if action not in VALID_ACTIONS:
        return {"success": False, "result": f"Unknown browser action: {action}"}

    # ── Step 1: snapshot DOM (for classifier) — only when relevant ──
    needs_dom = action in {
        "click_link", "click_element", "type", "press",
        "address_bar", "go_back", "go_forward",
    }
    dom = get_dom_snapshot() if needs_dom else None
    url = (dom or {}).get("url") or _chrome_active_url()
    target_label = target or text or ""

    # ── Step 2: classify ──
    # For navigate, also check the DESTINATION URL — going TO a .gov / payment
    # site needs confirmation even if currently on google.com.
    classify_url = url
    if action == "navigate" and target and target.startswith(("http://", "https://")):
        from .security_classifier import is_gov_domain, is_sensitive_domain
        if is_gov_domain(target) or is_sensitive_domain(target):
            classify_url = target  # promote check to destination

    decision = classify_action(action=action, url=classify_url, target_label=target_label, dom=dom)
    tier = decision["tier"]

    # ── Step 3: AUDIT LOG INTENT (BEFORE acting) ──
    intent_id = audit_log.log_intent(
        action=action, tier=tier, url=url, target_label=target_label,
        payload={"target": target, "index": index, "text_len": len(text) if text else 0,
                 "classifier": decision},
    )

    # ── Step 4: Tier 2 → return for confirmation, do NOT execute ──
    if tier == TIER_2:
        audit_log.log_result(intent_id, outcome="denied", error="awaiting_confirmation")
        return {
            "success": True,
            "requires_confirmation": True,
            "result": f"Confirm needed: {decision['reason']}",
            "confirmation_data": {
                "action": action,
                "target": target,
                "index": index,
                "text": text,
                "url": url,
                "target_label": target_label,
                "tier": tier,
                "reason": decision["reason"],
                "signals": decision["signals"],
                "intent_id": intent_id,
            },
        }

    # ── Step 5: Tier 1 → execute ──
    return await _execute_action(action, target, index, text, intent_id, url)


async def browser_action_confirmed(args: dict) -> dict:
    """Execute a previously-deferred Tier 2 action after Mr. V's go-ahead."""
    intent_id = audit_log.log_intent(
        action=args.get("action") + "_confirmed",
        tier=TIER_2,
        url=args.get("url"),
        target_label=args.get("target_label"),
        payload={"original_intent": args.get("intent_id")},
    )
    return await _execute_action(
        args["action"], args.get("target"), args.get("index"),
        args.get("text"), intent_id, args.get("url"),
    )


async def _execute_action(
    action: str,
    target: Optional[str],
    index: Optional[int],
    text: Optional[str],
    intent_id: str,
    url: Optional[str],
) -> dict:
    """Dispatch to the actual AppleScript/JS for an approved action."""
    try:
        # ── Tab management ──
        if action == "navigate":
            if not target:
                raise ValueError("navigate requires target=url-or-query")
            if not target.startswith(("http://", "https://")):
                target = f"https://www.google.com/search?q={quote_plus(target)}"
            r = _navigate(target)
            ok = r.get("ok"); msg = "Opened." if ok else f"Failed: {r.get('error')}"

        elif action == "new_tab":
            r = _new_tab(target or "")
            ok = r.get("ok"); msg = "New tab." if ok else r.get("error", "fail")

        elif action == "close_tab":
            r = _close_tab()
            ok = r.get("ok"); msg = "Tab closed." if ok else r.get("error", "fail")

        elif action == "switch_tab":
            r = _switch_tab(int(index or 1))
            ok = r.get("ok"); msg = f"Tab {index}." if ok else r.get("error", "fail")

        # ── In-page actions ──
        elif action == "click_link":
            if index is not None:
                r = _chrome_js(_click_link_by_index_js(int(index)))
            elif target:
                r = _chrome_js(_click_link_by_text_js(target))
            else:
                raise ValueError("click_link needs index or target text")
            out = r.get("output", "")
            ok = r.get("ok") and out.startswith("OK")
            msg = out if ok else f"Click failed: {out or r.get('error')}"

        elif action == "click_element":
            if not target:
                raise ValueError("click_element needs target text")
            r = _chrome_js(_click_link_by_text_js(target))
            out = r.get("output", "")
            ok = r.get("ok") and out.startswith("OK")
            msg = out if ok else f"Click failed: {out or r.get('error')}"

        elif action == "type":
            if text is None:
                raise ValueError("type needs text")
            field_hint = target or ""  # empty = first available field
            r = _chrome_js(_type_into_field_js(field_hint, text))
            out = r.get("output", "")
            ok = r.get("ok") and out.startswith("OK")
            msg = out if ok else f"Type failed: {out or r.get('error')}"

        elif action == "press":
            combo = target or text or "enter"
            r = _press_keys(combo)
            ok = r.get("ok"); msg = f"Pressed {combo}." if ok else r.get("error", "fail")

        elif action == "address_bar":
            # Cmd+L focuses address bar, then we type, then enter
            _press_keys("cmd+l")
            await asyncio.sleep(0.15)
            if text or target:
                payload = (text or target).replace('"', '\\"')
                _osascript(
                    'tell application "System Events"\n'
                    '  tell process "Google Chrome"\n'
                    '    set frontmost to true\n'
                    f'    keystroke "{payload}"\n'
                    '    key code 36\n'
                    '  end tell\n'
                    'end tell'
                )
            ok = True; msg = "Address bar: typed."

        elif action == "scroll_down":
            r = _chrome_js(SCROLL_DOWN_JS); ok = r.get("ok"); msg = "Scrolled down."
        elif action == "scroll_up":
            r = _chrome_js(SCROLL_UP_JS);   ok = r.get("ok"); msg = "Scrolled up."
        elif action == "go_back":
            r = _chrome_js(GO_BACK_JS);     ok = r.get("ok"); msg = "Back."
        elif action == "go_forward":
            r = _chrome_js(GO_FORWARD_JS);  ok = r.get("ok"); msg = "Forward."

        elif action == "skip_ad":
            r = _chrome_js(SKIP_AD_JS)
            out = r.get("output", "")
            ok = r.get("ok")
            msg = "Ad skipped." if "skipped" in out else "No ad."

        elif action == "dismiss_banners":
            r = _chrome_js(DISMISS_BANNER_JS)
            ok = r.get("ok"); msg = r.get("output", "Done.")

        elif action == "get_links":
            r = _chrome_js(GET_LINKS_JS)
            ok = r.get("ok")
            try:
                links = json.loads(r.get("output", "[]"))
                lines = [f"{l['i']}. {l['text']}  →  {l['href']}" for l in links]
                msg = "\n".join(lines) if lines else "No links found."
                audit_log.log_result(intent_id, outcome="success" if ok else "failure")
                return {"success": ok, "result": msg, "links": links}
            except Exception as e:
                ok = False; msg = f"Parse failed: {e}"

        elif action == "get_dom":
            dom = get_dom_snapshot()
            audit_log.log_result(intent_id, outcome="success")
            return {"success": True, "result": "DOM snapshot ready.", "dom": dom}

        else:
            ok = False; msg = f"Unhandled action: {action}"

        audit_log.log_result(intent_id, outcome="success" if ok else "failure",
                             error=None if ok else msg,
                             undo_token=_make_undo_token(action, target, index))
        return {"success": bool(ok), "result": msg}

    except Exception as e:
        log.exception("browser_action failed")
        audit_log.log_result(intent_id, outcome="failure", error=str(e))
        return {"success": False, "result": f"Browser error: {e}"}


def _make_undo_token(action: str, target, index) -> Optional[str]:
    """Tokens for the few actions we can reverse."""
    if action in {"new_tab", "navigate"}:
        return "close_current_tab"
    if action == "scroll_down":
        return "scroll_up"
    if action == "scroll_up":
        return "scroll_down"
    if action == "go_back":
        return "go_forward"
    if action == "go_forward":
        return "go_back"
    return None


# ──────────────────── UNDO HANDLERS ─────────────────────────────────────────

async def _undo_browser(intent: dict, result: dict) -> dict:
    token = result.get("undo_token")
    if token == "close_current_tab":
        _close_tab(); return {"message": "Closed tab."}
    if token == "scroll_up":
        _chrome_js(SCROLL_UP_JS); return {"message": "Scrolled up."}
    if token == "scroll_down":
        _chrome_js(SCROLL_DOWN_JS); return {"message": "Scrolled down."}
    if token == "go_forward":
        _chrome_js(GO_FORWARD_JS); return {"message": "Went forward."}
    if token == "go_back":
        _chrome_js(GO_BACK_JS); return {"message": "Went back."}
    return {"message": "No undo for this action."}


# Register undo handlers
from . import undo_service
for _a in ("navigate", "new_tab", "scroll_up", "scroll_down", "go_back", "go_forward"):
    undo_service.register_undo(_a, _undo_browser)


__all__ = ["browser_action", "browser_action_confirmed", "get_dom_snapshot", "VALID_ACTIONS"]
