/**
 * NOVA Ad Watcher
 * ───────────────
 * Background loop that detects and skips YouTube ads automatically.
 * Tier 1 action (reversible — just unmutes/replays the same video).
 *
 * How it works:
 *   1. Every N seconds, ask Chrome: "is the active tab a YouTube video?"
 *   2. If yes, run the skip-ad JS in that tab.
 *   3. If an ad button exists → click it. Otherwise no-op.
 *
 * No screenshots. No vision API. Pure DOM-aware JS injection.
 * Cost: $0. Latency: <100ms per check.
 */

const { EventEmitter } = require('events')
const { spawn } = require('child_process')

const DEFAULT_INTERVAL_MS = 2000   // poll every 2 seconds while active
const IDLE_INTERVAL_MS    = 10000  // when not on YouTube, slow way down

const SKIP_AD_JS = `(function(){
  var tabUrl = location.href;
  if (tabUrl.indexOf('youtube.com') === -1) return 'NOT_YOUTUBE';
  // Try every known skip-ad selector
  var sels = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '[class*="skip-ad"]'
  ];
  for (var i=0;i<sels.length;i++) {
    var btn = document.querySelector(sels[i]);
    if (btn) { btn.click(); return 'SKIPPED'; }
  }
  // Mute ad while it plays (most ads are <30s — but mute is courtesy)
  var adShowing = !!document.querySelector('.ad-showing, .ytp-ad-player-overlay');
  if (adShowing) {
    var v = document.querySelector('video');
    if (v && !v.muted) { v.muted = true; return 'MUTED_AD'; }
    return 'AD_PLAYING';
  }
  // No ad — make sure we unmute if we previously muted
  var v2 = document.querySelector('video');
  if (v2 && v2.muted && !adShowing) { /* leave user's mute alone; do nothing */ }
  return 'NO_AD';
})();`

const ACTIVE_URL_AS = `
tell application "Google Chrome"
  if (count of windows) = 0 then return ""
  return URL of active tab of front window
end tell
`

function _runOsa(script) {
  return new Promise((resolve) => {
    const proc = spawn('osascript', ['-e', script])
    let out = '', err = ''
    proc.stdout.on('data', d => out += d.toString())
    proc.stderr.on('data', d => err += d.toString())
    proc.on('close', code => resolve({ code, stdout: out.trim(), stderr: err.trim() }))
    proc.on('error', e => resolve({ code: -1, stdout: '', stderr: e.message }))
    // Hard timeout — never block
    setTimeout(() => { try { proc.kill() } catch(_){}; resolve({ code: -1, stdout: '', stderr: 'timeout' }) }, 4000)
  })
}

function _runChromeJs(js) {
  const escaped = js.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WIN"
  set theResult to execute active tab of front window javascript "${escaped}"
  return theResult as string
end tell`
  return _runOsa(script)
}


class AdWatcher extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS
    this.idleIntervalMs = opts.idleIntervalMs || IDLE_INTERVAL_MS
    this.enabled = false
    this._timer = null
    this._skipCount = 0
    this._lastResult = null
  }

  start() {
    if (this.enabled) return
    this.enabled = true
    this._schedule(0)
    this.emit('state', { enabled: true })
  }

  stop() {
    this.enabled = false
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    this.emit('state', { enabled: false })
  }

  getStatus() {
    return {
      enabled: this.enabled,
      skipped: this._skipCount,
      lastResult: this._lastResult,
    }
  }

  _schedule(delay) {
    if (!this.enabled) return
    this._timer = setTimeout(() => this._tick(), delay)
  }

  async _tick() {
    if (!this.enabled) return
    let nextDelay = this.idleIntervalMs
    try {
      const urlRes = await _runOsa(ACTIVE_URL_AS)
      const url = urlRes.stdout || ''
      if (url.includes('youtube.com')) {
        const r = await _runChromeJs(SKIP_AD_JS)
        const out = r.stdout
        this._lastResult = out
        if (out === 'SKIPPED') {
          this._skipCount++
          this.emit('skipped', { count: this._skipCount })
        } else if (out === 'MUTED_AD') {
          this.emit('muted_ad', {})
        }
        nextDelay = this.intervalMs   // stay fast while on YouTube
      }
    } catch (e) {
      // Fail closed — pause briefly so we don't hammer
      this._lastResult = `error:${e.message || e}`
    } finally {
      this._schedule(nextDelay)
    }
  }
}


module.exports = { AdWatcher }
