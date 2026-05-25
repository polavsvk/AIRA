import React, { useState, useEffect } from 'react'
import { Radio, X, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react'
import axios from 'axios'

export default function DailyBriefing({ onClose, onSendToChat }) {
  const [loading, setLoading] = useState(true)
  const [briefing, setBriefing] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { generateBriefing() }, [])

  const generateBriefing = async () => {
    setLoading(true)
    setError(null)
    setBriefing(null)

    try {
      const [weatherRes, newsRes, tasksRes] = await Promise.allSettled([
        axios.get('/api/weather/', { timeout: 8000 }),
        axios.get('/api/news?category=general', { timeout: 8000 }),
        axios.get('/api/tasks/', { timeout: 8000 }),
      ])

      const weatherData = weatherRes.status === 'fulfilled' ? weatherRes.value.data : null
      const weather = weatherData?.current || null
      const articles = newsRes.status === 'fulfilled' ? (newsRes.value.data?.articles || []).slice(0, 5) : []
      const allTasks = tasksRes.status === 'fulfilled' ? (tasksRes.value.data || []) : []
      const pendingTasks = allTasks.filter(t => !t.completed)

      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

      // Build strict, factual prompt — AI must NOT invent data
      const weatherSection = weather
        ? `REAL WEATHER DATA (use exactly):
  Location: ${weather.city}${weather.country ? `, ${weather.country}` : ''}
  Temperature: ${weather.temperature}°C (feels like ${weather.feels_like}°C)
  Condition: ${weather.description}
  Humidity: ${weather.humidity}%
  Wind: ${weather.wind_speed} km/h`
        : `WEATHER DATA: UNAVAILABLE — do NOT invent weather. Say "Weather data unavailable."`

      const newsSection = articles.length > 0
        ? `REAL NEWS HEADLINES (summarise only these — do NOT add other stories):
${articles.map((a, i) => `  ${i + 1}. "${a.title}" — ${a.source} (${a.publishedAt})`).join('\n')}`
        : `NEWS DATA: UNAVAILABLE — do NOT invent news stories. Say "No news data available."`

      const tasksSection = pendingTasks.length > 0
        ? `REAL PENDING TASKS (only these — do NOT invent meetings, flights, calls):
${pendingTasks.map((t, i) => `  ${i + 1}. [${t.priority.toUpperCase()}] ${t.title}${t.due_date ? ` — due ${t.due_date}` : ''}${t.description ? ` (${t.description})` : ''}`).join('\n')}`
        : `TASKS: NONE PENDING — do NOT invent tasks. Say "No pending tasks."`

      const prompt = `NOVA DAILY BRIEFING REQUEST
Time: ${timeStr} — ${dateStr}

⚠️ STRICT INSTRUCTION: You are receiving REAL live data below.
Use ONLY this data. Do NOT invent any information.
Do NOT add weather, news, tasks, meetings, flights, or anything not listed here.
If data is missing, say so briefly and move on.

---
${weatherSection}

---
${newsSection}

---
${tasksSection}

---

Now give Mr. V a sharp, FRIDAY-style morning briefing using ONLY the real data above.
Keep it punchy — 3 to 6 sentences total. Lead with the most important thing.
Do not use bullet points — speak naturally, like FRIDAY briefing Tony Stark.`

      setBriefing({ prompt, weather, articles, pendingTasks, timeStr, dateStr, weatherData })
    } catch (err) {
      setError('Failed to compile briefing data.')
    } finally {
      setLoading(false)
    }
  }

  const sendBriefing = () => {
    if (briefing?.prompt) {
      onSendToChat(briefing.prompt)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="aira-panel w-full max-w-lg mx-4 shadow-aira-glow-strong max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-aira-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-aira-blue" />
            <span className="text-sm font-mono text-aira-blue tracking-widest">DAILY BRIEFING</span>
          </div>
          <div className="flex items-center gap-3">
            {!loading && (
              <button onClick={generateBriefing} className="text-aira-text-dim hover:text-aira-blue transition-colors" title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="text-aira-text-dim hover:text-aira-text transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading && (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-2 border-aira-blue/30 border-t-aira-blue rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-aira-text-dim font-mono">Pulling live data, Mr. V…</p>
              <p className="text-xs text-aira-text-dim/40 font-mono mt-1">weather · news · tasks</p>
            </div>
          )}

          {error && (
            <div className="text-center py-6">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-xs text-red-400 mb-3">{error}</p>
              <button onClick={generateBriefing} className="aira-btn-primary text-xs">Retry</button>
            </div>
          )}

          {briefing && !loading && (
            <div className="space-y-3">

              <p className="text-xs text-aira-text-dim font-mono text-center">{briefing.dateStr} · {briefing.timeStr}</p>

              {/* Weather */}
              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">LIVE WEATHER</p>
                {briefing.weather ? (
                  <>
                    <p className="text-sm text-aira-text font-medium">
                      {briefing.weather.temperature}°C · {briefing.weather.description}
                    </p>
                    <p className="text-xs text-aira-text-dim">
                      {briefing.weather.city} · Feels {briefing.weather.feels_like}°C · {briefing.weather.humidity}% humidity
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Weather API unavailable
                  </p>
                )}
              </div>

              {/* News */}
              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">LIVE NEWS ({briefing.articles.length} stories)</p>
                {briefing.articles.length > 0 ? (
                  <div className="space-y-1.5">
                    {briefing.articles.map((a, i) => (
                      <div key={i}>
                        <p className="text-xs text-aira-text line-clamp-1">
                          <span className="text-aira-blue mr-1">{i + 1}.</span>{a.title}
                        </p>
                        <p className="text-xs text-aira-text-dim ml-3">{a.source} · {a.publishedAt}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> News API unavailable
                  </p>
                )}
              </div>

              {/* Tasks */}
              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">
                  YOUR TASKS ({briefing.pendingTasks.length} pending)
                </p>
                {briefing.pendingTasks.length === 0 ? (
                  <p className="text-xs text-aira-green">Clear agenda, Mr. V.</p>
                ) : (
                  <div className="space-y-1">
                    {briefing.pendingTasks.map((t, i) => (
                      <p key={i} className="text-xs text-aira-text flex items-start gap-1">
                        <span className="text-aira-blue mt-0.5">{i + 1}.</span>
                        <span className={`font-mono text-xs shrink-0 ${
                          t.priority === 'high' ? 'text-red-400' : t.priority === 'low' ? 'text-green-400' : 'text-yellow-400'
                        }`}>[{t.priority.toUpperCase()}]</span>
                        <span>{t.title}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={sendBriefing}
                className="w-full aira-btn-primary flex items-center justify-center gap-2">
                <Radio className="w-4 h-4" />
                <span>Brief Me, NOVA</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
