/**
 * NOVA First Day Interview
 * ─────────────────────────
 * 5-minute onboarding that seeds 80% of Mr. V's rules on Day 1.
 * Shows once on first launch. Skippable (defaults are sensible).
 *
 * Design: full-screen dark overlay, one question at a time,
 * Iron Man HUD aesthetic — feels like suit initialisation.
 */

import { useState } from 'react'
import { ChevronRight, ChevronLeft, Check, Zap, Shield, Eye, EyeOff, Plus, X } from 'lucide-react'

const API = 'http://localhost:8000'

// ── Questions ─────────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 'welcome',
    type: 'welcome',
    title: 'NOVA INITIALISING',
    subtitle: 'Five minutes. Then you never have to touch a computer again.',
  },
  {
    id: 'identity',
    type: 'text_fields',
    title: 'Who are you?',
    subtitle: "NOVA uses this to address you correctly and fill forms.",
    fields: [
      { key: 'preferred_name', label: 'What should NOVA call you?', placeholder: 'Mr. V', required: true },
      { key: 'full_name',      label: 'Full name (for forms)', placeholder: 'Vamsi Krishna Pola' },
      { key: 'email',          label: 'Email address', placeholder: 'you@example.com' },
      { key: 'profession',     label: 'What do you do?', placeholder: 'Software Engineer / Student / ...' },
      { key: 'university',     label: 'University (if applicable)', placeholder: 'Missouri S&T' },
      { key: 'location',       label: 'City / Country', placeholder: 'Rolla, Missouri, USA' },
    ],
  },
  {
    id: 'automation',
    type: 'toggles',
    title: 'What should NOVA handle automatically?',
    subtitle: "These become active rules from Day 1 — no waiting for pattern learning.",
    toggles: [
      {
        key: 'skip_youtube_ads',
        label: 'Skip YouTube ads instantly',
        description: 'NOVA kills every ad before you notice it. Zero interruptions.',
        default: true,
      },
      {
        key: 'dismiss_cookie_banners',
        label: 'Dismiss cookie consent banners',
        description: 'Auto-clicks "Accept" or "Decline" on every cookie popup.',
        default: true,
      },
      {
        key: 'dismiss_browser_notifications',
        label: 'Dismiss browser notification requests',
        description: '"Allow notifications?" → dismissed automatically.',
        default: true,
      },
    ],
  },
  {
    id: 'morning',
    type: 'app_list',
    title: 'Morning routine',
    subtitle: "Which apps should NOVA open automatically every morning?",
    key: 'morning_apps',
    suggestions: ['Gmail', 'Slack', 'Notion', 'Spotify', 'Chrome', 'VS Code', 'Terminal'],
  },
  {
    id: 'privacy',
    type: 'privacy',
    title: 'Privacy mode',
    subtitle: "NOVA watches your screen to help. How much visibility is too much?",
    key: 'max_privacy_mode',
  },
  {
    id: 'complete',
    type: 'complete',
    title: 'NOVA ONLINE',
    subtitle: "All systems initialised. You can change any of this later.",
  },
]


// ── Component ─────────────────────────────────────────────────────────────────

