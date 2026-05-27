"""
NOVA Agent Router
Classifies incoming messages to route them to the right agent.
Uses keyword/regex matching — zero API calls, instant response.
"""

import re
from typing import List, Optional

# ── Intent Routing Rules ──────────────────────────────────────────────────────
# First match wins. Order matters — most specific first.

ROUTING_RULES = [
    # AEGIS — weather / environment
    ("AEGIS", [
        r'\bweather\b',
        r'\btemperature\b',
        r'\brain(ing|y|fall)?\b',
        r'\bforecast\b',
        r'\bhumidity\b',
        r'\b(windy|wind speed)\b',
        r'\b(sunny|cloudy|overcast|foggy|misty)\b',
        r'\bsnow(ing|fall)?\b',
        r'\b(storm|thunder|lightning)\b',
        r'\b\d+\s*degrees?\b',
        r'\b(hot|cold|warm|cool)\b.{0,20}\boutside\b',
        r'\boutside\b.{0,20}\b(hot|cold|warm|cool)\b',
        r'\bclimate\b',
        r'\bwhat.{0,20}\bweather\b',
        r'\bhow.{0,20}\bweather\b',
    ]),

    # HERALD — news / current events
    ("HERALD", [
        r'\bnews\b',
        r'\bheadlines?\b',
        r'\bbreaking\b',
        r'\bcurrent events?\b',
        r'\blatest\b.{0,20}\b(news|update|story|stories)\b',
        r'\bwhat.{0,20}happened\b',
        r'\btoday.{0,20}\bnews\b',
        r'\bnews.{0,20}today\b',
        r'\btop stories?\b',
    ]),

    # HERMES — browser, Gmail, YouTube, any web opening
    ("HERMES", [
        r'\b(open|check|go to|launch|show)\b.{0,20}\b(gmail|email|inbox|mail)\b',
        r'\b(send|write|compose|draft)\b.{0,30}\b(email|mail|message)\b',
        r'\bgmail\b',
        r'\byoutube\b',
        r'\b(play|watch|find|search).{0,20}\b(youtube|music|song|video|playlist)\b',
        r'\b(song|music|track|album|artist)\b.{0,30}\b(play|find|search|open)\b',
        r'\bplay\b.{0,40}\b(on youtube|youtube|music)\b',
        r'\b(open|visit|browse|go to|navigate to)\b.{0,30}\b(website|site|page|url|link|chrome|safari|browser)\b',
        r'\bhttps?://',
        r'\b\w+\.(com|org|net|io|co|dev|app)\b',
    ]),

    # ATLAS — file system / documents
    ("ATLAS", [
        r'\b(read|open|show|display|view)\b.{0,30}\b(file|document|pdf|docx|txt|csv|xlsx|json)\b',
        r'\b(write|create|save|update|edit|modify)\b.{0,30}\b(file|document|txt|csv)\b',
        r'\b(my|the)\b.{0,20}\b(resume|cv|report|letter|contract|proposal)\b',
        r'\bfile\b.{0,20}\b(path|system|manager)\b',
        r'\b(list|show)\b.{0,20}\bfiles?\b',
        r'\bfolder\b',
        r'\bdirectory\b',
        r'\b(open|read|show)\b.{0,20}\b(document|doc)\b',
        r'\bdownloads?\b.{0,20}\bfolder\b',
        r'\bdesktop\b.{0,20}\bfile\b',
    ]),

    # TITAN — Mac system, app control, screen
    ("TITAN", [
        r'\b(open|launch|start|run)\b.{0,20}\b(app|application)\b',
        r'\b(open|launch|start)\b.{0,20}\b(calculator|finder|terminal|spotlight|notes|calendar|reminders|photos|music|spotify)\b',
        r'\b(open|launch|start)\b.{0,20}\b(safari|chrome|firefox|slack|zoom|teams|discord|xcode|vscode|sublime|notion)\b',
        r'\bopen\b.{0,10}calculator\b',
        r'\bopen\b.{0,10}finder\b',
        r'\bopen\b.{0,10}terminal\b',
        r'\b(what.{0,20}\bon\b.{0,10}screen|what.{0,20}my screen|show.{0,20}screen)\b',
        r"\bwhat.{0,20}(screen|showing|displaying|open)\b",
        r'\bmy screen\b',
        r'\bscreenshot\b',
        r'\bscreen\b.{0,20}\b(capture|grab|shot)\b',
        r'\b(quit|close|force quit|kill)\b.{0,20}\b(app|application)\b',
    ]),

    # ORACLE — research, web search, factual questions
    ("ORACLE", [
        r'\bwikipedia\b',
        r'\b(search|look up|look for|find|google|research)\b.{0,30}\b(web|internet|online|google)\b',
        r'\b(what is|what are|who is|who was|who were|when was|where is|where are)\b',
        r'\bexplain\b.{0,30}\b(to me|how|what|why)\b',
        r'\bdefine\b',
        r'\bhow does\b.{0,30}\bwork\b',
        r'\bfind\b.{0,20}\b(information|info|details|facts)\b',
        r'\bsearch\b.{0,20}\bfor\b',
        r'\blook up\b',
        r'\btell me about\b',
    ]),
]

