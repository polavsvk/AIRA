import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Zap, Copy, RotateCcw, Mic, MicOff, Volume2, VolumeX, Radio } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: `AIRA online. Good day, Mr. V.

Say **"Hey AIRA"** anytime to activate me, or just type below. What do you need?`,
  timestamp: new Date(),
}

const QUICK_PROMPTS = [
  'Give me my briefing',
  'What\'s in the news?',
  'Help me write an email',
  'What should I focus on today?',
  'Debug my code',
  'Give me your opinion on something',
]

// Wake word variants — catches common mishearings
const WAKE_WORDS = ['hey aira', 'hey era', 'hey ira', 'hey ara', 'hey aria', 'a aira', 'hey error']

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '').replace(/^\d+\.\s+/gm, '').replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim()
}

function getBestFemaleVoice() {
  const voices = window.speechSynthesis?.getVoices() || []

  // 1. Enhanced / Neural voices first (macOS — sound human)
  const enhanced = voices.find(v =>
    v.lang.startsWith('en') &&
    (v.name.includes('Enhanced') || v.name.includes('Neural') || v.name.includes('Premium')) &&
    !v.name.toLowerCase().includes('albert') &&
    !v.name.toLowerCase().includes('fred') &&
    !v.name.toLowerCase().includes('ralph')
  )
  if (enhanced) return enhanced

  // 2. Known good female voices by name
  const names = [
    'Samantha', 'Ava', 'Allison', 'Victoria', 'Karen', 'Moira',
    'Tessa', 'Fiona', 'Google UK English Female',
    'Microsoft Zira', 'Microsoft Hazel',
  ]
  for (const n of names) {
    const v = voices.find(v => v.name.includes(n))
    if (v) return v
  }

  // 3. Any English voice
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 message-enter">
      <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
        <Zap className="w-3.5 h-3.5 text-aira-blue" />
      </div>
      <div className="aira-panel px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-aira-blue typing-dot" />)}
        </div>
      </div>
    </div>
  )
}

