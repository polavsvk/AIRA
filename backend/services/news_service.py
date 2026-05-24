import os
import httpx
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
BASE_URL = "https://newsapi.org/v2"

DEMO_NEWS = [
    {
        "title": "AI Advances Continue to Reshape Industries Worldwide",
        "description": "Artificial intelligence is transforming sectors from healthcare to finance at an unprecedented pace.",
        "source": "Tech Today",
        "url": "#",
        "publishedAt": "2 hours ago",
        "category": "Technology"
    },
    {
        "title": "Global Markets Show Strong Recovery Amid Economic Optimism",
        "description": "Stock markets around the world posted gains as investors expressed confidence in economic stability.",
        "source": "Financial Times",
        "url": "#",
        "publishedAt": "4 hours ago",
        "category": "Business"
    },
    {
        "title": "Breakthrough in Renewable Energy Storage Announced",
        "description": "Scientists unveil a new battery technology that could revolutionize how we store solar and wind energy.",
        "source": "Science Daily",
        "url": "#",
        "publishedAt": "6 hours ago",
        "category": "Science"
    },
    {
        "title": "Space Mission Captures Stunning New Images of Deep Space",
        "description": "The latest telescope data reveals never-before-seen details of distant galaxies billions of light-years away.",
        "source": "Space News",
        "url": "#",
        "publishedAt": "8 hours ago",
        "category": "Science"
    },
    {
        "title": "New Study Reveals Benefits of Mindfulness on Productivity",
        "description": "Research confirms that regular mindfulness practice can significantly boost focus and work output.",
        "source": "Health Weekly",
        "url": "#",
        "publishedAt": "10 hours ago",
        "category": "Health"
    },
]


def time_ago(published_at: str) -> str:
    try:
        dt = datetime.strptime(published_at, "%Y-%m-%dT%H:%M:%SZ")
        diff = datetime.utcnow() - dt
        hours = diff.seconds // 3600
        if diff.days > 0:
            return f"{diff.days}d ago"
        elif hours > 0:
            return f"{hours}h ago"
        else:
            return f"{diff.seconds // 60}m ago"
    except:
        return "Recently"


async def get_news(category: str = "general", country: str = "us") -> dict:
    """Fetch top news headlines."""
    if not NEWS_API_KEY:
        return {"articles": DEMO_NEWS, "demo": True}

    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{BASE_URL}/top-headlines",
            params={
                "apiKey": NEWS_API_KEY,
                "category": category,
                "country": country,
                "pageSize": 8,
            }
        )
        data = res.json()

    articles = []
    for article in data.get("articles", [])[:8]:
        if article.get("title") and article["title"] != "[Removed]":
            articles.append({
                "title": article["title"],
                "description": article.get("description", ""),
                "source": article.get("source", {}).get("name", "Unknown"),
                "url": article.get("url", "#"),
                "publishedAt": time_ago(article.get("publishedAt", "")),
                "category": category.capitalize(),
            })

    return {"articles": articles, "demo": False}
