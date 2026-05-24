import React, { useState } from 'react'
import { Radio, X, ChevronRight } from 'lucide-react'
import axios from 'axios'

export default function DailyBriefing({ onClose, onSendToChat }) {
  const [loading, setLoading] = useState(false)
  const [briefing, setBriefing] = useState(null)

  const generateBriefing = async () => {
    setLoading(true)
    try {
      const [weatherRes, newsRes, tasksRes] = await Promise.all([
        axios.get('/api/weather?city=London'),
        axios.get('/api/news?category=general'),
        axios.get('/api/tasks/'),
      ])

      const weather = weatherRes.data.current
      const articles = newsRes.data.articles.slice(0, 3)
      const pendingTasks = tasksRes.data.filter(t => !t.completed).slice(0, 3)

      const prompt = `Please give me a concise morning briefing, Mr. V style.

Current weather: ${weather.temperature}°C, ${weather.description}, humidity ${weather.humidity}%, wind ${weather.wind_speed} km/h.

Top news today:
${articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n')}

Pending tasks:
${pendingTasks.length > 0 ? pendingTasks.map((t, i) => `${i + 1}. [${t.priority.toUpperCase()}] ${t.title}`).join('\n') : 'No pending tasks — a clean slate.'}

Please format this as a sharp, JARVIS-style morning briefing. Keep it concise and useful.`

      setBriefing({ prompt, weather, articles, pendingTasks })
    } catch (err) {
      console.error('Briefing generation failed:', err)
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
          <button onClick={onClose} className="text-aira-text-dim hover:text-aira-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {!briefing && !loading && (
            <div className="text-center py-6">
              <Radio className="w-12 h-12 text-aira-blue/30 mx-auto mb-3" />
              <p className="text-sm text-aira-text mb-1">Good morning, Mr. V.</p>
              <p className="text-xs text-aira-text-dim mb-4">
                Request a morning briefing — I'll pull your weather, top news, and pending tasks into a single, sharp summary.
              </p>
              <button onClick={generateBriefing} className="aira-btn-primary">
                Generate Briefing
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center py-6">
              <div className="w-10 h-10 border-2 border-aira-blue/30 border-t-aira-blue rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-aira-text-dim font-mono">Compiling briefing data, Mr. V...</p>
            </div>
          )}

          {briefing && !loading && (
            <div className="space-y-3">
              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-2">WEATHER SNAPSHOT</p>
                <p className="text-sm text-aira-text">
                  {briefing.weather.temperature}°C · {briefing.weather.description} · {briefing.weather.city}
                </p>
              </div>

              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-2">TOP STORIES ({briefing.articles.length})</p>
                <div className="space-y-1">
                  {briefing.articles.map((a, i) => (
                    <p key={i} className="text-xs text-aira-text line-clamp-1">
                      <span className="text-aira-blue mr-1">{i + 1}.</span>{a.title}
                    </p>
                  ))}
                </div>
              </div>

              <div className="bg-aira-darker rounded-lg p-3 border border-aira-border">
                <p className="text-xs text-aira-text-dim font-mono mb-2">
                  PENDING TASKS ({briefing.pendingTasks.length})
                </p>
                {briefing.pendingTasks.length === 0 ? (
                  <p className="text-xs text-aira-text">Clear agenda, Mr. V.</p>
                ) : (
                  <div className="space-y-1">
                    {briefing.pendingTasks.map((t, i) => (
                      <p key={i} className="text-xs text-aira-text">
                        <span className="text-aira-blue mr-1">{i + 1}.</span>{t.title}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={sendBriefing}
                className="w-full aira-btn-primary flex items-center justify-center gap-2"
              >
                <span>Get Full AIRA Briefing</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
