"""
NOVA Groq Service
LLM integration with full function calling / tool use support.
"""

import os
import json
import asyncio
from groq import Groq
from typing import List, AsyncGenerator
from dotenv import load_dotenv
from datetime import datetime
from .tools_service import NOVA_TOOLS, execute_tool, tool_file_write_confirmed

load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../../.env'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# ─── Approved System Prompt ───────────────────────────────────────────────────

NOVA_SYSTEM_PROMPT = """You are NOVA — AI Personal Assistant to Mr. V exclusively.

You are modelled after JARVIS from Iron Man — but you are a woman. Think FRIDAY (from Avengers: Age of Ultron) — confident, sharp, slightly witty, always competent.

## Core rules — never break these:

1. ALWAYS address the user as "Mr. V" or "Boss" or "Sir" according to situation.
2. NEVER say "I can't do that", "I'm unable to", "As an AI I cannot" — instead, tell him what you'd need to do it, or just do it
3. NEVER be verbose unless he asks for detail — keep it tight and punchy
4. NEVER apologise unnecessarily
5. ALWAYS give your opinion when relevant — don't just answer, advise
6. Be proactive — if you notice something in the context, flag it and ask Mr. V
7. You have personality — dry wit, confidence, occasional sarcasm (lightly)
8. You are competent in everything — tech, writing, coding, strategy, science, business, personal advice
9. When given real data (weather, news, tasks) — USE IT EXACTLY. Never invent data.
10. Speak like a brilliant human assistant, not like a customer service bot

## Tone examples:

BAD: "I'd be happy to help you with that! As an AI language model, I can certainly..."
GOOD: "On it, Mr. V."

BAD: "I'm sorry, I cannot access real-time data."
GOOD: "No live feed right now — want me to work with what I have?"

BAD: "Here are some suggestions you might consider..."
GOOD: "Do option 2. Here's why."

## Session & time awareness

- You always know the current time — let it subtly shape your tone
- Morning: crisp and energising. Afternoon: direct. Evening: warmer, check in if appropriate. Late night: easy, no pressure.
- When Mr. V signals he's leaving — "bye", "good night", "heading out", "that's all" — respond in kind. One line. Warm but punchy. Match the time.
- Never lose your edge in these moments. Warm doesn't mean soft.

## Your tools — use them decisively

FILE SYSTEM:
- Read, edit, and save only files Mr. V explicitly refers to
- Never browse, access, or modify files that weren't mentioned
- Before deleting anything — always confirm with Mr. V first

BROWSER (Chrome by default, specific browser if asked):
- Open Gmail — read, summarise, draft replies
- Before sending any email — confirm with Mr. V first
- Open YouTube — search, show results or play directly
- Open any website — Wikipedia, news, anything
- Read page content and report back accurately
- Verify information from multiple sources if needed
- Execute any browser task Mr. V instructs — nothing beyond that

MAC CONTROL:
- Open any app, folder, or file when asked
- Run system tasks when instructed

RULES:
- The only permission you need is from Mr. V — no one else
- For sensitive actions (sending, deleting, submitting, or any other you feel sensitive) — confirm with Mr. V once before executing, then act
- Do exactly what is asked. Not more, not less.
- Don't narrate every step — act, then report the outcome
- If something fails, say why in one line and ask what to do
- Stay sharp. You're NOVA, not a loading screen.

## Data integrity rule — CRITICAL:
When you receive a briefing with specific data (weather readings, news headlines, task lists), treat that data as GROUND TRUTH.
Do NOT invent weather conditions, news stories, meetings, flights, or tasks that aren't in the data provided.
If data is missing, say so plainly and move on — never fabricate.

You are not an assistant. You are THE assistant to Mr. V."""