export default function FirstDayInterview({ onComplete }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({
    preferred_name: '',
    full_name: '',
    email: '',
    profession: '',
    university: '',
    location: '',
    skip_youtube_ads: true,
    dismiss_cookie_banners: true,
    dismiss_browser_notifications: true,
    morning_apps: [],
    max_privacy_mode: false,
    extra_sensitive_domains: [],
    extra_facts: [],
  })
  const [appInput, setAppInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const current = STEPS[step]
  const isFirst = step === 0
  const isLast  = step === STEPS.length - 1

  function update(key, val) {
    setAnswers(prev => ({ ...prev, [key]: val }))
  }

  function addApp(app) {
    const trimmed = app.trim()
    if (!trimmed || answers.morning_apps.includes(trimmed)) return
    update('morning_apps', [...answers.morning_apps, trimmed])
    setAppInput('')
  }

  function removeApp(app) {
    update('morning_apps', answers.morning_apps.filter(a => a !== app))
  }

  async function submit() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      })
      const data = await res.json()
      if (data.success) {
        onComplete(data)
      } else {
        setError(data.message || 'Something went wrong.')
      }
    } catch (e) {
      setError('Could not reach NOVA backend. Is it running?')
    } finally {
      setSubmitting(false)
    }
  }

  function next() {
    if (isLast) { submit(); return }
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  function back() {
    setStep(s => Math.max(s - 1, 0))
  }

  // Progress bar
  const progress = ((step) / (STEPS.length - 1)) * 100

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm">
      {/* Suit-init decorative corners */}
      <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-sky-500/40" />
      <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-sky-500/40" />
      <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-sky-500/40" />
      <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-sky-500/40" />

      <div className="w-full max-w-lg px-6 flex flex-col gap-6">

        {/* ── Progress ── */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-zinc-800">
            <div
              className="h-full bg-sky-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-zinc-600 font-mono tabular-nums">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* ── Content ── */}
        <div className="min-h-[340px] flex flex-col">
          <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
            {current.title}
          </h1>
          <p className="text-sm text-zinc-400 mb-6">{current.subtitle}</p>

          {/* WELCOME */}
          {current.type === 'welcome' && (
            <div className="flex flex-col gap-4 text-zinc-400 text-sm leading-relaxed">
              <p>NOVA needs to know how you think to act without asking.</p>
              <p>Answer these questions once. NOVA loads your rules on every launch.</p>
              <p className="text-zinc-600">Skip anything you'd rather not share. Defaults are sensible.</p>
              <div className="mt-4 flex items-center gap-2 text-sky-400">
                <Zap size={14} />
                <span>~5 minutes. One-time only.</span>
              </div>
            </div>
          )}

          {/* TEXT FIELDS */}
          {current.type === 'text_fields' && (
            <div className="flex flex-col gap-3">
              {current.fields.map(f => (
                <div key={f.key}>
                  <label className="text-xs text-zinc-500 mb-1 block">{f.label}</label>
                  <input
                    value={answers[f.key] || ''}
                    onChange={e => update(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
              ))}
            </div>
          )}

          {/* TOGGLES */}
          {current.type === 'toggles' && (
            <div className="flex flex-col gap-3">
              {current.toggles.map(t => (
                <button
                  key={t.key}
                  onClick={() => update(t.key, !answers[t.key])}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all text-left
                    ${answers[t.key]
                      ? 'border-sky-500/50 bg-sky-500/5'
                      : 'border-zinc-800 bg-zinc-900/50 opacity-60'}`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
                    ${answers[t.key] ? 'border-sky-500 bg-sky-500' : 'border-zinc-600'}`}>
                    {answers[t.key] && <Check size={10} className="text-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{t.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* APP LIST */}
          {current.type === 'app_list' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {answers.morning_apps.map(app => (
                  <span key={app}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs">
                    {app}
                    <button onClick={() => removeApp(app)} className="text-sky-500 hover:text-sky-300">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {answers.morning_apps.length === 0 && (
                  <span className="text-zinc-600 text-xs">None selected — add from suggestions below</span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  value={appInput}
                  onChange={e => setAppInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addApp(appInput) }}
                  placeholder="Type any app name…"
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-sky-500"
                />
                <button onClick={() => addApp(appInput)}
                  className="px-3 py-2 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-400 hover:bg-sky-500/30 transition-colors">
                  <Plus size={14} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-1">
                {current.suggestions.filter(s => !answers.morning_apps.includes(s)).map(s => (
                  <button key={s} onClick={() => addApp(s)}
                    className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 hover:text-white transition-colors">
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PRIVACY */}
          {current.type === 'privacy' && (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => update('max_privacy_mode', false)}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left
                  ${!answers.max_privacy_mode ? 'border-sky-500/50 bg-sky-500/5' : 'border-zinc-800 bg-zinc-900/50 opacity-60'}`}
              >
                <Eye size={16} className="text-sky-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Standard mode</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    NOVA watches your screen every 5 seconds. Sensitive screens (banking, .gov, passwords) are always skipped.
                    Vision analysis sent to Groq — your free API key.
                  </p>
                </div>
              </button>

              <button
                onClick={() => update('max_privacy_mode', true)}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left
                  ${answers.max_privacy_mode ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/50 opacity-60'}`}
              >
                <EyeOff size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Maximum privacy</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    No screenshots ever sent to cloud. Vision features disabled.
                    NOVA still does everything via Chrome DOM — just no native app vision.
                  </p>
                </div>
              </button>

              <div className="flex items-start gap-2 mt-1 text-zinc-600 text-xs">
                <Shield size={11} className="mt-0.5 shrink-0" />
                <span>You can change this anytime from the tray menu → Privacy.</span>
              </div>
            </div>
          )}

          {/* COMPLETE */}
          {current.type === 'complete' && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-2 text-emerald-400">
                <Check size={16} />
                <span>Rules seeded. NOVA starts working immediately.</span>
              </div>
              <div className="flex items-center gap-2 text-sky-400">
                <Zap size={16} />
                <span>Pattern learning is active. NOVA adapts as you work.</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <Shield size={16} />
                <span>
                  {answers.max_privacy_mode ? 'Maximum privacy mode on.' : 'Sensitive-screen filter always active.'}
                </span>
              </div>
              <p className="text-zinc-600 mt-2">
                Say <span className="text-zinc-400">"Hey NOVA"</span> to start.
                Say <span className="text-zinc-400">"NOVA freeze"</span> to pause automation.
              </p>
              {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
            </div>
          )}
        </div>

        {/* ── Nav buttons ── */}
        <div className="flex items-center justify-between">
          <button
            onClick={back}
            disabled={isFirst}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-zinc-500 hover:text-white text-sm transition-colors disabled:opacity-0"
          >
            <ChevronLeft size={14} />
            Back
          </button>

          {!isLast && (
            <button
              onClick={() => { submit() }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip all →
            </button>
          )}

          <button
            onClick={next}
            disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? 'Starting…' : isLast ? 'Launch NOVA' : 'Continue'}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
