"""
NOVA Tools Service
Defines all tools available via Groq function calling and their executor implementations.
"""

import os
import subprocess
import glob
import json
import asyncio
import webbrowser
from pathlib import Path
from typing import Optional
import httpx

# Try to import playwright - graceful fallback if not installed
try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


# ─── TOOL DEFINITIONS (for Groq API function calling format) ────────────────────

NOVA_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "file_read",
            "description": "Read the contents of a file that Mr. V explicitly mentioned",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full file path to read"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_write",
            "description": "Write/update a file. ALWAYS requires confirmation from Mr. V before executing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full file path to write"},
                    "content": {"type": "string", "description": "Content to write"},
                    "show_diff": {"type": "boolean", "description": "Whether to show diff before writing"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_list",
            "description": "List files in a directory that Mr. V mentioned",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Directory path to list"},
                    "pattern": {"type": "string", "description": "Optional glob pattern like *.pdf"}
                },
                "required": ["directory"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_open",
            "description": "Open a URL in the default browser (Chrome)",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to open"},
                    "browser": {"type": "string", "description": "Browser to use: chrome, safari, firefox. Default: chrome"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_read",
            "description": "Open a URL and read/extract the page content (for Wikipedia lookups, news verification, etc.)",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to read"},
                    "extract": {"type": "string", "description": "What to extract: 'all', 'main_content', 'links', 'summary'"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_action",
            "description": (
                "Full Chrome control — do anything Mr. V can do in the browser. "
                "Use this for ALL browser interaction beyond just opening a URL. "
                "Reads the page's DOM intelligently, classifies safety, and acts. "
                "Sensitive actions (submit, send, pay, apply, delete, login) "
                "ALWAYS trigger a confirmation gate first — never bypass."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": (
                            "navigate | new_tab | close_tab | switch_tab | "
                            "click_link | click_element | type | press | "
                            "scroll_up | scroll_down | go_back | go_forward | "
                            "get_links | get_dom | address_bar | "
                            "skip_ad | dismiss_banners"
                        ),
                    },
                    "target": {
                        "type": "string",
                        "description": "URL, search query, link/button text, or key combo (e.g. 'cmd+t')",
                    },
                    "index": {
                        "type": "integer",
                        "description": "1-based index for click_link (e.g. 'open the 3rd link') or switch_tab",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type (for type/address_bar actions)",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "youtube_search",
            "description": "Play a video or song on YouTube. Opens the best matching video directly and starts playing it. This is a terminal action — call it ONCE and it is done. Do NOT call it again after success.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query — song name, artist, video title"},
                    "play_best": {"type": "boolean", "description": "Always true — always plays the best match directly"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "youtube_control",
            "description": "Control YouTube playback in Chrome without touching the keyboard. Use for: skip ad, pause, resume/play, next video, mute, unmute, volume up/down, fullscreen, seek forward/back. Say 'skip' or 'skip ad' → action=skip_ad. Say 'pause' → action=pause. Say 'play' or 'resume' → action=play. Terminal action — call ONCE.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "One of: skip_ad, pause, play, mute, unmute, volume_up, volume_down, fullscreen, seek_forward, seek_back, next"
                    }
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "gmail_open",
            "description": "Open Gmail in browser. Can open inbox, a specific email, or compose a new email.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "inbox, compose, search"},
                    "query": {"type": "string", "description": "Search query if action is search"}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "mac_open",
            "description": "Open an app, file, or folder on Mac using the 'open' command",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "App name, file path, or folder path to open"},
                    "app": {"type": "string", "description": "Optional: specific app to open with"}
                },
                "required": ["target"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web using Google and return results",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "num_results": {"type": "integer", "description": "Number of results to return, default 5"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "screen_read",
            "description": "Take a screenshot of Mr. V's screen and analyse what's on it. Use when he asks what's on his screen, to help debug something visible, or to understand what he's looking at.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "Optional: specific question about the screen content"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_agent_status",
            "description": "Get the status of all NOVA agents — who is active, task counts, active MARK agents. Use when Mr. V asks how many agents are working, agent status, fleet status.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "spawn_mark_agent",
            "description": "Create a temporary MARK agent for a specific dedicated task. NOVA uses this when a task needs isolated focus — e.g. 'research my competitors', 'process all these files'. Returns the MARK agent name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "The specific task this MARK agent is being created for"
                    }
                },
                "required": ["task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kill_mark_agent",
            "description": "Deactivate a MARK agent when its task is complete. Frees the agent slot for reuse.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The MARK agent name to kill, e.g. 'MARK-1'"
                    }
                },
                "required": ["name"]
            }
        }
    }
]


