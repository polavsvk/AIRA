import os
import httpx
from dotenv import load_dotenv
from collections import defaultdict
from datetime import datetime

load_dotenv()

WEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
BASE_URL = "https://api.openweathermap.org/data/2.5"


def _parse_weather_response(current_data: dict, forecast_data: dict, fallback_name: str = "") -> dict:
    """Parse OpenWeatherMap API responses into clean format."""
    current = {
        "city": current_data.get("name", fallback_name),
        "country": current_data.get("sys", {}).get("country", ""),
        "temperature": round(current_data["main"]["temp"]),
        "feels_like": round(current_data["main"]["feels_like"]),
        "description": current_data["weather"][0]["description"].capitalize(),
        "humidity": current_data["main"]["humidity"],
        "wind_speed": round(current_data["wind"]["speed"] * 3.6),
        "icon": current_data["weather"][0]["icon"],
        "condition": current_data["weather"][0]["main"],
    }

    days = defaultdict(list)
    today = datetime.now().strftime("%A")
    for item in forecast_data.get("list", []):
        date = datetime.fromtimestamp(item["dt"]).strftime("%A")
        if date != today:
            days[date].append(item)

    forecast = []
    for day_name, items in list(days.items())[:3]:
        temps = [i["main"]["temp"] for i in items]
        forecast.append({
            "day": day_name,
            "high": round(max(temps)),
            "low": round(min(temps)),
            "description": items[0]["weather"][0]["description"].capitalize(),
            "icon": items[0]["weather"][0]["icon"],
        })

    return {"current": current, "forecast": forecast, "demo": False}


async def get_weather(city: str = "London") -> dict:
    """Fetch weather by city name."""
    if not WEATHER_API_KEY:
        return _demo_weather(city)

    async with httpx.AsyncClient(timeout=10) as client:
        current_res = await client.get(
            f"{BASE_URL}/weather",
            params={"q": city, "appid": WEATHER_API_KEY, "units": "metric"}
        )
        if current_res.status_code != 200:
            return _demo_weather(city)

        forecast_res = await client.get(
            f"{BASE_URL}/forecast",
            params={"q": city, "appid": WEATHER_API_KEY, "units": "metric", "cnt": 32}
        )

    return _parse_weather_response(current_res.json(), forecast_res.json(), city)


async def get_weather_by_coords(lat: float, lon: float) -> dict:
    """Fetch weather by GPS coordinates — for auto-location."""
    if not WEATHER_API_KEY:
        return _demo_weather("Your Location")

    async with httpx.AsyncClient(timeout=10) as client:
        current_res = await client.get(
            f"{BASE_URL}/weather",
            params={"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric"}
        )
        if current_res.status_code != 200:
            return _demo_weather("Your Location")

        forecast_res = await client.get(
            f"{BASE_URL}/forecast",
            params={"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric", "cnt": 32}
        )

    return _parse_weather_response(current_res.json(), forecast_res.json(), "Your Location")


def _demo_weather(city: str) -> dict:
    return {
        "demo": True,
        "current": {
            "city": city, "country": "",
            "temperature": 22, "feels_like": 20,
            "description": "Clear skies", "humidity": 55,
            "wind_speed": 12, "icon": "01d", "condition": "Clear"
        },
        "forecast": [
            {"day": "Tomorrow", "high": 24, "low": 18, "description": "Sunny", "icon": "01d"},
            {"day": "Wednesday", "high": 21, "low": 16, "description": "Partly cloudy", "icon": "02d"},
            {"day": "Thursday", "high": 19, "low": 14, "description": "Light rain", "icon": "10d"},
        ]
    }
