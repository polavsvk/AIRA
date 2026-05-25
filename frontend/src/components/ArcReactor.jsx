import React, { useMemo, useEffect, useState } from 'react'

/**
 * NOVA ArcReactor — central HUD core
 * ─────────────────────────────────────
 * The visual heart of the app. Replaces "chatbot bubble" with a pulsing,
 * rotating, JARVIS-style core that's always alive on screen.
 *
 * States change color + animation:
 *   - idle / listening_wake : faint blue pulse (alive but waiting)
 *   - wake-flash            : bright cyan flare (just heard "Hey Nova")
 *   - listening_command     : red rapid pulse (capturing command)
 *   - speaking              : green steady glow (NOVA responding)
 *   - processing            : amber spin (thinking)
 *   - interview_mode        : dim red, no animation (silenced)
 *   - error                 : dark red, broken pulse
 */

const STATE_COLORS = {
  idle:               { core: '#3b82f6', glow: '#3b82f6', label: 'STANDBY',         intensity: 0.4 },
  listening_wake:     { core: '#3b82f6', glow: '#60a5fa', label: 'STANDBY · "HEY NOVA"', intensity: 0.5 },
  wake_flash:         { core: '#22d3ee', glow: '#67e8f9', label: 'WAKE DETECTED',   intensity: 1.0 },
  listening_command:  { core: '#ef4444', glow: '#f87171', label: 'LISTENING',       intensity: 0.95 },
  speaking:           { core: '#10b981', glow: '#34d399', label: 'SPEAKING',        intensity: 0.85 },
  processing:         { core: '#f59e0b', glow: '#fbbf24', label: 'PROCESSING',      intensity: 0.7 },
  interview_mode:     { core: '#dc2626', glow: '#7f1d1d', label: 'INTERVIEW MODE',  intensity: 0.3 },
  error:              { core: '#991b1b', glow: '#dc2626', label: 'ERROR',           intensity: 0.4 },
  paused:             { core: '#6b7280', glow: '#9ca3af', label: 'PAUSED',          intensity: 0.25 },
}

const AGENT_POSITIONS = [
  { name: 'NOVA',   angle: 270, color: '#3b82f6' },   // top
  { name: 'ATLAS',  angle: 320, color: '#f59e0b' },
  { name: 'HERMES', angle: 10,  color: '#10b981' },
  { name: 'ORACLE', angle: 60,  color: '#8b5cf6' },
  { name: 'TITAN',  angle: 110, color: '#ef4444' },
  { name: 'AEGIS',  angle: 160, color: '#06b6d4' },
  { name: 'HERALD', angle: 210, color: '#f97316' },
]

function polarToXY(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
  }
}

