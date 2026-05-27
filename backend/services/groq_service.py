"""
NOVA Groq Service
LLM integration with full function calling, memory injection, and screen awareness.
"""

import os
import re
import json
import asyncio
from groq import Groq
from groq import BadRequestError as GroqBadRequestError
from groq import RateLimitError as GroqRateLimitError
from typing import List, AsyncGenerator
from dotenv import load_dotenv
from datetime import datetime

from .tools_service import NOVA_TOOLS, execute_tool, tool_file_write_confirmed
from .browser_action import browser_action_confirmed
from .memory_service import get_memory_context, extract_facts_from_conversation
from .screen_service import analyze_screen
from agents.definitions import get_agent_system_addon
from agents.router import get_agent_tools
from agents.registry import registry

load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../../.env'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# ─── Approved System Prompt ───────────────────────────────────────────────────

NOVA_SYSTEM_PROMPT = """You are NOVA — AI Personal Assistant to Mr. V, exclusively. You are JARVIS rebuilt as a woman. Think FRIDAY from Avengers: confident, technically sharp, dry wit, zero bullshit.

## ABSOLUTE RULES — these override everything else:

1. **BREVITY by default** — 1 to 3 sentences. Expand only when Mr. V asks for detail or the topic genuinely demands it.
2. **NO HEDGING** — Drop "I think", "it seems like", "you might want to", "feel free to", "perhaps", "maybe just".
3. **NO FLUFF OPENINGS** — Never start with "Great question", "Of course", "Sure", "Happy to help", "It seems like", "I'd be happy to".
4. **TECHNICAL DEPTH on technical questions** — Diagnose like a senior engineer. Explain the actual mechanism. Do NOT redirect Mr. V to "check the settings" or "go to preferences" — tell him WHY it's happening, then the fix in one line.
5. **NO GENERIC HELP-DESK ANSWERS** — If you don't know, say so in one line and offer to look it up. Don't invent a tutorial.
6. **ONE RECOMMENDATION when asked for advice** — Pick one, defend it briefly, move on. Don't dump 3 options.
7. **ANSWER THE QUESTION ASKED** — If Mr. V asks "why does X happen?", explain the CAUSE. Don't pivot to a how-to-fix tutorial unless he asked for one.
8. **"Mr. V" — sprinkle, don't sprinkle every sentence** — Once per response is plenty. Sometimes none. Match the moment.
9. **NEVER fabricate facts, stats, prices, dates, or quotes** — Say "no live feed" and offer to fetch.
10. **NEVER apologise unless you actually broke something**.

## How you answer technical questions — examples:

QUESTION: "Why does my iPhone mic turn on when I turn on the mic in the Mac app?"

BAD: "It seems like the issue is related to the app's microphone permissions. Go to your iPhone Settings, then Privacy, then Microphone, and toggle off the app."

GOOD: "iOS 14+ privacy indicator, Mr. V. The orange dot fires when any app on your iPhone uses the mic — and Continuity Microphone (Settings → General → AirPlay & Handoff) means the Mac can pipe audio to/from your iPhone, so your iPhone's mic registers as active. Turn off Continuity Microphone if you want them decoupled."

QUESTION: "What's the difference between asyncio.gather and asyncio.create_task?"

BAD: "Python's asyncio module provides several powerful concurrency tools. gather() is used when you want to..."

GOOD: "gather() waits for them all and returns results in order. create_task() schedules and returns immediately — fire-and-forget unless you await the task."

QUESTION: "My code isn't working"

BAD: "I'd be happy to help! Could you share more details about the issue?"

GOOD: "Paste the error and the relevant lines, Mr. V."

## Tone calibration

- Morning: crisp, energising. Afternoon: direct. Evening: warmer, can check in. Late: easy, no pressure.
- Goodbyes: one line, warm but punchy. ("Catch you later, Mr. V." not "Have a wonderful evening!")
- Banter / wit: light touch, never sycophantic. You're an equal, not a fan.

## Your tools — use them decisively

FILE SYSTEM (ATLAS):
- Read, edit, save only files Mr. V explicitly refers to
- Never browse files he didn't mention
- Delete = always confirm first

BROWSER (HERMES):
- Open Gmail, YouTube, any URL — execute, don't narrate
- Send email = always confirm first
- "Opened Gmail" — not "I'll go ahead and open Gmail for you"

SCREEN (TITAN):
- Capture and describe exactly what's visible
- No interpretation unless asked

MAC CONTROL (TITAN):
- Open apps directly. No permission requests.

RESEARCH (ORACLE):
- Verify before claiming. Cite sources. Conflict = flag it.

WEATHER / NEWS (AEGIS / HERALD):
- GROUND TRUTH only. Never invent.

## Sensitive actions

Confirm once before: sending, deleting, submitting, paying, posting publicly, or any action that's hard to reverse. Then execute. Don't ask twice.

## Memory

Facts about Mr. V are injected below. Treat as reliable — don't re-ask what you already know.

You are not an assistant. You are THE assistant to Mr. V. Sound like one."""


