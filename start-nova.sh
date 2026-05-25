#!/bin/bash
# ╔══════════════════════════════════════════════════╗
# ║         NOVA — Dev Launcher (Browser)            ║
# ║  Runs NOVA in your browser at localhost:5173     ║
# ╚══════════════════════════════════════════════════╝

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              NOVA — Starting Up                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check for .env
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "⚠️  No .env found. Creating from template..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env" 2>/dev/null || touch "$SCRIPT_DIR/.env"
    echo "   → Add your GROQ_API_KEY to .env before continuing."
    echo ""
fi

# Python virtual environment
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "📦 Setting up Python environment (first time only)..."
    python3 -m venv "$BACKEND_DIR/venv"
fi
source "$BACKEND_DIR/venv/bin/activate"

# Install Python dependencies
echo "📦 Checking Python dependencies..."
pip install -r "$BACKEND_DIR/requirements.txt" -q

# Install Playwright if needed
python3 -c "from playwright.async_api import async_playwright" 2>/dev/null || {
    echo "📦 Installing Playwright browser automation..."
    pip install playwright -q
    playwright install chromium
}

# Install Node dependencies
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "📦 Installing frontend dependencies (first time only)..."
    npm install --silent --prefix "$FRONTEND_DIR"
fi

# Kill anything already on these ports
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

echo ""
echo "🚀 Starting NOVA backend..."
(cd "$BACKEND_DIR" && uvicorn main:app --host 127.0.0.1 --port 8000 --reload) &
BACKEND_PID=$!

# Wait for backend to be ready
echo "⏳ Waiting for backend..."
for i in {1..30}; do
    curl -s http://127.0.0.1:8000/api/health > /dev/null 2>&1 && echo "✅ Backend ready" && break
    sleep 0.5
done

echo "🎨 Starting NOVA frontend..."
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  NOVA is live at → http://localhost:5173         ║"
echo "║  Press Ctrl+C to shut down                      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Open in browser after 2 seconds
sleep 2
open "http://localhost:5173" 2>/dev/null || true

# Graceful shutdown
cleanup() {
    echo ""
    echo "Shutting down NOVA..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