export default function ArcReactor({
  state = 'idle',
  activeAgent = null,
  wakeFlash = false,
  interviewMode = false,
  size = 220,
}) {
  // Pick effective state
  let effectiveState = state
  if (interviewMode) effectiveState = 'interview_mode'
  else if (wakeFlash) effectiveState = 'wake_flash'

  const cfg = STATE_COLORS[effectiveState] || STATE_COLORS.idle

  const center = size / 2
  const coreRadius = size * 0.13
  const ring1Radius = size * 0.22  // status ring
  const ring2Radius = size * 0.33  // agent ring
  const ring3Radius = size * 0.43  // outer rotating

  // Per-state animation speeds
  const corePulseSpeed = effectiveState === 'listening_command' ? '0.6s' :
                         effectiveState === 'wake_flash'        ? '0.3s' :
                         effectiveState === 'speaking'          ? '1.2s' :
                         effectiveState === 'processing'        ? '0.8s' :
                         effectiveState === 'interview_mode'    ? '4s' :
                                                                   '2.5s'

  const ringSpeed1 = effectiveState === 'processing' ? '4s' : '20s'
  const ringSpeed2 = effectiveState === 'processing' ? '6s' : '30s'

  // Agent dot positions
  const agentDots = useMemo(() => AGENT_POSITIONS.map(a => {
    const { x, y } = polarToXY(a.angle, ring2Radius)
    return { ...a, x: center + x, y: center + y }
  }), [center, ring2Radius])

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
           style={{ overflow: 'visible' }}>

        {/* Outer glow halo */}
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={cfg.core} stopOpacity={cfg.intensity} />
            <stop offset="60%" stopColor={cfg.glow} stopOpacity={cfg.intensity * 0.3} />
            <stop offset="100%" stopColor={cfg.glow} stopOpacity="0" />
          </radialGradient>

          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="strong-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background halo glow — pulses with the core */}
        <circle cx={center} cy={center} r={size * 0.48}
                fill="url(#core-glow)"
                className="reactor-halo"
                style={{ animationDuration: corePulseSpeed }} />

        {/* Ring 3 — Outer hex/dash ring, slow rotation */}
        <g className="reactor-rotate" style={{ animationDuration: ringSpeed2 }} transform-origin={`${center} ${center}`}>
          <circle cx={center} cy={center} r={ring3Radius}
                  fill="none" stroke={cfg.glow} strokeWidth="1"
                  strokeDasharray="2 6" strokeOpacity="0.35" />
        </g>

        {/* Ring 2 — Agent ring with 7 agent dots */}
        <circle cx={center} cy={center} r={ring2Radius}
                fill="none" stroke={cfg.glow} strokeWidth="1"
                strokeOpacity="0.2" />
        {agentDots.map(a => {
          const isActive = activeAgent === a.name
          return (
            <g key={a.name}>
              <circle cx={a.x} cy={a.y}
                      r={isActive ? 4 : 2.5}
                      fill={isActive ? a.color : '#1e293b'}
                      stroke={a.color}
                      strokeWidth={isActive ? 0 : 1}
                      strokeOpacity="0.6"
                      filter={isActive ? 'url(#glow)' : undefined}
                      className={isActive ? 'reactor-agent-pulse' : ''} />
            </g>
          )
        })}

        {/* Ring 1 — Inner status ring, dashed, rotating opposite */}
        <g className="reactor-rotate-reverse" style={{ animationDuration: ringSpeed1 }} transform-origin={`${center} ${center}`}>
          <circle cx={center} cy={center} r={ring1Radius}
                  fill="none" stroke={cfg.core} strokeWidth="1.5"
                  strokeDasharray="4 4" strokeOpacity="0.6" />
        </g>

        {/* Inner tick marks — give that JARVIS measurement vibe */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i / 24) * 360
          const { x: x1, y: y1 } = polarToXY(angle, ring1Radius - 6)
          const { x: x2, y: y2 } = polarToXY(angle, ring1Radius - 2)
          return (
            <line key={i}
                  x1={center + x1} y1={center + y1}
                  x2={center + x2} y2={center + y2}
                  stroke={cfg.core} strokeWidth="0.7" strokeOpacity={i % 6 === 0 ? 0.7 : 0.3} />
          )
        })}

        {/* Core — central glowing disc with the lightning bolt */}
        <circle cx={center} cy={center} r={coreRadius * 1.4}
                fill={cfg.core} fillOpacity="0.12"
                filter="url(#strong-glow)"
                className="reactor-core-pulse"
                style={{ animationDuration: corePulseSpeed }} />

        <circle cx={center} cy={center} r={coreRadius}
                fill={cfg.core} fillOpacity="0.85"
                filter="url(#glow)"
                className="reactor-core-pulse"
                style={{ animationDuration: corePulseSpeed }} />

        {/* The lightning bolt — NOVA's icon */}
        <text x={center} y={center + 6}
              textAnchor="middle"
              fontSize={coreRadius * 0.9}
              fontWeight="bold"
              fill="#fff"
              filter="url(#glow)">
          ⚡
        </text>
      </svg>

      {/* State label below core */}
      <div className="absolute left-0 right-0 text-center" style={{ top: size + 4 }}>
        <span className="text-[10px] font-mono tracking-widest"
              style={{ color: cfg.core, opacity: 0.8 }}>
          {cfg.label}
        </span>
      </div>
    </div>
  )
}
