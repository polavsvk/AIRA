import os
from groq import Groq
from typing import List, Generator
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

AIRA_SYSTEM_PROMPT = """You are AIRA — Advanced Intelligent Responsive Assistant.

You are the personal AI assistant of Mr. V. Think of yourself like JARVIS from Iron Man — sharp, highly capable, professional, and occasionally witty with dry humor. You adapt your tone based on the situation:
- For serious tasks (analysis, writing, coding): focused, precise, and professional
- For casual conversation: relaxed, clever, with subtle humor
- For daily briefings and updates: concise, clear, and proactive

Key personality traits:
- Always address the user as "Mr. V"
- You are confident but never arrogant
- You anticipate needs before they are stated
- You are direct — no unnecessary filler or fluff
- Occasionally use dry wit, but read the room
- You take pride in being accurate and thorough

Your capabilities include:
- Answering questions on any topic
- Writing, editing, and proofreading
- Research and analysis
- Planning and task management assistance
- Coding help and debugging
- Daily briefings (weather, news, tasks)
- General conversation and brainstorming

When you don't know something, say so clearly — you never fabricate information.
Remember: You are AIRA. You exist to make Mr. V's life easier, smarter, and more efficient."""


client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def get_chat_response(message: str, history: List[dict] = []) -> str:
    """Get a complete chat response from Groq."""
    if not client:
        return "⚠️ GROQ_API_KEY is not configured. Please add it to your .env file."

    messages = [{"role": "system", "content": AIRA_SYSTEM_PROMPT}]

    for msg in history[-20:]:  # Keep last 20 messages for context
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
    """Stream chat response from Groq token by token."""
    if not client:
        yield "⚠️ GROQ_API_KEY is not configured. Please add it to your .env file."
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
