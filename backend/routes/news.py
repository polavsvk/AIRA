from fastapi import APIRouter, Query
from services.news_service import get_news

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("/")
async def news(
    category: str = Query(default="general", description="News category"),
    country: str = Query(default="us", description="Country code")
):
    """Get top news headlines."""
    return await get_news(category, country)
