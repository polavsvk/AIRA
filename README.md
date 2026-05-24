# ⚡ AIRA — Advanced Intelligent Responsive Assistant

> *"AIRA systems are fully operational, Mr. V."*

A JARVIS-inspired personal AI assistant with a sleek Iron Man-style interface. Powered by **Groq's free LLaMA 3.3 70B** — completely free to run.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **AI Chat** | Streaming responses powered by Groq + LLaMA 3.3 70B |
| 🌤️ **Weather** | Real-time weather + 3-day forecast for any city |
| 📰 **News Feed** | Top headlines across 6 categories |
| ✅ **Task Manager** | Full CRUD tasks with priorities, due dates |
| 📋 **Daily Briefing** | One-click morning briefing — weather, news, tasks |
| 🎨 **Iron Man UI** | Dark theme with arc reactor blue accents |

---

## 🚀 Quick Start

### 1. Get Free API Keys (takes ~5 minutes)

| Service | Link | Cost |
|---------|------|------|
| **Groq** (AI brain) | https://console.groq.com | 🆓 Free |
| **OpenWeatherMap** (weather) | https://openweathermap.org/api | 🆓 Free |
| **NewsAPI** (news) | https://newsapi.org | 🆓 Free |

### 2. Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env and add your API keys
```

### 3. Start the Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Open AIRA

Visit **http://localhost:5173** in your browser. 🎉

---

## 📁 Project Structure

```
AIRA/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── database.py             # SQLite database setup
│   ├── models.py               # Pydantic schemas
│   ├── routes/
│   │   ├── chat.py             # Chat + streaming endpoints
│   │   ├── weather.py          # Weather endpoint
│   │   ├── news.py             # News endpoint
│   │   └── tasks.py            # Task CRUD endpoints
│   ├── services/
│   │   ├── groq_service.py     # Groq AI integration + AIRA personality
│   │   ├── weather_service.py  # OpenWeatherMap integration
│   │   └── news_service.py     # NewsAPI integration
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # Main layout
│   │   ├── components/
│   │   │   ├── Header.jsx      # Top bar with clock & status
│   │   │   ├── ChatWindow.jsx  # Main chat interface
│   │   │   ├── WeatherWidget.jsx
│   │   │   ├── NewsWidget.jsx
│   │   │   ├── TaskManager.jsx
│   │   │   └── DailyBriefing.jsx
│   │   └── styles/index.css    # Tailwind + custom animations
│   ├── package.json
│   └── vite.config.js
├── .env.example                # API key template
└── README.md
```

---

## 🎨 Design

- **Theme**: Deep dark Iron Man-inspired UI
- **Primary color**: Arc Reactor Blue (`#00d4ff`)
- **Accent**: Gold (`#ffd700`)
- **Font**: Inter + JetBrains Mono
- **Animations**: Scanning lines, arc reactor pulse, typing indicators

---

## 🧠 AIRA Personality

AIRA is configured to:
- Address you as **Mr. V**
- Adapt tone based on context (professional for work, witty for casual)
- Be direct and precise — no fluff
- Occasionally use dry wit, like JARVIS
- Never fabricate information

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Python FastAPI + Uvicorn |
| AI | Groq API (LLaMA 3.3 70B) |
| Database | SQLite + SQLAlchemy |
| Weather | OpenWeatherMap API |
| News | NewsAPI |

---

*Built for Mr. V · AIRA v1.0*
