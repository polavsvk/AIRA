#!/bin/bash
# ╔══════════════════════════════════════════════════╗
# ║      NOVA — Desktop App (Electron)               ║
# ║  Runs as a native Mac app — menu bar + dock      ║
# ╚══════════════════════════════════════════════════╝

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ELECTRON_DIR="$SCRIPT_DIR/electron"

cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         NOVA Desktop App — Starting             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check .env
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env" 2>/dev/null || touch "$SCRIPT_DIR/.env"
fi

# Python venv
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "📦 Setting up Python environment..."
    python3 -m venv "$BACKEND_DIR/venv"
fi
source "$BACKEND_DIR/venv/bin/activate"

# Python deps
echo "📦 Checking Python dependencies..."
pip install -r "$BACKEND_DIR/requirements.txt" -q

# Playwright
python3 -c "from playwright.async_api import async_playwright" 2>/dev/null || {
    echo "📦 Installing Playwright..."
    pip install playwright -q
    playwright install chromium
}

# Frontend Node deps
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install --silent --prefix "$FRONTEND_DIR"
fi

# Electron deps
if [ ! -d "$ELECTRON_DIR/node_modules" ]; then
    echo "📦 Installing Electron dependencies..."
    npm install --silent --prefix "$ELECTRON_DIR"
fi

# Kill anything on these ports
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 0.5

# Start backend
echo ""
echo "🚀 Starting NOVA backend..."
(cd "$BACKEND_DIR" && "$BACKEND_DIR/venv/bin/python3" -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

# Wait for backend
echo "⏳ Waiting for backend..."
for i in {1..30}; do
    curl -s http://127.0.0.1:8000/api/health > /dev/null 2>&1 && echo "✅ Backend ready" && break
    sleep 0.5
done

# Start Vite dev server (Electron loads from it in dev mode)
echo "🎨 Starting frontend..."
(cd "$FRONTEND_DIR" && npm run dev) &
VITE_PID=$!

# Wait for Vite to be ready
echo "⏳ Waiting for frontend..."
for i in {1..20}; do
    curl -s http://localhost:5173 > /dev/null 2>&1 && echo "✅ Frontend ready" && break
    sleep 0.5
done

# Launch Electron
echo ""
echo "🖥️  Launching NOVA desktop app..."
echo "   → Look for NOVA in your Dock and Menu Bar"
echo ""
NODE_ENV=development npx --prefix "$ELECTRON_DIR" electron "$ELECTRON_DIR/main.js" &
ELECTRON_PID=$!

echo "╔══════════════════════════════════════════════════╗"
echo "║  NOVA is running as a desktop app               ║"
echo "║  Shortcut: Cmd+Shift+Space to show/hide         ║"
echo "║  Press Ctrl+C here to quit everything           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

cleanup() {
    echo ""
    echo "Shutting down NOVA..."
    kill $ELECTRON_PID $VITE_PID $BACKEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