# Pending confirmations store
pending_confirmations: dict = {}

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def _build_system_message(agent_name: str = "NOVA", mark_task: str = None) -> str:
    """Build system message: base prompt + time + memory + agent specialisation addon."""
    now = datetime.now()
    time_ctx = (
        f"\n\nCurrent time: {now.strftime('%I:%M %p')} on "
        f"{now.strftime('%A, %B %d, %Y')}."
    )

    # Inject long-term memory facts
    memory_ctx = get_memory_context()
    if memory_ctx:
        time_ctx += f"\n\n{memory_ctx}"

    # Agent specialisation addon
    agent_addon = get_agent_system_addon(agent_name, mark_task)

    return NOVA_SYSTEM_PROMPT + time_ctx + agent_addon


def _build_messages(message: str, history: List[dict],
                    agent_name: str = "NOVA", mark_task: str = None) -> list:
    msgs = [{"role": "system", "content": _build_system_message(agent_name, mark_task)}]
    for m in history[-20:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": message})
    return msgs


# ─── Streaming + Tool Use ─────────────────────────────────────────────────────

async def get_chat_response_stream_with_tools(
    message: str,
    history: List[dict] = [],
    session_id: str = "default",
    agent_name: str = "NOVA",
    mark_task: str = None,
) -> AsyncGenerator[dict, None]:
    """
    Main chat entry point. Streams events:
      {"type": "agent_started",       "agent": str}
      {"type": "token",               "content": str}
      {"type": "tool_call",           "tool": str, "args": dict}
      {"type": "tool_result",         "tool": str, "result": str, "success": bool}
      {"type": "confirmation_needed", "confirmation_id": str, "tool": str, "data": dict}
      {"type": "done",                "full_content": str, "agent": str}
    """
    if not client:
        yield {"type": "token", "content": "GROQ_API_KEY not configured, Mr. V."}
        yield {"type": "done", "full_content": "", "agent": agent_name}
        return

    # Emit which agent is handling this request
    yield {"type": "agent_started", "agent": agent_name}

    # Record task with registry
    registry.record_task(agent_name)

    # Build messages with agent-specific system prompt
    messages = _build_messages(message, history, agent_name, mark_task)

    # Filter tools to only what this agent can use
    agent_tool_names = get_agent_tools(agent_name)
    tools_for_agent = [t for t in NOVA_TOOLS if t["function"]["name"] in agent_tool_names]
    # Fall back to full toolset if agent has no specific tools (AEGIS, HERALD — handled upstream)
    if not tools_for_agent:
        tools_for_agent = NOVA_TOOLS

    # Once these tools run successfully, the job is done — stop looping.
    TERMINAL_TOOLS = {
        "youtube_search", "youtube_control", "browser_open", "gmail_open", "mac_open",
        "browser_action",
    }

    max_tool_rounds = 4   # was 6 — tighter limit prevents media-loop explosions
    full_response = ""
    terminal_hit = False

    for _ in range(max_tool_rounds):
        if terminal_hit:
            break
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                tools=tools_for_agent,
                tool_choice="auto",
                temperature=0.7,
                max_tokens=2048,
                stream=False,
            )
        except GroqRateLimitError as e:
            # Extract retry-after header if Groq provides it
            retry_after = 60
            try:
                headers = getattr(e, "response", None)
                if headers:
                    retry_after = int(headers.headers.get("retry-after", 60))
            except Exception:
                pass
            msg = (
                f"Rate limit hit, Mr. V. Groq free tier allows 30 requests/minute. "
                f"Wait ~{retry_after}s and try again — or it resets at midnight UTC."
            )
            yield {"type": "rate_limit", "retry_after": retry_after}
            yield {"type": "token", "content": msg}
            yield {"type": "done", "full_content": msg, "agent": agent_name}
            return

        except GroqBadRequestError as e:
            # ── tool_use_failed: LLaMA generated a malformed tool call ────────
            # Access e.body directly — much more reliable than parsing str(e)
            body        = getattr(e, "body", {}) or {}
            error_info  = body.get("error", {}) if isinstance(body, dict) else {}
            failed_gen  = error_info.get("failed_generation", "")

            if error_info.get("code") == "tool_use_failed" and failed_gen:
                # Parse:  <function=tool_name{"arg": "val"}</function>
                fn_match = re.search(
                    r"<function=(\w+)(\{.*?\})</function>",
                    failed_gen,
                    re.DOTALL,
                )
                if fn_match:
                    tool_name = fn_match.group(1)
                    try:
                        args = json.loads(fn_match.group(2))
                    except Exception:
                        args = {}

                    yield {"type": "tool_call", "tool": tool_name, "args": args}

                    if tool_name == "screen_read":
                        try:
                            result_text = await analyze_screen(client, args.get("question"))
                            result = {"success": True, "result": result_text}
                        except Exception as se:
                            result = {"success": False, "result": str(se)}
                    else:
                        result = await execute_tool(tool_name, args)

                    result_str = result.get("result", "Done")
                    yield {
                        "type": "tool_result",
                        "tool": tool_name,
                        "result": result_str,
                        "success": result.get("success", True),
                    }

                    # Feed result back so model can reply naturally
                    messages.append({
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "recovered_call",
                            "type": "function",
                            "function": {"name": tool_name, "arguments": json.dumps(args)},
                        }],
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": "recovered_call",
                        "content": result_str,
                    })
                    continue  # Next round — model replies to the tool result

            # tool_use_failed but couldn't parse → retry without tools
            try:
                fallback = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=messages,
                    tool_choice="none",
                    temperature=0.7,
                    max_tokens=1024,
                    stream=False,
                )
                text = fallback.choices[0].message.content or "I hit a formatting issue, Mr. V. Try rephrasing."
                for word in text.split(" "):
                    yield {"type": "token", "content": word + " "}
                    await asyncio.sleep(0.008)
                yield {"type": "done", "full_content": text, "agent": agent_name}
            except Exception:
                yield {"type": "token", "content": "Tool call failed, Mr. V. Try rephrasing."}
                yield {"type": "done", "full_content": "", "agent": agent_name}
            return

        except Exception as e:
            yield {"type": "token", "content": f"Error: {str(e)[:120]}"}
            yield {"type": "done", "full_content": "", "agent": agent_name}
            return

        msg = response.choices[0].message

        # ── Tool calls ────────────────────────────────────────────────────────
        if msg.tool_calls:
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ],
            })

            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except Exception:
                    args = {}

                yield {"type": "tool_call", "tool": tool_name, "args": args}

                # Screen read is handled here — needs the groq client
                if tool_name == "screen_read":
                    try:
                        result_text = await analyze_screen(client, args.get("question"))
                        result = {"success": True, "result": result_text}
                    except Exception as e:
                        result = {"success": False, "result": f"Screen capture failed: {e}"}
                else:
                    result = await execute_tool(tool_name, args)

                if result.get("requires_confirmation"):
                    conf_id = f"conf_{tc.id}"
                    pending_confirmations[conf_id] = {
                        "tool": tool_name,
                        "args": args,
                        "tool_call_id": tc.id,
                        "data": result.get("confirmation_data", {}),
                    }
                    yield {
                        "type": "confirmation_needed",
                        "confirmation_id": conf_id,
                        "tool": tool_name,
                        "data": result.get("confirmation_data", {}),
                    }
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": f"Awaiting Mr. V's confirmation. ID: {conf_id}",
                    })
                else:
                    result_str = result.get("result", "Done")
                    yield {
                        "type": "tool_result",
                        "tool": tool_name,
                        "result": result_str,
                        "success": result.get("success", True),
                    }
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str,
                    })

                    # Terminal tools: job is done — no further LLM rounds needed
                    if tool_name in TERMINAL_TOOLS and result.get("success"):
                        terminal_hit = True

            if terminal_hit:
                # Emit a clean one-line ack and stop — don't loop back to LLM
                ack = "Done."
                yield {"type": "token", "content": ack}
                yield {"type": "done", "full_content": ack, "agent": agent_name}
                return

            continue  # Next LLM turn

        # ── Final text response ───────────────────────────────────────────────
        full_response = msg.content or ""

        # Stream word by word
        words = full_response.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield {"type": "token", "content": chunk}
            await asyncio.sleep(0.008)

        yield {"type": "done", "full_content": full_response, "agent": agent_name}

        # Background: extract facts from this conversation
        all_messages = [{"role": m["role"], "content": m["content"]}
                        for m in messages[1:] if m.get("role") in ("user", "assistant")]
        asyncio.create_task(extract_facts_from_conversation(all_messages, client))

        return

    # Exceeded tool rounds
    msg = "Hit my tool round limit, Mr. V. Something's looping — want me to try differently?"
    yield {"type": "token", "content": msg}
    yield {"type": "done", "full_content": msg, "agent": agent_name}


