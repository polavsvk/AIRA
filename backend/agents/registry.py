"""
NOVA Agent Registry
Tracks all active agents — permanent and temporary MARK agents.
Manages MARK naming lifecycle: reuse cleared numbers, no hard limit.
"""

from typing import Dict, Optional
from datetime import datetime
import threading


class AgentRegistry:
    """
    Singleton registry for the entire NOVA agent fleet.

    Permanent agents (always available):
        NOVA, ATLAS, HERMES, ORACLE, TITAN, AEGIS, HERALD

    Temporary agents (created/killed on demand):
        MARK-1, MARK-2, MARK-3 ... MARK-N (no upper limit)
        Cleared slots are reused: if MARK-2 is killed and MARK-4 exists,
        the next temporary becomes MARK-2 again.
    """

    PERMANENT_AGENTS = {
        "NOVA": {
            "type": "orchestrator",
            "description": "Primary orchestrator — complex tasks, multi-step operations, final voice",
            "icon": "⚡",
            "color": "#3b82f6",
        },
        "ATLAS": {
            "type": "permanent",
            "description": "File system specialist — reads, writes, and manages all documents",
            "icon": "📁",
            "color": "#f59e0b",
        },
        "HERMES": {
            "type": "permanent",
            "description": "Browser & communications — Gmail, YouTube, web browsing",
            "icon": "🌐",
            "color": "#10b981",
        },
        "ORACLE": {
            "type": "permanent",
            "description": "Research & intelligence — web search, Wikipedia, fact-finding",
            "icon": "🔍",
            "color": "#8b5cf6",
        },
        "TITAN": {
            "type": "permanent",
            "description": "Mac system control — app launcher, screen awareness",
            "icon": "🖥️",
            "color": "#ef4444",
        },
        "AEGIS": {
            "type": "permanent",
            "description": "Environmental intel — real-time weather and forecasts",
            "icon": "🌤️",
            "color": "#06b6d4",
        },
        "HERALD": {
            "type": "permanent",
            "description": "News & current events — headlines and live updates",
            "icon": "📰",
            "color": "#f97316",
        },
    }

    def __init__(self):
        self._lock = threading.Lock()
        # Active MARK agents: {name: {task, started_at, status}}
        self._mark_agents: Dict[str, dict] = {}
        # Numbers that were used and then cleared (available for reuse)
        self._cleared_numbers: list = []
        # Highest MARK number ever issued this session
        self._peak_mark: int = 0
        # Permanent agent task counters
        self._task_counts: Dict[str, int] = {k: 0 for k in self.PERMANENT_AGENTS}
        # Which permanent agent handled the last task
        self._last_active: Optional[str] = None

    # ── MARK Agent Lifecycle ─────────────────────────────────────────────────────

    def _next_mark_number(self) -> int:
        """Get next MARK number: reuse cleared ones first, then increment peak."""
        if self._cleared_numbers:
            num = min(self._cleared_numbers)
            self._cleared_numbers.remove(num)
            return num
        self._peak_mark += 1
        return self._peak_mark

    def spawn_mark(self, task: str) -> str:
        """
        Spawn a new MARK temporary agent.
        Returns the agent name (e.g. 'MARK-1').
        Reuses cleared slots; no hard limit on total count.
        """
        with self._lock:
            num = self._next_mark_number()
            name = f"MARK-{num}"
            self._mark_agents[name] = {
                "task": task,
                "started_at": datetime.now().isoformat(),
                "status": "active",
            }
            return name

    def kill_mark(self, name: str) -> bool:
        """
        Kill a MARK agent and free its number for reuse.
        Returns True if found and killed, False if not found.
        """
        with self._lock:
            if name not in self._mark_agents:
                return False
            del self._mark_agents[name]
            # Extract number and mark as reusable
            try:
                num = int(name.split("-")[1])
                self._cleared_numbers.append(num)
            except (IndexError, ValueError):
                pass
            return True

    def list_mark_agents(self) -> Dict[str, dict]:
        """Return a copy of all active MARK agents."""
        with self._lock:
            return dict(self._mark_agents)

    # ── Permanent Agent Tracking ─────────────────────────────────────────────────

    def record_task(self, agent_name: str):
        """Record that a permanent agent just completed a task."""
        with self._lock:
            if agent_name in self._task_counts:
                self._task_counts[agent_name] += 1
            self._last_active = agent_name

    # ── Status ───────────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Full status of all agents — permanent and active MARKs."""
        with self._lock:
            permanent = {}
            for name, info in self.PERMANENT_AGENTS.items():
                permanent[name] = {
                    **info,
                    "tasks": self._task_counts.get(name, 0),
                    "is_last_active": name == self._last_active,
                    "status": "standby",
                }
            marks = {
                name: {**data, "type": "temporary"}
                for name, data in self._mark_agents.items()
            }
            return {
                "permanent": permanent,
                "temporary": marks,
                "total_agents": len(permanent) + len(marks),
                "active_marks": len(marks),
                "last_active": self._last_active,
            }

    def get_summary_text(self) -> str:
        """Human-readable agent summary for NOVA to read back to Mr. V."""
        status = self.get_status()
        lines = [
            f"Fleet status — {status['total_agents']} agents operational, Mr. V.",
            "",
            "PERMANENT AGENTS (always on):",
        ]
        for name, info in status["permanent"].items():
            tasks = info["tasks"]
            lines.append(f"  • {info['icon']} {name} — {info['description']} [{tasks} tasks this session]")

        if status["temporary"]:
            lines.append("")
            lines.append("ACTIVE MARK AGENTS:")
            for name, info in status["temporary"].items():
                lines.append(f"  • ⚙️  {name} — {info['task']} [{info['status']}]")
        else:
            lines.append("")
            lines.append("No MARK agents currently active.")

        return "\n".join(lines)


# ── Global singleton ─────────────────────────────────────────────────────────────

registry = AgentRegistry()
