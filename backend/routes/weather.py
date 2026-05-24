from fastapi import APIRouter, Query
from services.weather_service import get_weather

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/")
async def weather(city: str = Query(default="London", description="City name")):
    """Get current weather and forecast for a city."""
    return await get_weather(city)