# ── Tool → Agent mapping ──────────────────────────────────────────────────────

TOOL_TO_AGENT = {
    "file_read": "ATLAS",
    "file_write": "ATLAS",
    "file_list": "ATLAS",
    "browser_open": "HERMES",
    "browser_action": "HERMES",
    "youtube_control": "HERMES",
    "browser_read": "ORACLE",
    "youtube_search": "HERMES",
    "gmail_open": "HERMES",
    "mac_open": "TITAN",
    "web_search": "ORACLE",
    "screen_read": "TITAN",
    "get_agent_status": "NOVA",
    "spawn_mark_agent": "NOVA",
    "kill_mark_agent": "NOVA",
}

# ── Tool subsets per agent ────────────────────────────────────────────────────

AGENT_TOOLS = {
    "NOVA": [
        "file_read", "file_write", "file_list",
        "browser_open", "browser_action", "browser_read",
        "youtube_search", "youtube_control", "gmail_open",
        "mac_open", "web_search", "screen_read", "computer_use",
        "get_agent_status", "spawn_mark_agent", "kill_mark_agent",
    ],
    "ATLAS": ["file_read", "file_write", "file_list"],
    "HERMES": ["browser_open", "browser_action", "browser_read",
               "youtube_search", "youtube_control", "gmail_open"],
    "ORACLE": ["web_search", "browser_read"],
    "TITAN": ["mac_open", "screen_read", "computer_use"],
    "AEGIS": [],   # direct service call — no LLM tools needed
    "HERALD": [],  # direct service call — no LLM tools needed
    "MARK": [      # MARK gets full toolkit like NOVA
        "file_read", "file_write", "file_list",
        "browser_open", "browser_action", "browser_read",
        "youtube_search", "youtube_control", "gmail_open",
        "mac_open", "web_search", "screen_read",
    ],
}


# ── Router ────────────────────────────────────────────────────────────────────

def classify_message(message: str) -> str:
    """
    Classify a user message to determine which agent should handle it.
    Returns one of: NOVA, ATLAS, HERMES, ORACLE, TITAN, AEGIS, HERALD.
    Zero API calls — pure regex matching.
    """
    msg_lower = message.lower().strip()

    for agent_name, patterns in ROUTING_RULES:
        for pattern in patterns:
            if re.search(pattern, msg_lower):
                return agent_name

    return "NOVA"   # default — complex/conversational tasks


def classify_from_tools(tools_used: List[str]) -> str:
    """
    After a response, determine which agent 'handled' it based on which tools ran.
    - Single domain → that agent
    - Multiple domains → NOVA (orchestrating)
    - No tools → NOVA (conversation)
    """
    if not tools_used:
        return "NOVA"

    agents = set(TOOL_TO_AGENT.get(t) for t in tools_used if t in TOOL_TO_AGENT)
    agents.discard(None)

    if len(agents) == 1:
        return agents.pop()
    return "NOVA"


def get_agent_tools(agent_name: str) -> List[str]:
    """Get the list of tool names available to a specific agent."""
    if agent_name.startswith("MARK-"):
        return AGENT_TOOLS["MARK"]
    return AGENT_TOOLS.get(agent_name, AGENT_TOOLS["NOVA"])


def should_announce(agent_name: str, message: str) -> bool:
    """
    Option C: silent delegation for simple tasks, announced for complex ones.
    Returns True if NOVA should say "Routing this to AGENT_NAME, Mr. V."
    """
    if agent_name == "NOVA":
        return False  # NOVA never announces itself

    # MARK agents always get announced — they're being created
    if agent_name.startswith("MARK-"):
        return True

    # For permanent agents, announce if the message is long or complex
    words = len(message.split())
    if words > 20:
        return True

    complex_indicators = [
        r'\b(analyse|analyze|research|compile|summarise|summarize|investigate)\b',
        r'\b(gather|collect|find out|figure out)\b',
        r'\b(check all|go through|review all)\b',
        r'\b(and then|after that|also|as well)\b',
    ]
    msg_lower = message.lower()
    return any(re.search(p, msg_lower) for p in complex_indicators)