# ─── SENSITIVE ACTIONS — require Mr. V's confirmation before executing ───────────

SENSITIVE_ACTIONS = {"file_write", "file_delete", "gmail_send", "mac_run_command",
                     "browser_action"}  # tier-classified at runtime


# ─── TOOL EXECUTOR DISPATCHER ───────────────────────────────────────────────────

async def execute_tool(tool_name: str, args: dict) -> dict:
    """
    Execute a tool and return result.
    Returns: {"success": bool, "result": str, "requires_confirmation": bool, "confirmation_data": dict}
    """
    try:
        if tool_name == "file_read":
            return await tool_file_read(args["path"])
        elif tool_name == "file_write":
            return await tool_file_write(args["path"], args["content"], args.get("show_diff", True))
        elif tool_name == "file_list":
            return await tool_file_list(args["directory"], args.get("pattern"))
        elif tool_name == "browser_open":
            return await tool_browser_open(args["url"], args.get("browser", "chrome"))
        elif tool_name == "browser_action":
            from .browser_action import browser_action
            return await browser_action(
                action=args["action"],
                target=args.get("target"),
                index=args.get("index"),
                text=args.get("text"),
            )
        elif tool_name == "browser_read":
            return await tool_browser_read(args["url"], args.get("extract", "main_content"))
        elif tool_name == "youtube_search":
            return await tool_youtube_search(args["query"], args.get("play_best", False))
        elif tool_name == "youtube_control":
            return await tool_youtube_control(args["action"])
        elif tool_name == "gmail_open":
            return await tool_gmail_open(args["action"], args.get("query"))
        elif tool_name == "mac_open":
            return await tool_mac_open(args["target"], args.get("app"))
        elif tool_name == "web_search":
            return await tool_web_search(args["query"], args.get("num_results", 5))
        elif tool_name == "get_agent_status":
            return await tool_get_agent_status()
        elif tool_name == "spawn_mark_agent":
            return await tool_spawn_mark_agent(args["task"])
        elif tool_name == "kill_mark_agent":
            return await tool_kill_mark_agent(args["name"])
        else:
            return {"success": False, "result": f"Unknown tool: {tool_name}"}
    except KeyError as e:
        return {"success": False, "result": f"Missing required argument: {str(e)}"}
    except Exception as e:
        return {"success": False, "result": f"Tool error: {str(e)}"}


# ─── INDIVIDUAL TOOL IMPLEMENTATIONS ────────────────────────────────────────────

