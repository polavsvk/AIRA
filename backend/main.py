from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import create_tables
from routes import chat, weather, news, tasks, memory, agents, patterns

app = FastAPI(
    title="NOVA API",
    description="NOVA — AI Personal Assistant for Mr. V",
    version="2.0.0"
)

# CORS — allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup
@app.on_event("startup")
async def startup_event():
    create_tables()

# Register routes
app.include_router(chat.router)
app.include_router(weather.router)
app.include_router(news.router)
app.include_router(tasks.router)
app.include_router(memory.router)
app.include_router(agents.router)
app.include_router(patterns.router)


@app.get("/")
async def root():
    return {
        "name": "NOVA",
        "full_name": "AI Personal Assistant",
        "status": "online",
        "version": "2.0.0",
        "message": "NOVA systems fully operational, Mr. V."
    }


@app.get("/api/health")
async def health():
    return {"status": "healthy", "message": "All systems operational."}