function Message({ message, onCopy, onSpeak }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex items-start gap-3 message-enter ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-aira-gold/10 border border-aira-gold/30' : 'bg-aira-blue/10 border border-aira-blue/30'
      }`}>
        {isUser ? <span className="text-xs font-bold text-aira-gold">V</span> : <Zap className="w-3.5 h-3.5 text-aira-blue" />}
      </div>
      <div className={`group relative max-w-[80%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? 'bg-aira-blue/10 border border-aira-blue/20 text-aira-text' : 'bg-aira-panel border border-aira-border text-aira-text'
        }`}>
          {isUser
            ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-aira-blue prose-headings:font-semibold prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded prose-pre:bg-aira-darker prose-pre:border prose-pre:border-aira-border prose-li:my-0.5 prose-strong:text-aira-text prose-a:text-aira-blue">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
          }
        </div>
        <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-aira-text-dim">{message.timestamp?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
          <button onClick={() => onCopy(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors"><Copy className="w-3 h-3" /></button>
          {!isUser && <button onClick={() => onSpeak(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors"><Volume2 className="w-3 h-3" /></button>}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ChatWindow({ pendingMessage, onPendingMessageSent }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [copied, setCopied] = useState(false)

  // Voice
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [wakeReady, setWakeReady] = useState(false)
  const [wakeFlash, setWakeFlash] = useState(false)
  const [transcript, setTranscript] = useState('')
  const voiceSupported = 'speechSynthesis' in window
  const sttSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  // Refs — avoid stale closures in callbacks
  const loadingRef = useRef(false)
  const listeningRef = useRef(false)
  const voiceRef = useRef(true)
  const wakeRecRef = useRef(null)
  const cmdRecRef = useRef(null)
  const wakeTimerRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const messagesRef = useRef([WELCOME_MESSAGE])

  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { listeningRef.current = listening }, [listening])
  useEffect(() => { voiceRef.current = voiceEnabled }, [voiceEnabled])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // ── TTS ────────────────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!voiceSupported) { onDone?.(); return }
    window.speechSynthesis.cancel()

    const clean = stripMarkdown(text)
    if (!clean) { onDone?.(); return }

    const fire = () => {
      const u = new SpeechSynthesisUtterance(clean)
      u.voice = getBestFemaleVoice()
      u.rate = 1.45   // Fast-paced like FRIDAY
      u.pitch = 1.1
      u.volume = 1
      u.onstart = () => setSpeaking(true)
      u.onend = () => { setSpeaking(false); onDone?.() }
      u.onerror = () => { setSpeaking(false); onDone?.() }
      window.speechSynthesis.speak(u)
    }

    // Voices may load async
    if (window.speechSynthesis.getVoices().length) fire()
    else { window.speechSynthesis.onvoiceschanged = () => fire() }
  }, [voiceSupported])

  const stopSpeaking = useCallback(() => { window.speechSynthesis.cancel(); setSpeaking(false) }, [])

  // ── Wake Word Engine ───────────────────────────────────────────────────────
  // Uses short-burst mode (continuous:false) + rapid restart — more reliable on Chrome/macOS
  const scheduleWakeRestart = useCallback((delay = 150) => {
    clearTimeout(wakeTimerRef.current)
    wakeTimerRef.current = setTimeout(() => {
      if (!listeningRef.current && !loadingRef.current) startWakeListen()
    }, delay)
  }, [])

  const stopWakeListen = useCallback(() => {
    clearTimeout(wakeTimerRef.current)
    try { wakeRecRef.current?.abort() } catch {}
    wakeRecRef.current = null
    setWakeReady(false)
  }, [])

  const startWakeListen = useCallback(() => {
    if (!sttSupported || listeningRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    wakeRecRef.current = rec

    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 5
    rec.lang = 'en-US'

    rec.onstart = () => setWakeReady(true)

    rec.onresult = (e) => {
      const transcripts = []
      for (let i = 0; i < e.results.length; i++)
        for (let j = 0; j < e.results[i].length; j++)
          transcripts.push(e.results[i][j].transcript.toLowerCase())

      const woken = transcripts.some(t => WAKE_WORDS.some(w => t.includes(w)))
      if (woken && !listeningRef.current && !loadingRef.current) {
        stopWakeListen()
        setWakeFlash(true)
        setTimeout(() => setWakeFlash(false), 800)

        if (voiceRef.current) {
          speak('Yes, Mr. V?', () => setTimeout(() => startCmdListen(), 200))
        } else {
          startCmdListen()
        }
      }
    }

    rec.onend = () => {
      setWakeReady(false)
      scheduleWakeRestart(200)
    }

    rec.onerror = (e) => {
      setWakeReady(false)
      const delay = e.error === 'no-speech' ? 100 : 600
      scheduleWakeRestart(delay)
    }

    try { rec.start() } catch { scheduleWakeRestart(500) }
  }, [sttSupported, speak, stopWakeListen, scheduleWakeRestart])

  // ── Command Listening ──────────────────────────────────────────────────────
  const startCmdListen = useCallback(() => {
    if (!sttSupported) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    cmdRecRef.current = rec

    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onstart = () => setListening(true)

    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(text)
      if (e.results[e.results.length - 1].isFinal) {
        setInput(text)
        setTranscript('')
      }
    }

    rec.onend = () => {
      setListening(false)
      setTranscript('')
      scheduleWakeRestart(300)
    }

    rec.onerror = () => {
      setListening(false)
      setTranscript('')
      scheduleWakeRestart(300)
    }

    try { rec.start() } catch {}
  }, [sttSupported, scheduleWakeRestart])

  const stopCmdListen = useCallback(() => {
    try { cmdRecRef.current?.stop() } catch {}
    setListening(false)
    setTranscript('')
  }, [])

  // Init wake word on mount
  useEffect(() => {
    if (!sttSupported) return
    const t = setTimeout(() => startWakeListen(), 1200)
    return () => {
      clearTimeout(t)
      clearTimeout(wakeTimerRef.current)
      stopWakeListen()
      stopCmdListen()
      stopSpeaking()
    }
  }, [])

  // Speak welcome
  useEffect(() => {
    if (!voiceSupported) return
    const t = setTimeout(() => {
      if (voiceRef.current) speak('AIRA online. Good day, Mr. V.')
    }, 900)
    return () => clearTimeout(t)
  }, [])

  // Pending message from briefing modal
  useEffect(() => {
    if (pendingMessage && !loadingRef.current) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage])

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent, loading])

  const handleCopy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  // ── Send Message ──────────────────────────────────────────────────────────
  const sendMessage = async (text = input) => {
    const msg = (typeof text === 'string' ? text : input).trim()
    if (!msg || loadingRef.current) return

    stopSpeaking()
    stopCmdListen()
    stopWakeListen()

    setInput('')
    setTranscript('')

    const current = messagesRef.current
    const updated = [...current, { role: 'user', content: msg, timestamp: new Date() }]
    setMessages(updated)
    messagesRef.current = updated
    setLoading(true)
    setStreamingContent('')

    const history = updated.slice(-20).map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history.slice(0, -1) }),
      })

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of dec.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const d = JSON.parse(line.slice(6))
            if (d.token) { full += d.token; setStreamingContent(full) }
            if (d.done) {
              const aiMsg = { role: 'assistant', content: full, timestamp: new Date() }
              setMessages(prev => { messagesRef.current = [...prev, aiMsg]; return [...prev, aiMsg] })
              setStreamingContent('')
              if (voiceRef.current) speak(full, () => scheduleWakeRestart(300))
              else scheduleWakeRestart(300)
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const e = { role: 'assistant', content: '⚠️ Connection lost. Is the backend running?', timestamp: new Date() }
        messagesRef.current = [...prev, e]
        return [...prev, e]
      })
      setStreamingContent('')
      scheduleWakeRestart(300)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const toggleMic = () => {
    if (listening) { stopCmdListen(); scheduleWakeRestart(300) }
    else { stopWakeListen(); startCmdListen() }
  }

  const toggleVoice = () => {
    const next = !voiceEnabled
    setVoiceEnabled(next)
    voiceRef.current = next
    if (!next) stopSpeaking()
  }

  const clearChat = () => {
    stopSpeaking()
    const m = [{ ...WELCOME_MESSAGE, timestamp: new Date() }]
    setMessages(m)
    messagesRef.current = m
    setStreamingContent('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-aira-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Zap className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">AIRA INTERFACE</span>

          {speaking && <span className="flex items-center gap-1 text-xs text-aira-green font-mono animate-pulse"><Volume2 className="w-3 h-3" />SPEAKING</span>}
          {listening && <span className="flex items-center gap-1 text-xs text-red-400 font-mono animate-pulse"><Mic className="w-3 h-3" />LISTENING</span>}
          {!speaking && !listening && sttSupported && (
            <span className={`flex items-center gap-1 text-xs font-mono transition-all ${
              wakeFlash ? 'text-aira-blue scale-105' : wakeReady ? 'text-aira-text-dim/60' : 'text-aira-text-dim/30'
            }`}>
              <Radio className="w-3 h-3" />
              {wakeFlash ? 'WAKE WORD DETECTED' : wakeReady ? 'STANDBY · "HEY AIRA"' : 'INITIALISING…'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {voiceSupported && (
            <button onClick={toggleVoice} className={`flex items-center gap-1.5 text-xs transition-colors ${voiceEnabled ? 'text-aira-blue' : 'text-aira-text-dim'}`}>
              {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="font-mono">{voiceEnabled ? 'VOICE ON' : 'VOICE OFF'}</span>
            </button>
          )}
          <div className="h-4 w-px bg-aira-border" />
          <button onClick={clearChat} className="flex items-center gap-1.5 text-xs text-aira-text-dim hover:text-aira-blue transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /><span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.map((msg, i) => <Message key={i} message={msg} onCopy={handleCopy} onSpeak={speak} />)}

        {streamingContent && (
          <div className="flex items-start gap-3 message-enter">
            <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-aira-blue animate-pulse" />
            </div>
            <div className="aira-panel px-4 py-3 max-w-[80%]">
              <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-aira-blue prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded prose-li:my-0.5 prose-strong:text-aira-text">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
              </div>
              <span className="inline-block w-1.5 h-4 bg-aira-blue ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {loading && !streamingContent && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick Prompts */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
          {QUICK_PROMPTS.map((p, i) => (
            <button key={i} onClick={() => sendMessage(p)}
              className="text-xs px-3 py-1.5 rounded-full border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue transition-colors">
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-aira-border flex-shrink-0">
        {copied && <div className="text-xs text-aira-green font-mono mb-2">✓ Copied</div>}
        {transcript && <div className="text-xs text-aira-blue font-mono mb-2 animate-pulse">🎤 "{transcript}"</div>}

        <div className="flex items-end gap-2">
          {sttSupported && (
            <button onClick={toggleMic} disabled={loading} title={listening ? 'Stop' : 'Speak'}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                listening ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30' : 'bg-aira-darker border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue'
              }`}>
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}

          <div className="flex-1 bg-aira-darker border border-aira-border rounded-xl px-4 py-2.5 focus-within:border-aira-blue transition-colors">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={listening ? 'Listening… speak now' : 'Message AIRA or say "Hey AIRA"…'}
              className="w-full bg-transparent text-sm text-aira-text placeholder-aira-text-dim outline-none resize-none max-h-32 min-h-[24px]"
              rows={1} style={{ height: 'auto' }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px' }}
              disabled={loading} />
          </div>

          <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-aira-blue flex items-center justify-center hover:bg-aira-blue-dim transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 flex-shrink-0">
            <Send className="w-4 h-4 text-aira-darker" />
          </button>
        </div>

        <p className="text-xs text-aira-text-dim mt-2 text-center font-mono">
          AIRA · Groq LLaMA 3.3 70B · Say "Hey AIRA" to wake · Built for Mr. V
        </p>
      </div>
    </div>
  )
}
