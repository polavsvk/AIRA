import React, { useState, useEffect } from 'react'
import { Zap, Wifi } from 'lucide-react'

export default function Header({ isOnline }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const formatDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-aira-border bg-aira-darker relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-aira-blue/10 to-transparent scan-line" />
      </div>

      {/* Left — Logo */}
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-aira-blue/40 arc-pulse" />
          <div className="absolute inset-1 rounded-full border border-aira-blue/20" />
          <Zap className="w-4 h-4 text-aira-blue relative z-10" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-aira-blue glow-text tracking-widest font-mono">NOVA</h1>
            <span className="text-xs text-aira-text-dim font-mono border border-aira-border px-2 py-0.5 rounded">v2.0</span>
          </div>
          <p className="text-xs text-aira-text-dim font-mono tracking-wider">AI Personal Assistant · Mr. V</p>
        </div>
      </div>

      {/* Center — Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-aira-green status-blink' : 'bg-aira-red'}`} />
          <span className="text-xs font-mono text-aira-text-dim">{isOnline ? 'SYSTEMS ONLINE' : 'OFFLINE'}</span>
        </div>
        <div className="h-4 w-px bg-aira-border" />
        <div className="flex items-center gap-1 text-xs font-mono text-aira-text-dim">
          <Wifi className="w-3 h-3 text-aira-blue" />
          <span>GROQ · LLaMA 3.3 70B</span>
        </div>
      </div>

      {/* Right — Time */}
      <div className="text-right">
        <div className="text-sm font-mono text-aira-blue">{formatTime(time)}</div>
        <div className="text-xs font-mono text-aira-text-dim">{formatDate(time)}</div>
      </div>
    </header>
  )
}
