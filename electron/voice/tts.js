/**
 * NOVA TTS — macOS native voice via `say`
 * ────────────────────────────────────────
 * Uses Samantha Enhanced (neural female voice — ships with macOS, $0).
 * Pauses the wake engine while speaking to prevent self-triggering.
 */

const { EventEmitter } = require('events')
const { spawn, exec } = require('child_process')

// macOS `say` rate is words/min. Default ~175. JARVIS pace: ~210 (crisp).
const DEFAULT_VOICE = 'Samantha'
const DEFAULT_RATE = 210

// Strip markdown / formatting that `say` would speak literally
function cleanForSpeech(text) {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, '')         // code blocks
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // bold
    .replace(/\*([^*]+)\*/g, '$1')          // italic
    .replace(/#{1,6}\s+/g, '')              // headings
    .replace(/^>\s+/gm, '')                 // blockquotes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links → text
    .replace(/https?:\/\/\S+/g, '')         // bare URLs
    .replace(/[•·●▪►▶◆◇◾◽■□]/g, '')        // bullet symbols
    .replace(/^[\-*+]\s+/gm, '')            // list markers
    .replace(/^\d+\.\s+/gm, '')             // numbered lists
    .replace(/\n{2,}/g, '. ')               // paragraphs → pause
    .replace(/\s+/g, ' ')
    .trim()
}

class TTS extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.speaking = false
    this.currentText = ''
  }

  speak(text, opts = {}) {
    const voice = opts.voice || DEFAULT_VOICE
    const rate = opts.rate || DEFAULT_RATE
    const clean = cleanForSpeech(text)

    return new Promise(resolve => {
      // Kill any in-progress speech first
      this.stop()

      if (!clean) { resolve(); return }

      this.currentText = clean
      this.speaking = true
      this.emit('start', clean)

      try {
        this.process = spawn('say', ['-v', voice, '-r', String(rate), clean])
      } catch (err) {
        console.error('[TTS] Spawn failed:', err.message)
        this.speaking = false
        this.emit('error', err.message)
        resolve()
        return
      }

      this.process.on('exit', code => {
        this.speaking = false
        this.process = null
        this.emit('end', { code, text: clean })
        resolve()
      })

      this.process.on('error', err => {
        console.error('[TTS] Error:', err.message)
        this.speaking = false
        this.process = null
        this.emit('error', err.message)
        resolve()
      })
    })
  }

  stop() {
    if (this.process) {
      try { this.process.kill('SIGTERM') } catch {}
      this.process = null
    }
    this.speaking = false
  }

  isSpeaking() { return this.speaking }

  // Quick non-blocking audio cue (uses afplay — instant, doesn't block mic)
  chime(name = 'Glass') {
    // /System/Library/Sounds/ has built-in Mac sounds:
    // Glass, Tink, Pop, Hero, Funk, Submarine, Ping, Morse, Bottle, Frog, Blow, Basso
    const sound = `/System/Library/Sounds/${name}.aiff`
    exec(`afplay "${sound}"`, () => {})
  }
}

module.exports = { TTS, cleanForSpeech, DEFAULT_VOICE }
