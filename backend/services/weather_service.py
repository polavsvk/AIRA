import os
import httpx
from dotenv import load_dotenv

load_dotenv()

WEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
BASE_URL = "https://api.openweathermap.org/data/2.5"


async def get_weather(city: str = "London") -> dict:
    """Fetch current weather and 5-day forecast."""
    if not WEATHER_API_KEY:
        return {
            "error": "OPENWEATHER_API_KEY not configured",
            "demo": True,
            "current": {
                "city": city,
                "temperature": 22,
                "feels_like": 20,
                "description": "Clear skies",
                "humidity": 55,
                "wind_speed": 12,
                "icon": "01d",
                "condition": "Clear"
            },
            "forecast": [
                {"day": "Tomorrow", "high": 24, "low": 18, "description": "Sunny", "icon": "01d"},
                {"day": "Wednesday", "high": 21, "low": 16, "description": "Partly cloudy", "icon": "02d"},
                {"day": "Thursday", "high": 19, "low": 14, "description": "Light rain", "icon": "10d"},
            ]
        }

    async with httpx.AsyncClient() as client:
        # Current weather
        current_res = await client.get(
            f"{BASE_URL}/weather",
            params={"q": city, "appid": WEATHER_API_KEY, "units": "metric"}
        )
        current_data = current_res.json()

        # 5-day forecast
        forecast_res = await client.get(
            f"{BASE_URL}/forecast",
            params={"q": city, "appid": WEATHER_API_KEY, "units": "metric", "cnt": 24}
        )
        forecast_data = forecast_res.json()

    # Process current weather
    current = {
        "city": current_data.get("name", city),
        "temperature": round(current_data["main"]["temp"]),
        "feels_like": round(current_data["main"]["feels_like"]),
        "description": current_data["weather"][0]["description"].capitalize(),
        "humidity": current_data["main"]["humidity"],
        "wind_speed": round(current_data["wind"]["speed"] * 3.6),  # m/s to km/h
        "icon": current_data["weather"][0]["icon"],
        "condition": current_data["weather"][0]["main"],
    }

    # Process forecast (daily grouped)
    from collections import defaultdict
    from datetime import datetime
    days = defaultdict(list)
    for item in forecast_data.get("list", []):
        date = datetime.fromtimestamp(item["dt"]).strftime("%A")
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
