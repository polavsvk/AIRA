from fastapi import APIRouter, Query
from services.weather_service import get_weather, get_weather_by_coords

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/")
async def weather(city: str = Query(default="London", description="City name")):
    """Get current weather and forecast for a city."""
    return await get_weather(city)


@router.get("/coords")
async def weather_by_coords(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude")
):
    """Get weather by GPS coordinates — used for auto-location."""
    return await get_weather_by_coords(lat, lon)