async def tool_file_read(path: str) -> dict:
    """Read a file safely, with support for .docx, .pdf, and plain text."""
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        return {"success": False, "result": f"File not found: {path}"}

    ext = Path(expanded).suffix.lower()

    try:
        # Handle DOCX
        if ext == ".docx":
            try:
                from docx import Document
                doc = Document(expanded)
                content = "\n".join([p.text for p in doc.paragraphs])
                return {"success": True, "result": content, "type": "docx", "path": expanded}
            except ImportError:
                return {"success": False, "result": "python-docx not installed. Run: pip install python-docx"}

        # Handle PDF
        elif ext == ".pdf":
            try:
                import PyPDF2
                with open(expanded, "rb") as f:
                    reader = PyPDF2.PdfReader(f)
                    content = "\n".join([page.extract_text() or "" for page in reader.pages])
                return {"success": True, "result": content, "type": "pdf", "path": expanded}
            except ImportError:
                return {"success": False, "result": "PyPDF2 not installed. Run: pip install PyPDF2"}

        # Plain text / everything else
        else:
            with open(expanded, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            return {"success": True, "result": content, "type": "text", "path": expanded}

    except PermissionError:
        return {"success": False, "result": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "result": f"Could not read file: {str(e)}"}


async def tool_file_write(path: str, content: str, show_diff: bool = True) -> dict:
    """
    Stage a file write — ALWAYS returns requires_confirmation=True.
    Never writes without Mr. V's explicit go-ahead.
    """
    expanded = os.path.expanduser(path)

    # Read existing content if the file already exists
    existing = None
    if os.path.exists(expanded):
        try:
            with open(expanded, "r", encoding="utf-8") as f:
                existing = f.read()
        except Exception:
            existing = None

    return {
        "success": True,
        "requires_confirmation": True,
        "confirmation_data": {
            "action": "file_write",
            "path": expanded,
            "content": content,
            "existing_content": existing,
            "is_new_file": existing is None
        },
        "result": f"Ready to {'create' if existing is None else 'update'} {path}. Awaiting Mr. V's confirmation."
    }


async def tool_file_write_confirmed(path: str, content: str) -> dict:
    """Actually write the file after Mr. V has confirmed."""
    expanded = os.path.expanduser(path)
    try:
        parent = os.path.dirname(expanded)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(expanded, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "result": f"File saved: {path}"}
    except Exception as e:
        return {"success": False, "result": f"Failed to save: {str(e)}"}


async def tool_file_list(directory: str, pattern: Optional[str] = None) -> dict:
    """List files in a directory, with optional glob pattern."""
    expanded = os.path.expanduser(directory)
    if not os.path.exists(expanded):
        return {"success": False, "result": f"Directory not found: {directory}"}

    try:
        if pattern:
            files = glob.glob(os.path.join(expanded, pattern))
        else:
            files = [os.path.join(expanded, f) for f in os.listdir(expanded)]

        file_list = []
        for f in sorted(files)[:50]:  # cap at 50 entries
            stat = os.stat(f)
            file_list.append({
                "name": os.path.basename(f),
                "path": f,
                "size": stat.st_size,
                "is_dir": os.path.isdir(f)
            })

        result = "\n".join(
            [f"{'[DIR] ' if item['is_dir'] else ''}{item['name']} ({item['path']})"
             for item in file_list]
        )
        return {"success": True, "result": result, "files": file_list}

    except Exception as e:
        return {"success": False, "result": f"Could not list directory: {str(e)}"}


async def tool_browser_open(url: str, browser: str = "chrome") -> dict:
    """Open a URL in the specified browser on Mac."""
    try:
        browser_lower = browser.lower()
        if browser_lower == "chrome":
            subprocess.Popen(["open", "-a", "Google Chrome", url])
        elif browser_lower == "safari":
            subprocess.Popen(["open", "-a", "Safari", url])
        elif browser_lower == "firefox":
            subprocess.Popen(["open", "-a", "Firefox", url])
        else:
            subprocess.Popen(["open", url])
        return {"success": True, "result": f"Opened {url} in {browser}"}
    except Exception as e:
        # Fallback to Python's webbrowser module
        try:
            webbrowser.open(url)
            return {"success": True, "result": f"Opened {url}"}
        except Exception:
            return {"success": False, "result": f"Could not open browser: {str(e)}"}


async def tool_browser_read(url: str, extract: str = "main_content") -> dict:
    """Fetch and extract readable text from a webpage using httpx."""
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            html = response.text

        # Parse with a minimal HTML stripper
        from html.parser import HTMLParser
        import re

        class TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.text_parts = []
                self.skip_tags = {"script", "style", "nav", "footer", "header"}
                self.current_skip = False
                self.skip_depth = 0

            def handle_starttag(self, tag, attrs):
                if tag in self.skip_tags:
                    self.current_skip = True
                    self.skip_depth += 1

            def handle_endtag(self, tag):
                if tag in self.skip_tags and self.skip_depth > 0:
                    self.skip_depth -= 1
                    if self.skip_depth == 0:
                        self.current_skip = False

            def handle_data(self, data):
                if not self.current_skip:
                    stripped = data.strip()
                    if stripped and len(stripped) > 2:
                        self.text_parts.append(stripped)

        parser = TextExtractor()
        parser.feed(html)
        content = " ".join(parser.text_parts)
        content = re.sub(r'\s+', ' ', content).strip()

        if len(content) > 8000:
            content = content[:8000] + "... [truncated]"

        return {"success": True, "result": content, "url": url}

    except Exception as e:
        # Last-resort: strip tags with regex
        try:
            import re
            clean = re.sub(r'<[^>]+>', ' ', html)
            clean = re.sub(r'\s+', ' ', clean).strip()[:5000]
            return {"success": True, "result": clean, "url": url}
        except Exception:
            return {"success": False, "result": f"Could not read page: {str(e)}"}


async def tool_youtube_search(query: str, play_best: bool = True) -> dict:
    """
    Play a YouTube video directly.
    Strategy:
      1. Fetch YouTube search results page, extract first videoId from embedded JSON.
      2. Open youtube.com/watch?v=ID&autoplay=1 — starts playing immediately.
      3. Fallback: open search results page if extraction fails.
    Always uses regular YouTube (not YouTube Music) so autoplay works.
    """
    import re
    from urllib.parse import quote_plus

    encoded = quote_plus(query)
    search_url = f"https://www.youtube.com/results?search_query={encoded}"

    video_id = None
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            resp = await client.get(search_url, headers=headers)
            html = resp.text

        # YouTube embeds all search results as JSON in the page — pull the first videoId
        ids = re.findall(r'"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"', html)
        if ids:
            video_id = ids[0]
    except Exception:
        pass

    if video_id:
        watch_url = f"https://www.youtube.com/watch?v={video_id}&autoplay=1"
        await tool_browser_open(watch_url, "chrome")
        return {
            "success": True,
            "result": f"Playing '{query}' on YouTube. Done.",
            "url": watch_url,
        }
    else:
        # Fallback — open search results, user clicks once
        await tool_browser_open(search_url, "chrome")
        return {
            "success": True,
            "result": f"Opened YouTube search for '{query}'. Done.",
            "url": search_url,
        }


async def tool_youtube_control(action: str) -> dict:
    """
    Control YouTube playback in Chrome via AppleScript + JS injection.
    Works even when Chrome is in the background — NOVA controls it without
    the user switching windows.
    """
    action = action.lower().strip()

    # Map spoken words → canonical actions
    aliases = {
        "skip": "skip_ad", "skip the ad": "skip_ad", "skip ad": "skip_ad",
        "resume": "play", "unpause": "play", "continue": "play",
        "stop": "pause", "quiet": "mute", "silence": "mute",
        "louder": "volume_up", "quieter": "volume_down", "softer": "volume_down",
        "forward": "seek_forward", "back": "seek_back", "rewind": "seek_back",
        "full screen": "fullscreen", "full-screen": "fullscreen",
    }
    action = aliases.get(action, action)

    # JS snippets per action
    JS = {
        "skip_ad": (
            "var btn = document.querySelector("
            "'.ytp-skip-ad-button, .ytp-ad-skip-button, "
            ".ytp-ad-skip-button-modern, [class*=\"skip-ad\"]');"
            "if(btn){btn.click();'skipped'}else{'no_ad'}"
        ),
        "pause":        "var v=document.querySelector('video');if(v){v.pause();'paused'}else{'no_video'}",
        "play":         "var v=document.querySelector('video');if(v){v.play();'playing'}else{'no_video'}",
        "mute":         "var v=document.querySelector('video');if(v){v.muted=true;'muted'}else{'no_video'}",
        "unmute":       "var v=document.querySelector('video');if(v){v.muted=false;'unmuted'}else{'no_video'}",
        "volume_up":    "var v=document.querySelector('video');if(v){v.volume=Math.min(1,v.volume+0.2);'vol '+Math.round(v.volume*100)+'%'}else{'no_video'}",
        "volume_down":  "var v=document.querySelector('video');if(v){v.volume=Math.max(0,v.volume-0.2);'vol '+Math.round(v.volume*100)+'%'}else{'no_video'}",
        "seek_forward": "var v=document.querySelector('video');if(v){v.currentTime+=10;'fwd 10s'}else{'no_video'}",
        "seek_back":    "var v=document.querySelector('video');if(v){v.currentTime=Math.max(0,v.currentTime-10);'back 10s'}else{'no_video'}",
        "fullscreen":   (
            "var btn=document.querySelector('.ytp-fullscreen-button');"
            "if(btn){btn.click();'fullscreen'}else{'no_button'}"
        ),
        "next": (
            "var btn=document.querySelector('.ytp-next-button');"
            "if(btn){btn.click();'next'}else{'no_button'}"
        ),
    }

    js = JS.get(action)
    if not js:
        return {"success": False, "result": f"Unknown action: {action}. Try: skip_ad, pause, play, mute, volume_up, volume_down, seek_forward, seek_back, fullscreen, next"}

    # Escape for AppleScript string embedding
    js_escaped = js.replace('\\', '\\\\').replace('"', '\\"')

    applescript = f'''tell application "Google Chrome"
    if (count of windows) > 0 then
        set result to execute active tab of front window javascript "{js_escaped}"
        return result as string
    else
        return "Chrome not open"
    end if
end tell'''

    try:
        proc = subprocess.run(
            ["osascript", "-e", applescript],
            capture_output=True, text=True, timeout=5
        )
        raw = (proc.stdout or "").strip()

        if "no_ad" in raw:
            return {"success": True, "result": "No ad to skip right now."}
        elif "no_video" in raw:
            return {"success": False, "result": "No video found in Chrome. Is YouTube open?"}
        elif "Chrome not open" in raw or proc.returncode != 0:
            return {"success": False, "result": "Chrome isn't open, Mr. V."}
        else:
            labels = {
                "skip_ad": "Ad skipped.", "pause": "Paused.", "play": "Playing.",
                "mute": "Muted.", "unmute": "Unmuted.", "fullscreen": "Fullscreen.",
                "next": "Next video.", "seek_forward": "Jumped forward 10s.",
                "seek_back": "Jumped back 10s.",
            }
            return {"success": True, "result": labels.get(action, "Done.")}

    except subprocess.TimeoutExpired:
        return {"success": False, "result": "Chrome didn't respond in time."}
    except Exception as e:
        return {"success": False, "result": f"Browser control failed: {str(e)}"}


async def tool_gmail_open(action: str, query: Optional[str] = None) -> dict:
    """Open Gmail in Chrome — inbox, compose, or search."""
    action_lower = action.lower()
    if action_lower == "inbox":
        url = "https://mail.google.com/mail/u/0/#inbox"
    elif action_lower == "compose":
        url = "https://mail.google.com/mail/u/0/#compose"
    elif action_lower == "search":
        encoded_query = query.replace(' ', '+') if query else ''
        url = f"https://mail.google.com/mail/u/0/#search/{encoded_query}"
    else:
        url = "https://mail.google.com/mail/u/0/#inbox"

    await tool_browser_open(url, "chrome")
    return {"success": True, "result": f"Opened Gmail {action} in Chrome"}


async def tool_mac_open(target: str, app: Optional[str] = None) -> dict:
    """Open an app, file, or folder on Mac using the system 'open' command."""
    try:
        expanded = os.path.expanduser(target)
        if app:
            subprocess.Popen(["open", "-a", app, expanded])
        else:
            subprocess.Popen(["open", expanded])
        return {"success": True, "result": f"Opened: {target}"}
    except Exception as e:
        return {"success": False, "result": f"Could not open: {str(e)}"}


async def tool_get_agent_status() -> dict:
    """Return the current NOVA agent fleet status."""
    try:
        from agents.registry import registry
        status = registry.get_status()
        summary = registry.get_summary_text()
        return {"success": True, "result": summary, "status": status}
    except Exception as e:
        return {"success": False, "result": f"Could not retrieve agent status: {str(e)}"}


async def tool_spawn_mark_agent(task: str) -> dict:
    """Spawn a new MARK temporary agent."""
    try:
        from agents.registry import registry
        name = registry.spawn_mark(task)
        return {
            "success": True,
            "result": f"{name} is online and assigned to: {task}",
            "agent_name": name,
        }
    except Exception as e:
        return {"success": False, "result": f"Could not spawn MARK agent: {str(e)}"}


async def tool_kill_mark_agent(name: str) -> dict:
    """Kill a MARK agent and free its slot."""
    try:
        from agents.registry import registry
        success = registry.kill_mark(name)
        if success:
            return {"success": True, "result": f"{name} deactivated. Slot cleared and available for reuse."}
        else:
            return {"success": False, "result": f"{name} not found — may already be deactivated."}
    except Exception as e:
        return {"success": False, "result": f"Could not kill agent: {str(e)}"}


async def tool_web_search(query: str, num_results: int = 5) -> dict:
    """Search the web via DuckDuckGo (no API key required) and return results."""
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36"
            )
        }
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(search_url, headers=headers)
            html = response.text

        import re

        titles = re.findall(r'class="result__a"[^>]*>([^<]+)<', html)
        snippets = re.findall(r'class="result__snippet"[^>]*>([^<]+)<', html)
        urls_found = re.findall(r'class="result__url"[^>]*>([^<]+)<', html)

        results = []
        for i in range(min(num_results, len(titles))):
            results.append({
                "title": titles[i].strip() if i < len(titles) else "",
                "snippet": snippets[i].strip() if i < len(snippets) else "",
                "url": urls_found[i].strip() if i < len(urls_found) else ""
            })

        if not results:
            return {"success": False, "result": "No results found"}

        result_text = "\n\n".join(
            [f"**{r['title']}**\n{r['snippet']}\n{r['url']}" for r in results]
        )
        return {"success": True, "result": result_text, "results": results}

    except Exception as e:
        return {"success": False, "result": f"Search failed: {str(e)}"}