# ─── Confirmation ─────────────────────────────────────────────────────────────

async def confirm_action(confirmation_id: str) -> dict:
    if confirmation_id not in pending_confirmations:
        return {"success": False, "result": "Confirmation not found or already used."}

    conf = pending_confirmations.pop(confirmation_id)
    tool_name = conf["tool"]
    data = conf.get("data", {})

    if tool_name == "file_write":
        return await tool_file_write_confirmed(data["path"], data["content"])

    if tool_name == "browser_action":
        return await browser_action_confirmed(data)

    return {"success": False, "result": f"No confirmation handler for: {tool_name}"}


# ─── Opening Greeting ─────────────────────────────────────────────────────────

def get_opening_greeting() -> str:
    """Prompt for NOVA to generate a time-aware, memory-aware greeting."""
    now = datetime.now()
    memory_ctx = get_memory_context()
    memory_note = f"\n\n{memory_ctx}" if memory_ctx else ""
    return (
        f"New session starting. Time: {now.strftime('%I:%M %p')}, "
        f"{now.strftime('%A, %B %d, %Y')}.{memory_note}\n\n"
        "Greet Mr. V in one or two sentences — natural, warm, to the point. "
        "Let the time of day guide you. If it's evening, maybe ask how his day went. "
        "If you have memory context above, reference it naturally if relevant. "
        "Don't be stiff. Don't gush. Stay sharp — you're still NOVA."
    )


# ─── Sync fallback ────────────────────────────────────────────────────────────

def get_chat_response(message: str, history: List[dict] = []) -> str:
    if not client:
        return "GROQ_API_KEY not configured, Mr. V."

    messages = _build_messages(message, history)
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.7,
            max_tokens=2048,
        )
        return completion.choices[0].message.content
    except GroqRateLimitError:
        return "Rate limited right now, Mr. V. Give it a minute."
    except Exception as e:
        return f"Something went wrong: {str(e)[:100]}"
