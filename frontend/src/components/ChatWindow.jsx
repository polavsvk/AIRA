import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Zap, Copy, RotateCcw, Mic, MicOff, Volume2, VolumeX, Radio } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: `Good day, Mr. V. AIRA online. All systems operational.

I'm always listening — just say **"Hey AIRA"** and I'll respond instantly. Or type below.

What can I do for you today?`,
  timestamp: new Date(),
}

const QUICK_PROMPTS = [
  "Give me a morning briefing",
  "What's on my schedule?",
  "Help me write an email",
  "What's in the news?",
  "Debug my code",
  "Set a reminder",
]

// Strip markdown for clean TTS
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
}

// Pick best female voice — FRIDAY style
function getBestFemaleVoice() {
  const voices = window.speechSynthesis.getVoices()
  const preferred = [
    'Samantha',                                        // macOS — clear US female
    'Google UK English Female',
    'Microsoft Zira - English (United States)',
    'Microsoft Hazel - English (Great Britain)',
    'Karen',                                           // macOS Australian
    'Moira',                                           // macOS Irish
    'Tessa',                                           // macOS South African
    'Victoria',
    'Fiona',
  ]
  for (const name of preferred) {
    const v = voices.find(v => v.name === name)
    if (v) return v
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

// Wake word variants to catch mishearing
const WAKE_WORDS = ['hey aira', 'hey era', 'hey ira', 'hey ara', 'hey error', 'hey aria']

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 message-enter">
      <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
        <Zap className="w-3.5 h-3.5 text-aira-blue" />
      </div>
      <div className="aira-panel px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-aira-blue typing-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-aira-blue typing-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-aira-blue typing-dot" />
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
      <div className={`group relative max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-aira-blue/10 border border-aira-blue/20 text-aira-text'
            : 'bg-aira-panel border border-aira-border text-aira-text'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none
              prose-p:my-1 prose-headings:text-aira-blue prose-headings:font-semibold
              prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded
              prose-pre:bg-aira-darker prose-pre:border prose-pre:border-aira-border
              prose-li:my-0.5 prose-strong:text-aira-text prose-a:text-aira-blue">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-aira-text-dim">
            {message.timestamp?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </span>
          <button onClick={() => onCopy(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors" title="Copy">
            <Copy className="w-3 h-3" />
          </button>
          {!isUser && (
            <button onClick={() => onSpeak(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors" title="Read aloud">
              <Volume2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatWindow({ pendingMessage, onPendingMessageSent }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [copied, setCopied] = useState(false)

  // Voice state
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [listening, setListening] = useState(false)        // active command listening
  const [wakeActive, setWakeActive] = useState(false)      // background wake word mode
  const [speaking, setSpeaking] = useState(false)
  const [voiceSupported] = useState('speechSynthesis' in window)
  const [sttSupported] = useState('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const [transcript, setTranscript] = useState('')
  const [wakeDetected, setWakeDetected] = useState(false)  // flash when wake word heard

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const commandRecRef = useRef(null)
  const wakeRecRef = useRef(null)
  const loadingRef = useRef(false)
  const listeningRef = useRef(false)
  const voiceEnabledRef = useRef(true)

  // Keep refs in sync
  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { listeningRef.current = listening }, [listening])
  useEffect(() => { voiceEnabledRef.current = voiceEnabled }, [voiceEnabled])

  // ── Text-to-Speech ────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!voiceSupported) return
    window.speechSynthesis.cancel()

    const clean = stripMarkdown(text)
    if (!clean) { onDone?.(); return }

    // Load voices (some browsers are async)
    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.voice = getBestFemaleVoice()
      utterance.rate = 1.05
      utterance.pitch = 1.1
      utterance.volume = 1

      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => { setSpeaking(false); onDone?.() }
      utterance.onerror = () => { setSpeaking(false); onDone?.() }

      window.speechSynthesis.speak(utterance)
    }

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      window.speechSynthesis.onvoiceschanged = () => { doSpeak() }
    }
  }, [voiceSupported])

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setSpeaking(false) }

  // ── Command Listening (active) ────────────────────────────────────────────
  const startCommandListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    stopWakeListening()

    const rec = new SR()
    commandRecRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false

    rec.onstart = () => { setListening(true); setTranscript('') }

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
      // Restart wake word after command listening ends
      setTimeout(() => startWakeListening(), 300)
    }

    rec.onerror = () => { setListening(false); setTranscript(''); setTimeout(() => startWakeListening(), 300) }

    rec.start()
  }, [])

  const stopCommandListening = () => {
    commandRecRef.current?.stop()
    setListening(false)
    setTranscript('')
  }

  // ── Wake Word Listening (background) ─────────────────────────────────────
  const startWakeListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR || listeningRef.current) return

    const rec = new SR()
    wakeRecRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = true

    rec.onstart = () => setWakeActive(true)

    rec.onresult = (e) => {
      if (listeningRef.current || loadingRef.current) return

      const text = Array.from(e.results)
        .slice(-3) // only check last 3 results
        .map(r => r[0].transcript)
        .join(' ')
        .toLowerCase()

      const woken = WAKE_WORDS.some(w => text.includes(w))
      if (woken) {
        rec.stop()
        setWakeDetected(true)
        setTimeout(() => setWakeDetected(false), 1000)

        if (voiceEnabledRef.current) {
          speak("Yes, Mr. V?", () => {
            setTimeout(() => startCommandListening(), 300)
          })
        } else {
          startCommandListening()
        }
      }
    }

    rec.onend = () => {
      setWakeActive(false)
      // Auto-restart unless we're in command mode
      if (!listeningRef.current) {
        setTimeout(() => startWakeListening(), 500)
      }
    }

    rec.onerror = (e) => {
      setWakeActive(false)
      if (e.error !== 'aborted') {
        setTimeout(() => startWakeListening(), 1000)
      }
    }

    try { rec.start() } catch {}
  }, [speak, startCommandListening])

  const stopWakeListening = () => {
    try { wakeRecRef.current?.stop() } catch {}
    setWakeActive(false)
  }

  // Start wake word on mount
  useEffect(() => {
    if (sttSupported) {
      const timer = setTimeout(() => startWakeListening(), 1500)
      return () => {
        clearTimeout(timer)
        stopWakeListening()
        stopCommandListening()
      }
    }
  }, [sttSupported])

  // Speak welcome message
  useEffect(() => {
    if (voiceEnabled && voiceSupported) {
      const timer = setTimeout(() => speak("AIRA online. Good day, Mr. V. How can I assist?"), 1000)
      return () => clearTimeout(timer)
    }
  }, [voiceSupported])

  // Handle pending message from briefing modal
  useEffect(() => {
    if (pendingMessage && !loadingRef.current) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, loading])

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Send Message ──────────────────────────────────────────────────────────
  const sendMessage = async (text = input) => {
    const userMessage = text.trim()
    if (!userMessage || loadingRef.current) return

    stopSpeaking()
    stopCommandListening()
    stopWakeListening()

    setInput('')
    setTranscript('')
    const newMessages = [...messages, { role: 'user', content: userMessage, timestamp: new Date() }]
    setMessages(newMessages)
    setLoading(true)
    setStreamingContent('')

    const history = newMessages
      .filter(m => m.role !== 'system')
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history: history.slice(0, -1) }),
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) { fullContent += data.token; setStreamingContent(fullContent) }
              if (data.done) {
                setMessages(prev => [...prev, { role: 'assistant', content: fullContent, timestamp: new Date() }])
                setStreamingContent('')
                if (voiceEnabledRef.current) {
                  speak(fullContent, () => setTimeout(() => startWakeListening(), 300))
                } else {
                  setTimeout(() => startWakeListening(), 300)
                }
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Connection error. Please check the backend is running.',
        timestamp: new Date(),
      }])
      setStreamingContent('')
      setTimeout(() => startWakeListening(), 300)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const clearChat = () => {
    stopSpeaking()
    setMessages([WELCOME_MESSAGE])
    setStreamingContent('')
  }

  const toggleVoice = () => {
    const next = !voiceEnabled
    setVoiceEnabled(next)
    voiceEnabledRef.current = next
    if (!next) stopSpeaking()
  }

  const toggleMic = () => {
    if (listening) { stopCommandListening(); setTimeout(() => startWakeListening(), 300) }
    else { startCommandListening() }
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-aira-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Zap className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">AIRA INTERFACE</span>

          {/* Status badges */}
          {speaking && (
            <span className="flex items-center gap-1 text-xs text-aira-green font-mono animate-pulse">
              <Volume2 className="w-3 h-3" /> SPEAKING
            </span>
          )}
          {listening && (
            <span className="flex items-center gap-1 text-xs text-red-400 font-mono animate-pulse">
              <Mic className="w-3 h-3" /> LISTENING
            </span>
          )}
          {wakeActive && !listening && !speaking && (
            <span className={`flex items-center gap-1 text-xs font-mono transition-colors ${wakeDetected ? 'text-aira-blue animate-pulse' : 'text-aira-text-dim/50'}`}>
              <Radio className="w-3 h-3" />
              {wakeDetected ? 'WAKE WORD DETECTED' : 'STANDBY — SAY "HEY AIRA"'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {voiceSupported && (
            <button
              onClick={toggleVoice}
              className={`flex items-center gap-1.5 text-xs transition-colors ${voiceEnabled ? 'text-aira-blue' : 'text-aira-text-dim'}`}
              title={voiceEnabled ? 'Mute AIRA' : 'Unmute AIRA'}
            >
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
        {messages.map((msg, i) => (
          <Message key={i} message={msg} onCopy={handleCopy} onSpeak={speak} />
        ))}
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
          {QUICK_PROMPTS.map((prompt, i) => (
            <button key={i} onClick={() => sendMessage(prompt)}
              className="text-xs px-3 py-1.5 rounded-full border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue transition-colors">
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-aira-border flex-shrink-0">
        {copied && <div className="text-xs text-aira-green font-mono mb-2 animate-fadeIn">✓ Copied</div>}
        {transcript && (
          <div className="text-xs text-aira-blue font-mono mb-2 animate-pulse">🎤 "{transcript}"</div>
        )}
        <div className="flex items-end gap-2">
          {sttSupported && (
            <button onClick={toggleMic} disabled={loading} title={listening ? 'Stop' : 'Speak to AIRA'}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                listening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30'
                  : 'bg-aira-darker border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue'
              }`}>
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <div className="flex-1 bg-aira-darker border border-aira-border rounded-xl px-4 py-2.5 focus-within:border-aira-blue transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening… speak now' : 'Message AIRA or say "Hey AIRA"…'}
              className="w-full bg-transparent text-sm text-aira-text placeholder-aira-text-dim outline-none resize-none max-h-32 min-h-[24px]"
              rows={1}
              style={{ height: 'auto' }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px' }}
              disabled={loading}
            />
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
