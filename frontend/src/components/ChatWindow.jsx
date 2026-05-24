import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Zap, Copy, RotateCcw, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: `Good day, Mr. V. I am **AIRA** — your Advanced Intelligent Responsive Assistant.

I'm fully operational and at your service. Here's what I can do for you:

- 💬 **Chat & answer questions** on any topic
- ✍️ **Write, edit, and proofread** documents
- 🔍 **Research and analyze** information
- 💻 **Help with code** — debugging, explanations, scripts
- 📋 **Manage your tasks** — just ask me to add one
- 🌤️ **Daily briefings** — weather, news, your schedule

How may I assist you today?`,
  timestamp: new Date(),
}

const QUICK_PROMPTS = [
  "Give me a morning briefing",
  "Help me write an email",
  "Explain a concept to me",
  "Debug my code",
  "Plan my day",
  "Summarize something",
]

// Strip markdown so TTS doesn't read symbols aloud
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')          // bullets
    .replace(/^\d+\.\s+/gm, '')          // numbered lists
    .replace(/^>\s+/gm, '')              // blockquotes
    .replace(/\n{2,}/g, '. ')            // double newlines → pause
    .replace(/\n/g, ' ')                 // single newlines
    .trim()
}

// Pick the best available voice — prefer a deep British/US male
function getBestVoice() {
  const voices = window.speechSynthesis.getVoices()
  const preferred = [
    'Google UK English Male',
    'Microsoft George - English (United Kingdom)',
    'Daniel',
    'Google US English',
    'Microsoft David - English (United States)',
    'Alex',
  ]
  for (const name of preferred) {
    const match = voices.find(v => v.name === name)
    if (match) return match
  }
  // Fallback: any English male-sounding voice
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
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser
          ? 'bg-aira-gold/10 border border-aira-gold/30'
          : 'bg-aira-blue/10 border border-aira-blue/30'
      }`}>
        {isUser
          ? <span className="text-xs font-bold text-aira-gold">V</span>
          : <Zap className="w-3.5 h-3.5 text-aira-blue" />
        }
      </div>

      {/* Bubble */}
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

        {/* Timestamp + Copy + Speak */}
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
  const [voiceEnabled, setVoiceEnabled] = useState(true)   // TTS on/off
  const [listening, setListening] = useState(false)         // STT active
  const [speaking, setSpeaking] = useState(false)           // TTS currently speaking
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [sttSupported, setSttSupported] = useState(false)
  const [transcript, setTranscript] = useState('')          // live STT preview

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)

  // Check browser support & load voices
  useEffect(() => {
    setVoiceSupported('speechSynthesis' in window)
    setSttSupported('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

    // Voices load async in some browsers
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {}
    }
  }, [])

  // Handle pending messages from DailyBriefing
  useEffect(() => {
    if (pendingMessage && !loading) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, loading])

  // ── Text-to-Speech ──────────────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!voiceSupported) return
    window.speechSynthesis.cancel() // stop any current speech

    const clean = stripMarkdown(text)
    if (!clean) return

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.voice = getBestVoice()
    utterance.rate = 0.95
    utterance.pitch = 0.85
    utterance.volume = 1

    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    window.speechSynthesis.speak(utterance)
  }, [voiceSupported])

  const stopSpeaking = () => {
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  // ── Speech-to-Text ──────────────────────────────────────────────────────────
  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onstart = () => {
      setListening(true)
      setTranscript('')
    }

    recognition.onresult = (e) => {
      const current = Array.from(e.results)
        .map(r => r[0].transcript)
        .join('')
      setTranscript(current)

      if (e.results[e.results.length - 1].isFinal) {
        setInput(current)
        setTranscript('')
      }
    }

    recognition.onend = () => {
      setListening(false)
      setTranscript('')
    }

    recognition.onerror = () => {
      setListening(false)
      setTranscript('')
    }

    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setListening(false)
    setTranscript('')
  }

  const toggleListening = () => {
    if (listening) stopListening()
    else startListening()
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Send Message ─────────────────────────────────────────────────────────────
  const sendMessage = async (text = input) => {
    const userMessage = text.trim()
    if (!userMessage || loading) return

    // Stop any ongoing speech/listening
    stopSpeaking()
    if (listening) stopListening()

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
        body: JSON.stringify({
          message: userMessage,
          history: history.slice(0, -1),
        }),
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) {
                fullContent += data.token
                setStreamingContent(fullContent)
              }
              if (data.done) {
                const assistantMsg = {
                  role: 'assistant',
                  content: fullContent,
                  timestamp: new Date(),
                }
                setMessages(prev => [...prev, assistantMsg])
                setStreamingContent('')

                // Speak the response if voice is enabled
                if (voiceEnabled) {
                  speak(fullContent)
                }
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      const errorMsg = {
        role: 'assistant',
        content: '⚠️ Connection error. Please check that the backend is running and try again.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMsg])
      setStreamingContent('')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    stopSpeaking()
    setMessages([WELCOME_MESSAGE])
    setStreamingContent('')
  }

  // Speak welcome message on first load
  useEffect(() => {
    if (voiceEnabled && voiceSupported) {
      const timer = setTimeout(() => speak(WELCOME_MESSAGE.content), 800)
      return () => clearTimeout(timer)
    }
  }, [voiceSupported])

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-aira-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">AIRA INTERFACE</span>
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
        </div>

        <div className="flex items-center gap-3">
          {/* Voice toggle */}
          {voiceSupported && (
            <button
              onClick={() => { setVoiceEnabled(!voiceEnabled); stopSpeaking() }}
              className={`flex items-center gap-1.5 text-xs transition-colors ${voiceEnabled ? 'text-aira-blue' : 'text-aira-text-dim'}`}
              title={voiceEnabled ? 'Mute AIRA' : 'Unmute AIRA'}
            >
              {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="font-mono">{voiceEnabled ? 'VOICE ON' : 'VOICE OFF'}</span>
            </button>
          )}

          <div className="h-4 w-px bg-aira-border" />

          <button
            onClick={clearChat}
            className="flex items-center gap-1.5 text-xs text-aira-text-dim hover:text-aira-blue transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.map((msg, i) => (
          <Message key={i} message={msg} onCopy={handleCopy} onSpeak={speak} />
        ))}

        {/* Streaming message */}
        {streamingContent && (
          <div className="flex items-start gap-3 message-enter">
            <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-aira-blue animate-pulse" />
            </div>
            <div className="aira-panel px-4 py-3 max-w-[80%]">
              <div className="prose prose-invert prose-sm max-w-none
                prose-p:my-1 prose-headings:text-aira-blue
                prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded
                prose-li:my-0.5 prose-strong:text-aira-text">
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
            <button
              key={i}
              onClick={() => sendMessage(prompt)}
              className="text-xs px-3 py-1.5 rounded-full border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="px-4 py-3 border-t border-aira-border flex-shrink-0">
        {copied && (
          <div className="text-xs text-aira-green font-mono mb-2 animate-fadeIn">✓ Copied to clipboard</div>
        )}

        {/* Live transcript preview */}
        {transcript && (
          <div className="text-xs text-aira-blue font-mono mb-2 animate-pulse">
            🎤 "{transcript}"
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Mic button */}
          {sttSupported && (
            <button
              onClick={toggleListening}
              disabled={loading}
              title={listening ? 'Stop listening' : 'Speak to AIRA'}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                listening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30'
                  : 'bg-aira-darker border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}

          <div className="flex-1 bg-aira-darker border border-aira-border rounded-xl px-4 py-2.5 focus-within:border-aira-blue transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening... speak now' : 'Message AIRA or press 🎤 to speak...'}
              className="w-full bg-transparent text-sm text-aira-text placeholder-aira-text-dim outline-none resize-none max-h-32 min-h-[24px]"
              rows={1}
              style={{ height: 'auto' }}
              onInput={e => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
              }}
              disabled={loading}
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-aira-blue flex items-center justify-center hover:bg-aira-blue-dim transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 flex-shrink-0"
          >
            <Send className="w-4 h-4 text-aira-darker" />
          </button>
        </div>

        <p className="text-xs text-aira-text-dim mt-2 text-center font-mono">
          AIRA · Powered by Groq LLaMA 3.3 70B · Built for Mr. V
        </p>
      </div>
    </div>
  )
}
