"""
NOVA Screen Service
Takes a screenshot of Mr. V's Mac and analyses it using Groq's vision model.
No external dependencies — uses macOS built-in screencapture.
"""

import subprocess
import base64
import tempfile
import os
import asyncio
from typing import Optional


async def capture_screen() -> str:
    """
    Take a silent screenshot of the entire screen.
    Returns base64-encoded PNG string.
    Uses macOS built-in 'screencapture' — no install required.
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp_path = f.name

    try:
        # -x = silent (no camera shutter sound)
        # -C = include cursor
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                ["screencapture", "-x", "-C", tmp_path],
                check=True,
                timeout=8,
            )
        )

        with open(tmp_path, "rb") as f:
            raw = f.read()

        return base64.b64encode(raw).decode("utf-8")

    except FileNotFoundError:
        raise RuntimeError("screencapture not found. This only works on macOS.")
    except subprocess.TimeoutExpired:
        raise RuntimeError("Screenshot timed out.")
    except Exception as e:
        raise RuntimeError(f"Screenshot failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


async def analyze_screen(groq_client, question: Optional[str] = None) -> str:
    """
    Take a screenshot and analyse it using Groq's vision model.
    Returns NOVA's description of what's on screen.
    """
    if not groq_client:
        return "Groq client not initialised — check your API key, Mr. V."

    # Take the screenshot
    screenshot_b64 = await capture_screen()

    # Build the question
    if question:
        prompt = (
            f"You are looking at Mr. V's screen. {question}\n\n"
            "Be specific and useful. If you see code, read it. If you see errors, flag them. "
            "If you see emails or documents, summarise the key content."
        )
    else:
        prompt = (
            "Describe exactly what's on Mr. V's screen right now. "
            "Include: which app is open, what content is visible, any errors or alerts, "
            "and anything you think he should know about. Be concise but complete."
        )

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, lambda: groq_client.chat.completions.create(
        model="llama-3.2-11b-vision-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{screenshot_b64}"
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        max_tokens=1024,
        temperature=0.3,
    ))

    return response.choices[0].message.content
