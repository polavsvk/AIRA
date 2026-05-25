import React, { useEffect, useRef, useState } from 'react'

/**
 * NOVA Voice Waveform
 * ───────────────────
 * Animated horizontal bar visualization that responds to voice state.
 * - listening: rapid amplitude (responsive)
 * - speaking:  smoother rolling wave
 * - idle:      flat low-amplitude breath line
 */

export default function VoiceWaveform({ state = 'idle', color = '#3b82f6', barCount = 32, height = 40, width = 280 }) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const stateRef = useRef(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    let t = 0
    const bars = new Array(barCount).fill(0)

    const tick = () => {
      t += 0.08
      const s = stateRef.current

      // Target amplitude per bar based on state
      for (let i = 0; i < barCount; i++) {
        let target
        if (s === 'listening_command' || s === 'wake_flash') {
          // High, jittery
          target = 0.3 + Math.random() * 0.7 * Math.abs(Math.sin(t + i * 0.4))
        } else if (s === 'speaking') {
          // Smoother rolling wave
          target = 0.4 + 0.55 * Math.abs(Math.sin(t * 1.5 + i * 0.3))
        } else if (s === 'processing') {
          // Pulsing
          target = 0.2 + 0.5 * Math.abs(Math.sin(t * 2 + i * 0.2))
        } else if (s === 'paused' || s === 'interview_mode') {
          target = 0
        } else {
          // Idle breath line
          target = 0.08 + 0.1 * Math.abs(Math.sin(t * 0.4 + i * 0.05))
        }
        // Smooth interpolation toward target
        bars[i] += (target - bars[i]) * 0.25
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      const barWidth = (width - (barCount - 1) * 2) / barCount
      const centerY = height / 2

      for (let i = 0; i < barCount; i++) {
        const amp = bars[i] * height * 0.85
        const x = i * (barWidth + 2)
        const y = centerY - amp / 2

        ctx.fillStyle = color
        ctx.globalAlpha = 0.3 + bars[i] * 0.7
        ctx.fillRect(x, y, barWidth, amp)
      }

      animationRef.current = requestAnimationFrame(tick)
    }

    tick()
    return () => cancelAnimationFrame(animationRef.current)
  }, [width, height, barCount, color])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
}
