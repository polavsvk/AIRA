import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Zap, Copy, RotateCcw, Mic, MicOff,
  Volume2, VolumeX, Radio, Globe, FileText,
  CheckCircle, XCircle, Loader, AlertTriangle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import axios from 'axios'

// ─── Constants ────────────────────────────────────────────────────────────────

const WAKE_WORDS = ['hey nova', 'hey nora', 'nova', 'okay nova', 'ok nova']

const QUICK_PROMPTS = [
  'Give me my briefing',
  'Open my Gmail',
  'What\'s in the news today?',
  'Play something on YouTube',
  'What should I focus on today?',
  'Search Wikipedia for something',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '').replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1').replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '').replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim()
}

function getBestFemaleVoice() {
  const voices = window.speechSynthesis?.getVoices() || []
  const enhanced = voices.find(v =>
    v.lang.startsWith('en') &&
    (v.name.includes('Enhanced') || v.name.includes('Neural') || v.name.includes('Premium')) &&
    !['albert', 'fred', 'ralph', 'bruce', 'kathy'].some(n => v.name.toLowerCase().includes(n))
  )
  if (enhanced) return enhanced
  for (const n of ['Samantha', 'Ava', 'Allison', 'Victoria', 'Karen', 'Moira', 'Tessa', 'Fiona',
    'Google UK English Female', 'Microsoft Zira', 'Microsoft Hazel']) {
    const v = voices.find(v => v.name.includes(n))
    if (v) return v
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolCallBadge({ tool, args, result, success, pending }) {
  const icons = {
    file_read: <FileText className="w-3 h-3" />,
    file_write: <FileText className="w-3 h-3" />,
    file_list: <FileText className="w-3 h-3" />,
    browser_open: <Globe className="w-3 h-3" />,
    browser_read: <Globe className="w-3 h-3" />,
    youtube_search: <Globe className="w-3 h-3" />,
    gmail_open: <Globe className="w-3 h-3" />,
    web_search: <Globe className="w-3 h-3" />,
    mac_open: <Zap className="w-3 h-3" />,
  }
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border my-1 ${
      pending ? 'border-aira-blue/30 bg-aira-blue/5 text-aira-blue' :
      success ? 'border-green-500/30 bg-green-500/5 text-green-400' :
      'border-red-500/30 bg-red-500/5 text-red-400'
    }`}>
      {pending ? <Loader className="w-3 h-3 animate-spin" /> :
       success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {icons[tool] || <Zap className="w-3 h-3" />}
      <span>{tool.replace(/_/g, ' ')}</span>
      {result && !pending && <span className="text-aira-text-dim truncate max-w-48">{result.slice(0, 60)}{result.length > 60 ? '…' : ''}</span>}
    </div>
  )
}

function ConfirmationCard({ confirmationId, tool, data, onConfirm, onDeny }) {
  return (
    <div className="my-2 border border-yellow-500/30 bg-yellow-500/5 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-yellow-400" />
        <span className="text-xs font-mono text-yellow-400 tracking-widest">CONFIRMATION REQUIRED</span>
      </div>
      {tool === 'file_write' && data && (
        <div className="mb-3">
          <p className="text-xs text-aira-text-dim mb-1">
            {data.is_new_file ? 'Create new file:' : 'Update file:'} <span className="text-aira-text font-mono">{data.path}</span>
          </p>
          <div className="bg-aira-darker rounded p-2 max-h-32 overflow-y-auto">
            <pre className="text-xs text-aira-text whitespace-pre-wrap">{(data.content || '').slice(0, 400)}{(data.content || '').length > 400 ? '\n…' : ''}</pre>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => onConfirm(confirmationId)}
          className="flex-1 text-xs py-1.5 bg-aira-green/10 border border-aira-green/30 text-aira-green rounded-lg hover:bg-aira-green/20 transition-colors">
          ✓ Confirm
        </button>
        <button onClick={() => onDeny(confirmationId)}
          className="flex-1 text-xs py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors">
          ✗ Cancel
        </button>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 message-enter">
      <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
        <Zap className="w-3.5 h-3.5 text-aira-blue" />
      </div>
      <div className="aira-panel px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-aira-blue typing-dot" />)}
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
      <div className={`group relative max-w-[82%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-aira-blue/10 border border-aira-blue/20 text-aira-text'
            : 'bg-aira-panel border border-aira-border text-aira-text'
        }`}>
          {isUser
            ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-aira-blue prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded prose-pre:bg-aira-darker prose-pre:border prose-pre:border-aira-border prose-li:my-0.5 prose-strong:text-aira-text prose-a:text-aira-blue">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
          }
        </div>

        {/* Tool events attached to this message */}
        {message.toolEvents?.map((ev, i) => (
          ev.type === 'confirmation_needed'
            ? <ConfirmationCard key={i} confirmationId={ev.confirmation_id} tool={ev.tool} data={ev.data}
                onConfirm={message.onConfirm} onDeny={message.onDeny} />
            : <ToolCallBadge key={i} tool={ev.tool} args={ev.args} result={ev.result}
                success={ev.success !== false} pending={ev.pending} />
        ))}

        <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-aira-text-dim">
            {message.timestamp?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </span>
          <button onClick={() => onCopy(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors">
            <Copy className="w-3 h-3" />
          </button>
          {!isUser && (
            <button onClick={() => onSpeak(message.content)} className="text-aira-text-dim hover:text-aira-blue transition-colors">
              <Volume2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ChatWindow({ pendingMessage, onPendingMessageSent }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingTools, setStreamingTools] = useState([])
  const [copied, setCopied] = useState(false)
  const [greetingLoaded, setGreetingLoaded] = useState(false)

  // Voice
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [wakeReady, setWakeReady] = useState(false)
  const [wakeFlash, setWakeFlash] = useState(false)
  const [transcript, setTranscript] = useState('')

  const voiceSupported = 'speechSynthesis' in window
  const sttSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  // Refs for stable closures
  const loadingRef = useRef(false)
  const listeningRef = useRef(false)
  const voiceRef = useRef(true)
  const wakeRecRef = useRef(null)
  const cmdRecRef = useRef(null)
  const wakeTimerRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const messagesRef = useRef([])

  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { listeningRef.current = listening }, [listening])
  useEffect(() => { voiceRef.current = voiceEnabled }, [voiceEnabled])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // ── TTS ──────────────────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!voiceSupported) { onDone?.(); return }
    window.speechSynthesis.cancel()
    const clean = stripMarkdown(text)
    if (!clean) { onDone?.(); return }

    const fire = () => {
      const u = new SpeechSynthesisUtterance(clean)
      u.voice = getBestFemaleVoice()
      u.rate = 1.15
      u.pitch = 1.1
      u.volume = 1
      u.onstart = () => setSpeaking(true)
      u.onend = () => { setSpeaking(false); onDone?.() }
      u.onerror = () => { setSpeaking(false); onDone?.() }
      window.speechSynthesis.speak(u)
    }
    if (window.speechSynthesis.getVoices().length) fire()
    else { window.speechSynthesis.onvoiceschanged = () => fire() }
  }, [voiceSupported])

  const stopSpeaking = useCallback(() => { window.speechSynthesis.cancel(); setSpeaking(false) }, [])

  // ── Wake Word ─────────────────────────────────────────────────────────────────
  const scheduleWakeRestart = useCallback((delay = 200) => {
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
    rec.maxAlternatives = 6
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
        setTimeout(() => setWakeFlash(false), 1000)
        if (voiceRef.current) speak('Yes, Mr. V?', () => setTimeout(startCmdListen, 200))
        else startCmdListen()
      }
    }
    rec.onend = () => { setWakeReady(false); scheduleWakeRestart(200) }
    rec.onerror = (e) => {
      setWakeReady(false)
      scheduleWakeRestart(e.error === 'no-speech' ? 100 : 600)
    }
    try { rec.start() } catch { scheduleWakeRestart(500) }
  }, [sttSupported, speak, stopWakeListen, scheduleWakeRestart])

  // ── Command Listen ────────────────────────────────────────────────────────────
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
    rec.onend = () => { setListening(false); setTranscript(''); scheduleWakeRestart(300) }
    rec.onerror = () => { setListening(false); setTranscript(''); scheduleWakeRestart(300) }
    try { rec.start() } catch {}
  }, [sttSupported, scheduleWakeRestart])

  const stopCmdListen = useCallback(() => {
    try { cmdRecRef.current?.stop() } catch {}
    setListening(false); setTranscript('')
  }, [])

  // ── Init ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Load AI-generated greeting
    const loadGreeting = async () => {
      try {
        const res = await axios.get('/api/chat/greeting', { timeout: 8000 })
        const greet = res.data?.greeting || 'NOVA online. Good day, Mr. V.'
        const msg = { role: 'assistant', content: greet, timestamp: new Date(), toolEvents: [] }
        setMessages([msg])
        messagesRef.current = [msg]
        setGreetingLoaded(true)
        if (voiceRef.current) setTimeout(() => speak(greet), 500)
      } catch {
        const fallback = { role: 'assistant', content: 'NOVA online. What do you need, Mr. V?', timestamp: new Date(), toolEvents: [] }
        setMessages([fallback])
        messagesRef.current = [fallback]
        setGreetingLoaded(true)
      }
    }
    loadGreeting()

    // Start wake word listener
    if (sttSupported) {
      const t = setTimeout(() => startWakeListen(), 1500)
      return () => {
        clearTimeout(t)
        clearTimeout(wakeTimerRef.current)
        stopWakeListen()
        stopCmdListen()
        stopSpeaking()
      }
    }
  }, [])

  // Pending message from briefing modal
  useEffect(() => {
    if (pendingMessage && greetingLoaded && !loadingRef.current) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage, greetingLoaded])

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent, loading])

  const handleCopy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  // ── Confirmation handlers ─────────────────────────────────────────────────────
  const handleConfirm = async (confirmationId) => {
    try {
      const res = await axios.post('/api/chat/confirm', { confirmation_id: confirmationId })
      const resultText = res.data?.result || 'Done.'
      // Update the message that contains this confirmation
      setMessages(prev => prev.map(m => ({
        ...m,
        toolEvents: (m.toolEvents || []).map(ev =>
          ev.confirmation_id === confirmationId
            ? { ...ev, type: 'tool_result', result: resultText, success: res.data?.success !== false }
            : ev
        )
      })))
    } catch {
      // Update as failed
      setMessages(prev => prev.map(m => ({
        ...m,
        toolEvents: (m.toolEvents || []).map(ev =>
          ev.confirmation_id === confirmationId
            ? { ...ev, type: 'tool_result', result: 'Action failed.', success: false }
            : ev
        )
      })))
    }
  }

  const handleDeny = (confirmationId) => {
    setMessages(prev => prev.map(m => ({
      ...m,
      toolEvents: (m.toolEvents || []).map(ev =>
        ev.confirmation_id === confirmationId
          ? { ...ev, type: 'tool_result', result: 'Cancelled by Mr. V.', success: false }
          : ev
      )
    })))
  }

  // ── Send Message ──────────────────────────────────────────────────────────────
  const sendMessage = async (text = input) => {
    const msg = (typeof text === 'string' ? text : input).trim()
    if (!msg || loadingRef.current) return

    stopSpeaking(); stopCmdListen(); stopWakeListen()
    setInput(''); setTranscript('')

    const userMsg = { role: 'user', content: msg, timestamp: new Date(), toolEvents: [] }
    const updated = [...messagesRef.current, userMsg]
    setMessages(updated); messagesRef.current = updated
    setLoading(true); setStreamingContent(''); setStreamingTools([])

    const history = updated.slice(-20).map(m => ({ role: m.role, content: m.content }))

    let fullContent = ''
    const toolEvents = []
    let currentToolEvents = []

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history.slice(0, -1) }),
      })

      const reader = res.body.getReader()
      const dec = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        for (const line of dec.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))

            if (ev.type === 'token') {
              fullContent += ev.content
              setStreamingContent(fullContent)

            } else if (ev.type === 'tool_call') {
              const toolEv = { type: 'tool_call', tool: ev.tool, args: ev.args, pending: true }
              currentToolEvents.push(toolEv)
              setStreamingTools([...currentToolEvents])

            } else if (ev.type === 'tool_result') {
              // Update the pending tool call to show result
              currentToolEvents = currentToolEvents.map(t =>
                t.tool === ev.tool && t.pending
                  ? { ...t, pending: false, type: 'tool_result', result: ev.result, success: ev.success }
                  : t
              )
              setStreamingTools([...currentToolEvents])

            } else if (ev.type === 'confirmation_needed') {
              const confEv = {
                type: 'confirmation_needed',
                confirmation_id: ev.confirmation_id,
                tool: ev.tool,
                data: ev.data,
              }
              currentToolEvents = currentToolEvents.map(t =>
                t.tool === ev.tool && t.pending ? { ...t, pending: false } : t
              )
              currentToolEvents.push(confEv)
              setStreamingTools([...currentToolEvents])

            } else if (ev.type === 'done') {
              const aiMsg = {
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                toolEvents: [...currentToolEvents],
                onConfirm: handleConfirm,
                onDeny: handleDeny,
              }
              setMessages(prev => { messagesRef.current = [...prev, aiMsg]; return [...prev, aiMsg] })
              setStreamingContent('')
              setStreamingTools([])
              if (voiceRef.current && fullContent) speak(fullContent, () => scheduleWakeRestart(300))
              else scheduleWakeRestart(300)
            }
          } catch {}
        }
      }
    } catch {
      const errMsg = { role: 'assistant', content: '⚠️ Connection lost. Is the backend running?', timestamp: new Date(), toolEvents: [] }
      setMessages(prev => { messagesRef.current = [...prev, errMsg]; return [...prev, errMsg] })
      setStreamingContent(''); setStreamingTools([])
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
    const next = !voiceEnabled; setVoiceEnabled(next); voiceRef.current = next
    if (!next) stopSpeaking()
  }

  const clearChat = () => {
    stopSpeaking()
    const m = [{ role: 'assistant', content: 'Fresh slate. What do you need, Mr. V?', timestamp: new Date(), toolEvents: [] }]
    setMessages(m); messagesRef.current = m; setStreamingContent('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-aira-border flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <Zap className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">NOVA INTERFACE</span>

          {speaking && (
            <span className="flex items-center gap-1 text-xs text-aira-green font-mono animate-pulse">
              <Volume2 className="w-3 h-3" />SPEAKING
            </span>
          )}
          {listening && (
            <span className="flex items-center gap-1 text-xs text-red-400 font-mono animate-pulse">
              <Mic className="w-3 h-3" />LISTENING
            </span>
          )}
          {!speaking && !listening && sttSupported && (
            <span className={`flex items-center gap-1 text-xs font-mono transition-all ${
              wakeFlash ? 'text-aira-blue scale-105' : wakeReady ? 'text-aira-text-dim/50' : 'text-aira-text-dim/20'
            }`}>
              <Radio className="w-3 h-3" />
              {wakeFlash ? 'WAKE DETECTED' : wakeReady ? 'STANDBY · "HEY NOVA"' : '…'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {voiceSupported && (
            <button onClick={toggleVoice} className={`flex items-center gap-1 text-xs transition-colors ${voiceEnabled ? 'text-aira-blue' : 'text-aira-text-dim'}`}>
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

        {/* Streaming tool events */}
        {streamingTools.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-aira-blue animate-pulse" />
            </div>
            <div className="flex flex-col">
              {streamingTools.map((ev, i) => (
                ev.type === 'tool_call' || ev.type === 'tool_result'
                  ? <ToolCallBadge key={i} tool={ev.tool} args={ev.args} result={ev.result} success={ev.success !== false} pending={ev.pending} />
                  : null
              ))}
            </div>
          </div>
        )}

        {/* Streaming text */}
        {streamingContent && (
          <div className="flex items-start gap-3 message-enter">
            <div className="w-7 h-7 rounded-full bg-aira-blue/10 border border-aira-blue/30 flex items-center justify-center flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-aira-blue animate-pulse" />
            </div>
            <div className="aira-panel px-4 py-3 max-w-[82%]">
              <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-aira-blue prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded prose-li:my-0.5 prose-strong:text-aira-text">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
              </div>
              <span className="inline-block w-1.5 h-4 bg-aira-blue ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {loading && !streamingContent && streamingTools.length === 0 && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts — shown only on empty chat */}
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
        {copied && <div className="text-xs text-aira-green font-mono mb-2">✓ Copied to clipboard</div>}
        {transcript && <div className="text-xs text-aira-blue font-mono mb-2 animate-pulse">🎤 "{transcript}"</div>}

        <div className="flex items-end gap-2">
          {sttSupported && (
            <button onClick={toggleMic} disabled={loading} title={listening ? 'Stop' : 'Speak'}
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
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={listening ? 'Listening… speak now' : 'Message NOVA or say "Hey Nova"…'}
              className="w-full bg-transparent text-sm text-aira-text placeholder-aira-text-dim outline-none resize-none max-h-32 min-h-[24px]"
              rows={1}
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
          NOVA · Groq LLaMA 3.3 70B · Say "Hey Nova" to wake · Built for Mr. V
        </p>
      </div>
    </div>
  )
}
