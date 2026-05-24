import React, { useState, useEffect } from 'react'
import { Radio, X, ChevronRight, RefreshCw } from 'lucide-react'
import axios from 'axios'

export default function DailyBriefing({ onClose, onSendToChat }) {
  const [loading, setLoading] = useState(true)
  const [briefing, setBriefing] = useState(null)
  const [error, setError] = useState(null)

  // Auto-generate briefing when modal opens
  useEffect(() => { generateBriefing() }, [])

  const generateBriefing = async () => {
    setLoading(true)
    setError(null)
    setBriefing(null)
    try {
      const [weatherRes, newsRes, tasksRes] = await Promise.all([
        axios.get('/api/weather/').catch(() => null),
        axios.get('/api/news?category=general').catch(() => null),
        axios.get('/api/tasks/').catch(() => ({ data: [] })),
      ])

      const weather = weatherRes?.data?.current
      const articles = (newsRes?.data?.articles || []).slice(0, 3)
      const pendingTasks = (tasksRes?.data || []).filter(t => !t.completed).slice(0, 5)

      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

      const prompt = `Good ${getTimeOfDay()}, AIRA. Please give me my morning briefing. Keep it sharp, JARVIS-style — concise and useful, not lengthy.

Time: ${timeStr}, ${dateStr}

${weather ? `Weather: ${weather.temperature}°C, ${weather.description} in ${weather.city}. Humidity ${weather.humidity}%, wind ${weather.wind_speed} km/h.` : 'Weather: unavailable.'}

Top news:
${articles.length > 0 ? articles.map((a, i) => `${i + 1}. ${a.title} (${a.source})`).join('\n') : 'No news available.'}

My tasks today:
${pendingTasks.length > 0 ? pendingTasks.map((t, i) => `${i + 1}. [${t.priority.toUpperCase()}] ${t.title}`).join('\n') : 'No pending tasks — clear day ahead.'}

Give me a sharp, FRIDAY-style briefing. Address me as Mr. V. Keep it punchy — 3 to 5 sentences max unless the tasks or news demand more detail.`

      setBriefing({ prompt, weather, articles, pendingTasks, time: timeStr, date: dateStr })
    } catch (err) {
      setError('Unable to generate briefing. Check your connection.')
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
      <div className="aira-panel w-full max-w-lg mx-4 shadow-aira-glow-strong">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-aira-border">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-aira-blue" />
            <span className="text-sm font-mono text-aira-blue tracking-widest">DAILY BRIEFING</span>
          </div>
          <div className="flex items-center gap-3">
            {!loading && (
              <button onClick={generateBriefing} className="text-aira-text-dim hover:text-aira-blue transition-colors" title="Refresh briefing">
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="text-aira-text-dim hover:text-aira-text transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {loading && (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-2 border-aira-blue/30 border-t-aira-blue rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-aira-text-dim font-mono">Compiling briefing data, Mr. V…</p>
              <p className="text-xs text-aira-text-dim/50 font-mono mt-1">Fetching weather · news · tasks</p>
            </div>
          )}

          {error && (
            <div className="text-center py-6">
              <p className="text-xs text-red-400 mb-3">{error}</p>
              <button onClick={generateBriefing} className="aira-btn-primary text-xs">Retry</button>
            </div>
          )}

          {briefing && !loading && (
            <div className="space-y-3">
              {/* Time */}
              <div className="text-center pb-1">
                <p className="text-xs text-aira-text-dim font-mono">{briefing.date} · {briefing.time}</p>
              </div>

              {/* Weather */}
              {briefing.weather && (
                <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                  <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">WEATHER</p>
                  <p className="text-sm text-aira-text">
                    {briefing.weather.temperature}°C · {briefing.weather.description} · {briefing.weather.city}
                  </p>
                  <p className="text-xs text-aira-text-dim mt-0.5">
                    Feels like {briefing.weather.feels_like}°C · Humidity {briefing.weather.humidity}% · Wind {briefing.weather.wind_speed} km/h
                  </p>
                </div>
              )}

              {/* News */}
              {briefing.articles.length > 0 && (
                <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                  <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">TOP STORIES</p>
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
                </div>
              )}

              {/* Tasks */}
              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-1.5 tracking-widest">
                  TASKS ({briefing.pendingTasks.length} pending)
                </p>
                {briefing.pendingTasks.length === 0 ? (
                  <p className="text-xs text-aira-green">Clear agenda, Mr. V. ✓</p>
                ) : (
                  <div className="space-y-1">
                    {briefing.pendingTasks.map((t, i) => (
                      <p key={i} className="text-xs text-aira-text">
                        <span className="text-aira-blue mr-1">{i + 1}.</span>
                        <span className={`mr-1 text-xs font-mono px-1 rounded ${
                          t.priority === 'high' ? 'text-red-400' : t.priority === 'low' ? 'text-green-400' : 'text-yellow-400'
                        }`}>[{t.priority.toUpperCase()}]</span>
                        {t.title}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={sendBriefing}
                className="w-full aira-btn-primary flex items-center justify-center gap-2 text-sm">
                <Radio className="w-4 h-4" />
                <span>Get AIRA's Full Briefing</span>
                <ChevronRight className="w-4 h-4" />
              </button>

              <p className="text-xs text-aira-text-dim text-center font-mono">
                AIRA will read the briefing aloud in voice mode
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
