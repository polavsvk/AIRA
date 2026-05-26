/**
 * NOVA Proactive Engine
 * ─────────────────────
 * NOVA speaks first when it matters.
 *
 * Triggers:
 *   morning_briefing — 8:00 AM weekdays → API call ("give me my day")
 *   evening_wrap     — 6:00 PM weekdays → API call ("what did we do today")
 *   calendar_alert   — 15 min before any Calendar.app event → instant TTS
 *   new_mail         — unread mail in Mail.app → instant TTS
 *   idle_checkin     — 30 min of silence → instant TTS nudge
 *
 * Smart suppression:
 *   - Interview Mode active       → fully suppressed
 *   - Night hours (22:00–07:00)   → sleep mode (configurable)
 *   - User active last 2 min      → hold
 *   - Same trigger type < 10 min  → debounce
 *   - NOVA currently speaking     → queue (handled by caller)
 */

'use strict'

const EventEmitter = require('events')
const { exec }     = require('child_process')
const fs           = require('fs')
const os           = require('os')
const path         = require('path')

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS     = 60_000      // check every minute
const ACTIVITY_SUPPRESS_MS = 2 * 60_000 // hold after user activity
const TRIGGER_DEBOUNCE_MS  = 10 * 60_000 // same trigger type cooldown
const IDLE_THRESHOLD_MS    = 30 * 60_000 // 30 min idle → checkin
const NIGHT_START_H        = 22          // 10 PM
const NIGHT_END_H          = 7           // 7 AM
const CALENDAR_ALERT_MINS  = 15          // alert 15 min before event
const SEEN_PURGE_MS        = 4 * 60 * 60_000 // clear seen events every 4h

// ── AppleScript helper ────────────────────────────────────────────────────────

function runAppleScript(script) {
  return new Promise(resolve => {
    // Write to temp file to avoid shell quoting nightmares
    const tmp = path.join(os.tmpdir(), `nova_as_${Date.now()}_${Math.random().toString(36).slice(2)}.applescript`)
    try {
      fs.writeFileSync(tmp, script, 'utf8')
    } catch {
      resolve('')
      return
    }

    exec(`osascript "${tmp}"`, { timeout: 8000 }, (err, stdout) => {
      try { fs.unlinkSync(tmp) } catch {}
      // Don't reject on errors — app might not be running, that's fine
      resolve(err ? '' : (stdout || '').trim())
    })
  })
}

// ── ProactiveEngine ───────────────────────────────────────────────────────────

class ProactiveEngine extends EventEmitter {
  constructor(options = {}) {
    super()

    this._enabled          = options.enabled !== false   // on by default
    this._interval         = null
    this._suppressUntil    = 0
    this._lastActivity     = Date.now()
    this._lastTrigger      = {}                          // type → timestamp
    this._seenCalEvents    = new Set()                   // prevent double alerts
    this._seenMail         = new Set()                   // sender+subject pairs
    this._morningDate      = null                        // date string of last morning briefing
    this._eveningDate      = null                        // date string of last evening wrap
    this._interviewActive  = false

    // Purge seen-sets every 4 h to avoid unbounded growth
    setInterval(() => {
      this._seenCalEvents.clear()
      this._seenMail.clear()
    }, SEEN_PURGE_MS)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() {
    if (this._interval) return
    this._interval = setInterval(() => this._check(), POLL_INTERVAL_MS)
    // First check after 45 seconds — let everything settle after launch
    setTimeout(() => this._check(), 45_000)
    console.log('[Proactive] Engine started (60s poll)')
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null }
    console.log('[Proactive] Engine stopped')
  }

  /** Call whenever user types or sends a message */
  recordActivity() {
    this._lastActivity = Date.now()
    // Suppress proactive chatter while user is actively talking to NOVA
    this._suppressUntil = Date.now() + ACTIVITY_SUPPRESS_MS
  }

  /** Hard suppress — e.g. during Interview Mode */
  suppress(durationMs = 60 * 60_000) {
    this._suppressUntil = Date.now() + durationMs
    console.log(`[Proactive] Suppressed for ${Math.round(durationMs / 60_000)} min`)
  }

  /** Lift suppression — e.g. when Interview Mode ends */
  unsuppress() {
    this._suppressUntil = 0
    console.log('[Proactive] Suppression lifted')
  }

  setInterviewMode(active) {
    this._interviewActive = active
    if (active) this.suppress(24 * 60 * 60_000) // suppress all day during interview
    else        this.unsuppress()
  }

  setEnabled(val) {
    this._enabled = Boolean(val)
    console.log('[Proactive] Enabled:', this._enabled)
  }

