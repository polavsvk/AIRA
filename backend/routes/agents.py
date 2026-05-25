"""
NOVA Agent Routes
Endpoints for querying agent status and managing MARK agents.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from agents.registry import registry

router = APIRouter(prefix="/api/agents", tags=["agents"])


class SpawnMarkRequest(BaseModel):
    task: str


class KillMarkRequest(BaseModel):
    name: str


@router.get("/status")
async def get_agent_status():
    """Full agent fleet status — permanent agents and active MARKs."""
    return registry.get_status()


@router.get("/summary")
async def get_agent_summary():
    """Human-readable text summary of agent fleet."""
    return {"summary": registry.get_summary_text()}


@router.post("/mark/spawn")
async def spawn_mark(request: SpawnMarkRequest):
    """Spawn a new MARK temporary agent."""
    name = registry.spawn_mark(request.task)
    return {"name": name, "task": request.task, "status": "active"}


@router.post("/mark/kill")
async def kill_mark(request: KillMarkRequest):
    """Kill a MARK agent and free its slot."""
    success = registry.kill_mark(request.name)
    if success:
        return {"success": True, "message": f"{request.name} deactivated."}
    return {"success": False, "message": f"{request.name} not found."}
