/**
 * NOVA Interview Mode
 * ───────────────────
 * Auto-detects when Mr. V is in a video call and goes fully silent:
 *   - Wake word listening: OFF
 *   - TTS: OFF
 *   - Mic stream: CLOSED (no orange dot from NOVA)
 *   - Proactive interjections: OFF
 *
 * Manual override available via global hotkey or UI toggle.
 */

const { EventEmitter } = require('events')
const { exec } = require('child_process')

// Apps that are STRONGLY indicative of being in a call when frontmost
const CALL_APP_PROCESSES = [
  'zoom.us',                          // Zoom
  'Microsoft Teams',                  // Teams classic
  'MSTeams',                          // Teams new
  'Microsoft Teams (work or school)',
  'Webex',
  'Cisco Webex Meetings',
  'FaceTime',
  'Discord',
  'GoToMeeting',
  'BlueJeans',
  'RingCentral',
  'Skype',
  'Slack',                            // huddle possible
]

// macOS sound-input apps detection — checks if anything other than NOVA has the mic
function getActiveApp() {
  return new Promise(resolve => {
    exec(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 1500 },
      (err, stdout) => {
        if (err) { resolve(null); return }
        resolve(stdout.trim())
      }
    )
  })
}

class InterviewMode extends EventEmitter {
  constructor() {
    super()
    this.autoDetected = false      // call app is in foreground
    this.manualOverride = false    // user explicitly toggled
    this.interval = null
  }

  // True if EITHER auto-detected a call OR user manually enabled
  get active() {
    return this.autoDetected || this.manualOverride
  }

  start(pollMs = 3000) {
    if (this.interval) return
    this._check()
    this.interval = setInterval(() => this._check(), pollMs)
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }

  setManual(on) {
    const wasActive = this.active
    this.manualOverride = !!on
    const nowActive = this.active
    console.log(`[InterviewMode] Manual override → ${on}`)
    if (wasActive !== nowActive) this.emit('change', nowActive, this._reason())
  }

  toggleManual() {
    this.setManual(!this.manualOverride)
    return this.active
  }

  async _check() {
    try {
      const active = await getActiveApp()
      const inCall = active && CALL_APP_PROCESSES.some(name =>
        active.toLowerCase().includes(name.toLowerCase())
      )

      const wasActive = this.active
      this.autoDetected = !!inCall
      const nowActive = this.active

      if (wasActive !== nowActive) {
        console.log(`[InterviewMode] ${wasActive ? 'OFF' : 'ON'} → ${nowActive ? 'ON' : 'OFF'} (active app: ${active})`)
        this.emit('change', nowActive, this._reason())
      }
    } catch (err) {
      // Silent — polling failure shouldn't crash anything
    }
  }

  _reason() {
    if (this.manualOverride && this.autoDetected) return 'manual + call detected'
    if (this.manualOverride) return 'manual override'
    if (this.autoDetected) return 'call app detected'
    return 'inactive'
  }

  getStatus() {
    return {
      active: this.active,
      autoDetected: this.autoDetected,
      manualOverride: this.manualOverride,
      reason: this._reason(),
    }
  }
}

module.exports = { InterviewMode, CALL_APP_PROCESSES }