  getStatus() {
    const suppressedUntil = this._suppressUntil > Date.now()
      ? new Date(this._suppressUntil).toISOString()
      : null
    return {
      enabled:         this._enabled,
      interview:       this._interviewActive,
      suppressedUntil,
      idleMs:          Date.now() - this._lastActivity,
      nightMode:       this._isNightHours(),
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _isSuppressed() {
    return Date.now() < this._suppressUntil
  }

  _isNightHours() {
    const h = new Date().getHours()
    return h >= NIGHT_START_H || h < NIGHT_END_H
  }

  _canTrigger(type) {
    const last = this._lastTrigger[type] || 0
    return Date.now() - last > TRIGGER_DEBOUNCE_MS
  }

  _markTriggered(type) {
    this._lastTrigger[type] = Date.now()
  }

  async _check() {
    if (!this._enabled)        return
    if (this._interviewActive) return
    if (this._isSuppressed())  return
    if (this._isNightHours())  return

    const now      = new Date()
    const hour     = now.getHours()
    const min      = now.getMinutes()
    const today    = now.toDateString()
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5

    // ── 1. Morning briefing — 08:00 weekdays ──────────────────────────────────
    if (hour === 8 && min < 5 && isWeekday &&
        this._morningDate !== today && this._canTrigger('morning_briefing')) {
      this._morningDate = today
      this._markTriggered('morning_briefing')
      this.emit('trigger', {
        type:     'morning_briefing',
        mode:     'api',
        message:  'Give me my morning briefing — what does my day look like and what should I tackle first?',
        priority: 'high',
      })
      return   // one trigger per poll cycle
    }

    // ── 2. Evening wrap — 18:00 weekdays ─────────────────────────────────────
    if (hour === 18 && min < 5 && isWeekday &&
        this._eveningDate !== today && this._canTrigger('evening_wrap')) {
      this._eveningDate = today
      this._markTriggered('evening_wrap')
      this.emit('trigger', {
        type:     'evening_wrap',
        mode:     'api',
        message:  "Evening wrap — what did we accomplish today? What needs carrying over tomorrow?",
        priority: 'medium',
      })
      return
    }

    // ── 3. Calendar alert — 15 min before event ───────────────────────────────
    if (this._canTrigger('calendar')) {
      const event = await this._getImminentCalendarEvent()
      if (event) {
        this._markTriggered('calendar')
        const minsStr = event.minutesUntil <= 1 ? 'now' : `in ${Math.round(event.minutesUntil)} minutes`
        this.emit('trigger', {
          type:     'calendar_alert',
          mode:     'instant',
          text:     `Mr. V — "${event.title}" starts ${minsStr}.`,
          priority: 'high',
          meta:     event,
        })
        return
      }
    }

    // ── 4. New mail — check Mail.app ──────────────────────────────────────────
    if (this._canTrigger('mail')) {
      const mail = await this._checkNewMail()
      if (mail) {
        this._markTriggered('mail')
        const fromStr = mail.sender.length > 40 ? mail.sender.slice(0, 40) + '…' : mail.sender
        this.emit('trigger', {
          type:     'new_mail',
          mode:     'instant',
          text:     `New email from ${fromStr}, Mr. V.`,
          priority: 'low',
          meta:     mail,
        })
        return
      }
    }

    // ── 5. Idle check-in — 30 min no activity ────────────────────────────────
    const idleMs = Date.now() - this._lastActivity
    if (idleMs > IDLE_THRESHOLD_MS && this._canTrigger('idle_checkin')) {
      this._markTriggered('idle_checkin')
      const idleMin = Math.round(idleMs / 60_000)
      this.emit('trigger', {
        type:     'idle_checkin',
        mode:     'instant',
        text:     `${idleMin} minutes quiet, Mr. V. Anything you need?`,
        priority: 'low',
      })
    }
  }

  // ── Calendar polling ────────────────────────────────────────────────────────

  async _getImminentCalendarEvent() {
    const script = `
tell application "Calendar"
  set theDate to current date
  set targetDate to theDate + (${CALENDAR_ALERT_MINS} * minutes)
  set resultStr to ""
  repeat with aCal in every calendar
    try
      set evts to (every event of aCal whose start date >= theDate and start date <= targetDate)
      if (count of evts) > 0 then
        set anEvent to item 1 of evts
        set resultStr to (summary of anEvent) & "|||" & ((start date of anEvent) as string)
        exit repeat
      end if
    end try
  end repeat
  return resultStr
end tell`

    try {
      const out = await runAppleScript(script)
      if (!out) return null

      const [title, dateStr] = out.split('|||')
      if (!title || !dateStr) return null

      // Deduplicate — don't alert for the same event twice
      const key = `${title.trim()}_${dateStr.trim()}`
      if (this._seenCalEvents.has(key)) return null
      this._seenCalEvents.add(key)

      const startDate    = new Date(dateStr.trim())
      const minutesUntil = Math.max(0, (startDate - new Date()) / 60_000)

      return { title: title.trim(), minutesUntil, startDate: startDate.toISOString() }
    } catch {
      return null
    }
  }

  // ── Mail polling ────────────────────────────────────────────────────────────

  async _checkNewMail() {
    const script = `
tell application "Mail"
  try
    set unreadMsgs to messages of inbox whose read status is false
    if (count of unreadMsgs) > 0 then
      set firstMsg to item 1 of unreadMsgs
      return (sender of firstMsg) & "|||" & (subject of firstMsg)
    end if
  end try
  return ""
end tell`

    try {
      const out = await runAppleScript(script)
      if (!out) return null

      const [sender, subject] = out.split('|||')
      if (!sender) return null

      const key = `${sender.trim()}_${(subject || '').trim()}`
      if (this._seenMail.has(key)) return null
      this._seenMail.add(key)

      return { sender: sender.trim(), subject: (subject || '').trim() }
    } catch {
      return null
    }
  }
}

module.exports = { ProactiveEngine }