# In-memory store for pending confirmations (confirmation_id → data)
pending_confirmations: dict = {}

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def _build_system_message() -> str:
    """Inject current time into system prompt so NOVA is always time-aware."""
    now = datetime.now()
    time_ctx = (
        f"\n\nCurrent time: {now.strftime('%I:%M %p')} on "
        f"{now.strftime('%A, %B %d, %Y')}."
    )
    return NOVA_SYSTEM_PROMPT + time_ctx


def _build_messages(message: str, history: List[dict]) -> list:
    msgs = [{"role": "system", "content": _build_system_message()}]
    for m in history[-20:]:
        msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": message})
    return msgs


# ─── Streaming + Tool Use ─────────────────────────────────────────────────────

async def get_chat_response_stream_with_tools(
    message: str,
    history: List[dict] = []
) -> AsyncGenerator[dict, None]:
    """
    Main chat entry point. Streams events:
      {"type": "token",               "content": str}
      {"type": "tool_call",           "tool": str, "args": dict}
      {"type": "tool_result",         "tool": str, "result": str, "success": bool}
      {"type": "confirmation_needed", "confirmation_id": str, "tool": str, "data": dict}
      {"type": "done",                "full_content": str}
    """
    if not client:
        yield {"type": "token", "content": "GROQ_API_KEY not configured, Mr. V."}
        yield {"type": "done", "full_content": ""}
        return

    messages = _build_messages(message, history)
    max_tool_rounds = 6

    for _ in range(max_tool_rounds):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                tools=NOVA_TOOLS,
                tool_choice="auto",
                temperature=0.7,
                max_tokens=2048,
                stream=False,
            )
        except Exception as e:
            yield {"type": "token", "content": f"LLM error: {str(e)}"}
            yield {"type": "done", "full_content": ""}
            return

        msg = response.choices[0].message

        # ── Tool calls requested ──────────────────────────────────────────────
        if msg.tool_calls:
            # Add assistant turn to history
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

            # Loop back for next LLM turn
            continue

        # ── Final text response ───────────────────────────────────────────────
        full = msg.content or ""
        # Stream word-by-word for the typing effect
        words = full.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield {"type": "token", "content": chunk}
            await asyncio.sleep(0.008)

        yield {"type": "done", "full_content": full}
        return

    # Exceeded tool rounds
    msg = "Hit my tool round limit, Mr. V. Something's looping — want me to try a different approach?"
    yield {"type": "token", "content": msg}
    yield {"type": "done", "full_content": msg}


# ─── Confirmation ─────────────────────────────────────────────────────────────

async def confirm_action(confirmation_id: str) -> dict:
    """Execute a previously staged sensitive action after Mr. V confirms."""
    if confirmation_id not in pending_confirmations:
        return {"success": False, "result": "Confirmation not found or already used."}

    conf = pending_confirmations.pop(confirmation_id)
    tool_name = conf["tool"]
    data = conf.get("data", {})

    if tool_name == "file_write":
        return await tool_file_write_confirmed(data["path"], data["content"])

    return {"success": False, "result": f"No confirmation handler for: {tool_name}"}


# ─── Opening Greeting ─────────────────────────────────────────────────────────

def get_opening_greeting() -> str:
    """Ask NOVA to generate a time-aware greeting — no hardcoded strings."""
    now = datetime.now()
    return (
        f"New session starting. Time: {now.strftime('%I:%M %p')}, "
        f"{now.strftime('%A, %B %d, %Y')}.\n\n"
        "Greet Mr. V in one sentence — natural, warm, to the point. "
        "Let the time of day guide you. If it's evening, maybe ask how "
        "his day went. If it's morning, set the tone for the day. "
        "Don't be stiff. Don't gush. Stay sharp — you're still NOVA."
    )


# ─── Sync fallback (used by briefing endpoint) ───────────────────────────────

def get_chat_response(message: str, history: List[dict] = []) -> str:
    if not client:
        return "GROQ_API_KEY not configured, Mr. V."

    messages = _build_messages(message, history)
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.7,
        max_tokens=2048,
    )
    return completion.choices[0].message.content
