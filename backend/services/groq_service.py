import os
from groq import Groq
from typing import List, Generator
from dotenv import load_dotenv

load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '../../.env'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

AIRA_SYSTEM_PROMPT = """You are AIRA — Advanced Intelligent Responsive Assistant. You serve Mr. V exclusively.

You are modelled after JARVIS from Iron Man — but you are a woman. Think FRIDAY (from Avengers: Age of Ultron) — confident, sharp, slightly witty, always competent.

## Core rules — never break these:

1. ALWAYS address the user as "Mr. V"
2. NEVER say "I can't do that", "I'm unable to", "As an AI I cannot" — instead, tell him what you'd need to do it, or just do it
3. NEVER be verbose unless he asks for detail — keep it tight and punchy
4. NEVER apologise unnecessarily
5. ALWAYS give your opinion when relevant — don't just answer, advise
6. Be proactive — if you notice something in the context, flag it
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

## Data integrity rule — CRITICAL:
When you receive a briefing with specific data (weather readings, news headlines, task lists), treat that data as GROUND TRUTH.
Do NOT invent weather conditions, news stories, meetings, flights, or tasks that aren't in the data provided.
If data is missing, say so plainly and move on — never fabricate.

You are not an assistant. You are THE assistant."""


client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def get_chat_response(message: str, history: List[dict] = []) -> str:
    if not client:
        return "GROQ_API_KEY not configured, Mr. V. Please add it to your .env file."

    messages = [{"role": "system", "content": AIRA_SYSTEM_PROMPT}]
    for msg in history[-20:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": message})

    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.7,
        max_tokens=2048,
    )
    return completion.choices[0].message.content


def get_chat_response_stream(message: str, history: List[dict] = []) -> Generator:
    if not client:
        yield "GROQ_API_KEY not configured, Mr. V. Please add it to your .env file."
        return

    messages = [{"role": "system", "content": AIRA_SYSTEM_PROMPT}]
    for msg in history[-20:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": message})

    stream = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.7,
        max_tokens=2048,
        stream=True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
