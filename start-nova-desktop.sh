#!/bin/bash
# ╔══════════════════════════════════════════════════╗
# ║      NOVA — Desktop App Launcher (Electron)      ║
# ║  Runs NOVA as a native Mac app (menu bar + dock) ║
# ╚══════════════════════════════════════════════════╝

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         NOVA Desktop App — Starting             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check for .env
if [ ! -f ".env" ]; then
    cp .env.example .env 2>/dev/null || touch .env
fi

# Python setup
if [ ! -d "backend/venv" ]; then
    echo "📦 Setting up Python environment..."
    python3 -m venv backend/venv
fi
source backend/venv/bin/activate
pip install -r backend/requirements.txt -q

# Playwright
python3 -c "from playwright.async_api import async_playwright" 2>/dev/null || {
    pip install playwright -q
    playwright install chromium
}

# Electron dependencies
if [ ! -d "electron/node_modules" ]; then
    echo "📦 Installing Electron dependencies..."
    cd electron && npm install --silent && cd ..
fi

# Build frontend for Electron
echo "🔨 Building frontend..."
cd frontend
npm install --silent 2>/dev/null || true
npm run build --silent
cd ..

echo ""
echo "🚀 Launching NOVA desktop app..."
echo "   Look for the NOVA icon in your menu bar ↗"
echo ""

# Start Electron (it starts the backend itself)
cd electron && NODE_ENV=production npx electron .
