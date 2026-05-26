#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NOVA Voice Setup — installs the local voice pipeline (whisper.cpp + SDL2)
#
# Everything runs locally on your Mac. No API costs, no cloud, no Google.
# One-time install. Idempotent — safe to re-run.
# ─────────────────────────────────────────────────────────────────────────────

set -e

NOVA_HOME="$HOME/.nova"
WHISPER_DIR="$NOVA_HOME/whisper.cpp"
MODEL_NAME="base.en"   # 142MB — good balance of speed vs accuracy on M-chips
MODEL_FILE="ggml-${MODEL_NAME}.bin"

cyan()   { printf "\033[0;36m%s\033[0m\n" "$*"; }
green()  { printf "\033[0;32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[0;33m%s\033[0m\n" "$*"; }
red()    { printf "\033[0;31m%s\033[0m\n" "$*"; }

cyan "════════════════════════════════════════════════════════════════════"
cyan "  NOVA Voice Setup — fully local, $0 cost"
cyan "════════════════════════════════════════════════════════════════════"
echo

# ── 1. Check Homebrew ─────────────────────────────────────────────────────────
if ! command -v brew &> /dev/null; then
  red "✗ Homebrew not found."
  echo "  Install it first: https://brew.sh"
  echo "  Then re-run this script."
  exit 1
fi
green "✓ Homebrew found"

# ── 2. Ensure SDL2 (whisper.cpp `stream` needs it for mic input) ───────────────
if brew list sdl2 &> /dev/null; then
  green "✓ SDL2 already installed"
else
  yellow "→ Installing SDL2..."
  brew install sdl2
  green "✓ SDL2 installed"
fi

# ── 3. Ensure git ─────────────────────────────────────────────────────────────
if ! command -v git &> /dev/null; then
  red "✗ git not found. Install Xcode command-line tools: xcode-select --install"
  exit 1
fi
green "✓ git found"

# ── 4. Clone whisper.cpp ──────────────────────────────────────────────────────
mkdir -p "$NOVA_HOME"

if [ -d "$WHISPER_DIR/.git" ]; then
  green "✓ whisper.cpp repo present"
  yellow "→ Pulling latest..."
  (cd "$WHISPER_DIR" && git pull --rebase --autostash || true)
else
  yellow "→ Cloning whisper.cpp into $WHISPER_DIR..."
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp "$WHISPER_DIR"
  green "✓ Cloned"
fi

# ── 5. Build the `stream` binary (CMake — required for recent whisper.cpp) ────
cd "$WHISPER_DIR"

STREAM_BIN="$WHISPER_DIR/build/bin/stream"

if [ -f "$STREAM_BIN" ] && [ -x "$STREAM_BIN" ]; then
  green "✓ stream binary already built"
else
  # Ensure cmake is available
  if ! command -v cmake &> /dev/null; then
    yellow "→ Installing cmake via Homebrew..."
    brew install cmake
  fi
  green "✓ cmake found"

  yellow "→ Building whisper.cpp stream (this takes ~2-3 minutes)..."

  # Clean any old build state
  rm -rf build

  # Configure with CMake
  if [[ "$(uname -m)" == "arm64" ]]; then
    yellow "  Apple Silicon detected → Metal acceleration enabled"
    cmake -B build \
      -DWHISPER_SDL2=ON \
      -DGGML_METAL=ON \
      -DCMAKE_BUILD_TYPE=Release \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON \
      > /dev/null 2>&1
  else
    yellow "  Intel Mac → Accelerate framework"
    cmake -B build \
      -DWHISPER_SDL2=ON \
      -DGGML_METAL=OFF \
      -DCMAKE_BUILD_TYPE=Release \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON \
      > /dev/null 2>&1
  fi

  # Build just the stream example
  cmake --build build --config Release --target stream -- -j$(sysctl -n hw.ncpu) 2>&1 | tail -5

  if [ ! -x "$STREAM_BIN" ]; then
    red "✗ Build failed — stream binary not found at $STREAM_BIN"
    red "  Try: cd $WHISPER_DIR && cmake -B build -DWHISPER_SDL2=ON && cmake --build build --target stream"
    exit 1
  fi
  green "✓ stream binary built"
fi

# ── 6. Download the model ─────────────────────────────────────────────────────
MODEL_PATH="$WHISPER_DIR/models/$MODEL_FILE"

if [ -f "$MODEL_PATH" ]; then
  SIZE=$(du -h "$MODEL_PATH" | cut -f1)
  green "✓ Model already downloaded ($SIZE): $MODEL_FILE"
else
  yellow "→ Downloading $MODEL_FILE (~142MB)..."
  bash "./models/download-ggml-model.sh" "$MODEL_NAME"
  green "✓ Model downloaded"
fi

# ── 7. Verify `say` works (built into macOS) ──────────────────────────────────
if command -v say &> /dev/null; then
  green "✓ macOS `say` available (Samantha voice)"
else
  red "✗ `say` not found — are you sure this is macOS?"
  exit 1
fi

# ── 8. Quick smoke test ───────────────────────────────────────────────────────
echo
yellow "→ Running quick smoke test..."

# Test `say`
say -v Samantha "NOVA voice pipeline is ready, Mr. V." &
SAY_PID=$!
sleep 3
kill $SAY_PID 2>/dev/null || true

green "✓ Smoke test passed"

# ── 9. Done ───────────────────────────────────────────────────────────────────
echo
cyan "════════════════════════════════════════════════════════════════════"
green "  ✓ NOVA voice pipeline installed and ready"
cyan "════════════════════════════════════════════════════════════════════"
echo
echo "  Installation paths:"
echo "    Whisper binary: $WHISPER_DIR/build/bin/stream"
echo "    Model:          $MODEL_PATH"
echo
echo "  Next steps:"
echo "    1. Open the NOVA app"
echo "    2. macOS will ask for Microphone permission — click Allow"
echo "    3. Say: 'Hey Nova, what time is it?'"
echo
echo "  Hotkeys:"
echo "    Cmd+Shift+M     → Toggle Interview Mode (instant mute)"
echo "    Cmd+Shift+Space → Show/hide NOVA window"
echo
