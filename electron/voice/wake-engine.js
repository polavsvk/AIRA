/**
 * NOVA Wake Word Engine
 * ─────────────────────
 * Spawns whisper.cpp `stream` binary for continuous local transcription.
 * Detects "Hey Nova" wake phrase in the rolling output.
 * Captures the command that follows, then emits it for processing.
 *
 * Runs entirely on the Mac. No network, no API costs, no Google.
 */

const { EventEmitter } = require('events')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ── Paths ────────────────────────────────────────────────────────────────────
const NOVA_HOME   = path.join(os.homedir(), '.nova')
const WHISPER_DIR = path.join(NOVA_HOME, 'whisper.cpp')
// whisper.cpp renamed `stream` → `whisper-stream` in 2024. The old name still
// exists as a deprecation stub that prints a warning and exits 1, so we must
// prefer `whisper-stream` when present.
const WHISPER_BIN = (() => {
  const candidates = [
    path.join(WHISPER_DIR, 'build', 'bin', 'whisper-stream'),
    path.join(WHISPER_DIR, 'build', 'bin', 'stream'),
    path.join(WHISPER_DIR, 'whisper-stream'),
    path.join(WHISPER_DIR, 'stream'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]  // default to new name (shows correct error if missing)
})()
const MODEL_PATH  = path.join(WHISPER_DIR, 'models', 'ggml-base.en.bin')

// ── Wake phrase detection ────────────────────────────────────────────────────
// Require "hey nova" or similar — bare "nova" causes too many false positives.
// The base.en whisper model often mishears "Nova" as Nora/Noah/Nala/Noma/Nava,
// or merges "hey nova" into a single token like "henoa"/"henova". Accept all.
const NOVA_VARIANTS = '(?:nova|nora|noah|noma|nava|noha|nada|nala|knowa|nover|noba)'
const WAKE_PATTERNS = [
  new RegExp(`\\b(?:hey|hi|ok(?:ay)?|yo|a|hay)\\s+${NOVA_VARIANTS}\\b`, 'i'),
  // Merged forms whisper emits when said quickly: "henova", "henoa", "henoah"
  /\bh[ae]y?[\s-]*n[oa][vbhrm]?[aoeu]h?\b/i,
]

// Strip whisper's own status output from the audio stream
const NOISE_PATTERNS = [
  /whisper_/i, /^main:/i, /^\[.*\]$/, /^\s*$/,
  /\[BLANK_AUDIO\]/i, /\[SILENCE\]/i, /^\(.*\)$/,
  /init from/i, /system_info/i, /init_state/i,
]

// ── States ───────────────────────────────────────────────────────────────────
const STATE = {
  IDLE: 'idle',
  LISTENING_WAKE: 'listening_wake',
  LISTENING_COMMAND: 'listening_command',
  PAUSED: 'paused',
  ERROR: 'error',
}

class WakeEngine extends EventEmitter {
  constructor() {
    super()
    this.state = STATE.IDLE
    this.process = null
    this.commandText = ''
    this.commandStartTime = 0
    this.silenceTimer = null
    this.maxCommandTimer = null
    this.lastWakeTime = 0
    this.restartAttempts = 0
    this.shouldBeRunning = false
  }

  isInstalled() {
    return fs.existsSync(WHISPER_BIN) && fs.existsSync(MODEL_PATH)
  }

  getInstallStatus() {
    return {
      binary: fs.existsSync(WHISPER_BIN) ? WHISPER_BIN : null,
      model: fs.existsSync(MODEL_PATH) ? MODEL_PATH : null,
      ready: this.isInstalled(),
    }
  }

  start() {
    if (this.process) return { ok: true, message: 'already running' }

    if (!this.isInstalled()) {
      const msg = `whisper.cpp not installed. Run: bash electron/setup-voice.sh`
      console.error('[WakeEngine]', msg)
      this._setState(STATE.ERROR)
      this.emit('error', msg)
      return { ok: false, message: msg }
    }

    this.shouldBeRunning = true

    // Audio device index. 0 = default capture device. If macOS Continuity is
    // on, device 0 may be the iPhone mic — override via NOVA_MIC_DEVICE env
    // var (run whisper-stream once to see the device list).
    const micDevice = process.env.NOVA_MIC_DEVICE ?? '0'

    const args = [
      '-m', MODEL_PATH,
      '--step', '500',       // analyse every 500ms
      '--length', '5000',    // 5s sliding window
      '--keep', '200',       // keep last 200ms for context
      '-t', '4',             // 4 threads
      '-c', String(micDevice),
    ]

    console.log('[WakeEngine] Starting:', WHISPER_BIN, args.join(' '))

    try {
      this.process = spawn(WHISPER_BIN, args, {
        cwd: WHISPER_DIR,
        env: { ...process.env },
      })
    } catch (e) {
      console.error('[WakeEngine] Spawn failed:', e.message)
      this._setState(STATE.ERROR)
      this.emit('error', e.message)
      return { ok: false, message: e.message }
    }

    this.process.stdout.on('data', d => this._onTranscription(d.toString()))
    this.process.stderr.on('data', d => {
      const text = d.toString().trim()
      if (text && !text.startsWith('whisper_') && !text.includes('init')) {
        console.log('[WakeEngine stderr]', text.slice(0, 200))
      }
    })

    this.process.on('error', err => {
      console.error('[WakeEngine] Process error:', err.message)
      this.emit('error', err.message)
    })

    this.process.on('exit', code => {
      console.log('[WakeEngine] Process exited:', code)
      this.process = null
      if (this.shouldBeRunning && this.state !== STATE.PAUSED) {
        this.restartAttempts += 1
        if (this.restartAttempts < 5) {
          const delay = Math.min(1000 * this.restartAttempts, 5000)
          console.log('[WakeEngine] Restarting in', delay, 'ms')
          setTimeout(() => this.start(), delay)
        } else {
          console.error('[WakeEngine] Too many restart attempts')
          this._setState(STATE.ERROR)
          this.emit('error', 'whisper.cpp keeps crashing — check the install')
        }
      }
    })

    this.restartAttempts = 0
    this._setState(STATE.LISTENING_WAKE)
    return { ok: true }
  }

  stop() {
    this.shouldBeRunning = false
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null }
    if (this.maxCommandTimer) { clearTimeout(this.maxCommandTimer); this.maxCommandTimer = null }
    if (this.process) {
      try { this.process.kill('SIGTERM') } catch {}
      this.process = null
    }
    this._setState(STATE.IDLE)
  }

  pause() {
    if (this.state === STATE.PAUSED) return
    console.log('[WakeEngine] Pausing')
    this.shouldBeRunning = false
    if (this.process) {
      try { this.process.kill('SIGTERM') } catch {}
      this.process = null
    }
    this._setState(STATE.PAUSED)
  }

  resume() {
    if (this.state !== STATE.PAUSED && this.state !== STATE.IDLE) return
    console.log('[WakeEngine] Resuming')
    this.start()
  }

  _onTranscription(raw) {
    // Whisper outputs lines as it transcribes
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

    for (const line of lines) {
      // Filter out whisper's own logging
      if (NOISE_PATTERNS.some(p => p.test(line))) continue

      // The actual transcription text — cleaned up
      const text = line.replace(/^\s*\[?[^]]*\]?\s*/, '').trim()
      if (!text) continue

      if (this.state === STATE.LISTENING_WAKE) {
        this._checkWake(text)
      } else if (this.state === STATE.LISTENING_COMMAND) {
        this._accumulateCommand(text)
      }
    }
  }

  _checkWake(text) {
    // Debounce: don't re-wake within 2 seconds
    if (Date.now() - this.lastWakeTime < 2000) return

    const matched = WAKE_PATTERNS.some(p => p.test(text))
    if (!matched) return

    this.lastWakeTime = Date.now()
    console.log('[WakeEngine] WAKE DETECTED:', text)

    // Anything after "hey nova" is the start of the command.
    // Strip leading punctuation whisper leaves: "Hey Noah, open..." → "open..."
    let remainder = text
    for (const p of WAKE_PATTERNS) {
      const m = text.match(p)
      if (m) {
        remainder = text.slice(m.index + m[0].length)
          .replace(/^[\s,;:.!?]+/, '')  // drop leading punctuation from residual
          .trim()
        break
      }
    }

    this.commandText = remainder
    this.commandStartTime = Date.now()
    this._setState(STATE.LISTENING_COMMAND)
    this.emit('wake', { residualCommand: remainder })

    // Reset timers
    this._resetSilenceTimer()
    this._startMaxCommandTimer()
  }

  _accumulateCommand(text) {
    // Filter out wake phrase if it appears again in the transcription window
    let clean = text
    for (const p of WAKE_PATTERNS) clean = clean.replace(p, '').trim()
    if (!clean) return

    // Append, avoiding repetition (whisper's sliding window can repeat words)
    if (!this.commandText.toLowerCase().endsWith(clean.toLowerCase())) {
      this.commandText = (this.commandText + ' ' + clean).trim()
    }

    this._resetSilenceTimer()
  }

  _resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => this._finalizeCommand('silence'), 1800)
  }

  _startMaxCommandTimer() {
    if (this.maxCommandTimer) clearTimeout(this.maxCommandTimer)
    this.maxCommandTimer = setTimeout(() => this._finalizeCommand('timeout'), 10000)
  }

  _finalizeCommand(reason) {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null }
    if (this.maxCommandTimer) { clearTimeout(this.maxCommandTimer); this.maxCommandTimer = null }

    const cmd = this.commandText.trim()
    this.commandText = ''
    console.log(`[WakeEngine] Command finalized (${reason}):`, cmd || '(empty)')

    // Strip whisper's punctuation-only output. Silence transcribes as ". . ."
    // or "..." which slips past a length check and triggers LLM hallucinations.
    const wordChars = cmd.replace(/[^a-zA-Z0-9]/g, '')
    if (cmd && wordChars.length >= 2) {
      this.emit('command', cmd)
    } else {
      this.emit('command-empty')
    }

    this._setState(STATE.LISTENING_WAKE)
  }

  _setState(newState) {
    if (this.state !== newState) {
      const old = this.state
      this.state = newState
      console.log(`[WakeEngine] ${old} → ${newState}`)
      this.emit('state', newState)
    }
  }
}

module.exports = { WakeEngine, STATE, WHISPER_BIN, MODEL_PATH, NOVA_HOME }
