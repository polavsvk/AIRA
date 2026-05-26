import React, { useEffect, useState } from 'react'
import ArcReactor from './ArcReactor'
import VoiceWaveform from './VoiceWaveform'
import axios from 'axios'

/**
 * NOVA HUD — top-of-chat command center
 * ──────────────────────────────────────
 * Arc reactor core + live status readouts on either side.
 * Always visible. Always alive. This is what makes it feel less chatbot.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  ┌── LEFT READOUTS ──┐    ⚡ ARC REACTOR ⚡    ┌─ RIGHT READOUTS ─┐ │
 *   │  │ STATE: standby    │    (rotating, pulsing)  │ AGENTS: 7        │ │
 *   │  │ AGENT: ATLAS      │                         │ INTERVIEW: off   │ │
 *   │  │ TIME:  10:42 AM   │    ▁▂▃▅▇▅▃▂▁          │ MEM: 24 facts    │ │
 *   │  └───────────────────┘                         └──────────────────┘ │
 *   └────────────────────────────────────────────────────────────────┘
 */

const STATE_LABEL = {
  idle: 'standby',
  listening_wake: 'listening',
  listening_command: 'capturing',
  speaking: 'speaking',
  processing: 'processing',
  paused: 'paused',
  interview_mode: 'interview mode',
  error: 'voice error',
  wake_flash: 'wake detected',
}

const STATE_COLORS = {
  idle: 'text-blue-400',
  listening_wake: 'text-blue-400',
  listening_command: 'text-red-400',
  speaking: 'text-emerald-400',
  processing: 'text-amber-400',
  paused: 'text-gray-400',
  interview_mode: 'text-red-500',
  error: 'text-red-500',
  wake_flash: 'text-cyan-300',
}

function Readout({ label, value, color = 'text-aira-blue', mono = true, dim = false }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono tracking-[0.2em] text-aira-text-dim/50">{label}</span>
      <span className={`text-xs ${mono ? 'font-mono' : ''} ${color} ${dim ? 'opacity-60' : ''} tracking-wide hud-flicker`}>
        {value}
      </span>
    </div>
  )
}

export default function NovaHUD({
  voiceState = 'idle',
  activeAgent = 'NOVA',
  speaking = false,
  wakeFlash = false,
  interviewMode = false,
  voiceEnabled = true,
  liveCommand = '',
  size = 200,
  proactiveEnabled = true,
  recentTriggerType = null,
}) {
  // Effective state for the reactor & label
  let effectiveState = voiceState
  if (interviewMode) effectiveState = 'interview_mode'
  else if (wakeFlash) effectiveState = 'wake_flash'
  else if (speaking) effectiveState = 'speaking'

  const labelText = STATE_LABEL[effectiveState] || 'idle'
  const labelColor = STATE_COLORS[effectiveState] || 'text-blue-400'

  // Live time
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Fleet status — poll backend
  const [fleetCount, setFleetCount] = useState(7)
  const [markCount, setMarkCount] = useState(0)
  const [memFacts, setMemFacts] = useState(null)

  useEffect(() => {
    const fetchFleet = async () => {
      try {
        const r = await axios.get('/api/agents/status', { timeout: 3000 })
        setFleetCount(r.data?.total_agents || 7)
        setMarkCount(r.data?.active_marks || 0)
      } catch {}
    }
    const fetchMem = async () => {
      try {
        const r = await axios.get('/api/memory/facts', { timeout: 3000 })
        const count = Array.isArray(r.data?.facts) ? r.data.facts.length :
                      r.data?.facts ? Object.keys(r.data.facts).length : 0
        setMemFacts(count)
      } catch {}
    }
    fetchFleet(); fetchMem()
    const ia = setInterval(fetchFleet, 5000)
    const ib = setInterval(fetchMem, 15000)
    return () => { clearInterval(ia); clearInterval(ib) }
  }, [])

  // Waveform color follows state
  const waveformColor =
    interviewMode ? '#dc2626' :
    effectiveState === 'listening_command' ? '#f87171' :
    effectiveState === 'speaking' ? '#34d399' :
    effectiveState === 'processing' ? '#fbbf24' :
    effectiveState === 'wake_flash' ? '#67e8f9' :
                                     '#3b82f6'

  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()

  return (
    <div className="relative w-full hud-grid-bg hud-scan-sweep overflow-hidden border-b border-aira-border"
         style={{ minHeight: size + 60 }}>

      {/* Faint horizontal lines */}
      <div className="absolute inset-0 pointer-events-none"
           style={{
             backgroundImage: 'repeating-linear-gradient(0deg, transparent 0, transparent 24px, rgba(59,130,246,0.03) 24px, rgba(59,130,246,0.03) 25px)',
           }} />

      <div className="relative flex items-center justify-between px-6 py-4 gap-4">

        {/* ── LEFT READOUTS ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 min-w-[140px]">
          <Readout label="◢ STATE"  value={labelText.toUpperCase()} color={labelColor} />
          <Readout label="◢ AGENT"  value={activeAgent || 'NOVA'} />
          <Readout label="◢ CHRONO" value={timeStr} color="text-cyan-300" />
          <Readout label=""         value={dateStr} dim />
        </div>

        {/* ── CENTRE: Arc Reactor + Waveform ──────────────────────────── */}
        <div className="flex flex-col items-center gap-2">
          <ArcReactor
            state={voiceState}
            activeAgent={activeAgent}
            wakeFlash={wakeFlash}
            interviewMode={interviewMode}
            size={size}
          />
          {/* Live waveform under the reactor */}
          <div className="mt-3">
            <VoiceWaveform
              state={effectiveState}
              color={waveformColor}
              width={Math.min(size + 60, 320)}
              height={36}
              barCount={36}
            />
          </div>
          {liveCommand && (
            <div className="text-[10px] font-mono text-aira-blue/80 animate-pulse mt-1 max-w-xs truncate">
              ▸ "{liveCommand}"
            </div>
          )}
        </div>

        {/* ── RIGHT READOUTS ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 min-w-[140px] items-end text-right">
          <Readout label="FLEET ◣"     value={`${fleetCount} ONLINE`} color="text-emerald-400" />
          <Readout label="MARKS ◣"     value={markCount > 0 ? `${markCount} ACTIVE` : '—'}
                   color={markCount > 0 ? 'text-amber-400' : 'text-aira-text-dim'} />
          <Readout label="INTERVIEW ◣" value={interviewMode ? 'ACTIVE 🔇' : 'INACTIVE'}
                   color={interviewMode ? 'text-red-500' : 'text-aira-text-dim'} />
          <Readout label="MEMORY ◣"    value={memFacts !== null ? `${memFacts} FACTS` : 'LOADING'} />
        </div>
      </div>

      {/* Bottom thin status bar */}
      <div className="relative px-6 pb-2 flex items-center justify-between text-[9px] font-mono text-aira-text-dim/40 tracking-widest">
        <span>NOVA · v3.0 · LOCAL VOICE · GROQ LLM · ZERO CLOUD</span>
        <div className="flex items-center gap-4">
          {proactiveEnabled && (
            <span className={`${recentTriggerType ? 'text-aira-blue/80 animate-pulse' : 'text-aira-text-dim/40'}`}>
              ◈ PROACTIVE {recentTriggerType ? 'TRIGGERED' : 'ARMED'}
            </span>
          )}
          <span className={voiceEnabled ? 'text-blue-400/80' : 'text-aira-text-dim/40'}>
            ◉ MIC {voiceEnabled ? 'LIVE' : 'OFF'}
          </span>
        </div>
      </div>
    </div>
  )
}
