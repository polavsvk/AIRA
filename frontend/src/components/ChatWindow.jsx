import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Zap, Copy, RotateCcw, Mic, MicOff,
  Volume2, VolumeX, Radio, Globe, FileText,
  CheckCircle, XCircle, Loader, AlertTriangle,
  Brain, Monitor, Users, ChevronDown, ChevronUp,
  Activity,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import axios from 'axios'

// ─── Session ID ───────────────────────────────────────────────────────────────

function getOrCreateSessionId() {
  const stored = localStorage.getItem('nova_session_id')
  if (stored) return stored
  const id = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  localStorage.setItem('nova_session_id', id)
  return id
}

const SESSION_ID = getOrCreateSessionId()

// ─── Greeting Cache ───────────────────────────────────────────────────────────

const GREETING_TTL = 60 * 60 * 1000 // 1 hour

function getCachedGreeting() {
  try {
    const raw = localStorage.getItem('nova_greeting_cache')
    if (!raw) return null
    const { greeting, timestamp } = JSON.parse(raw)
    if (Date.now() - timestamp < GREETING_TTL) return greeting
  } catch {}
  return null
}

function setCachedGreeting(greeting) {
  try {
    localStorage.setItem('nova_greeting_cache', JSON.stringify({ greeting, timestamp: Date.now() }))
  } catch {}
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WAKE_WORDS = ['hey nova', 'hey nora', 'nova', 'okay nova', 'ok nova']

const QUICK_PROMPTS = [
  'How many agents are working for me?',
  'Give me my briefing',
  'Open my Gmail',
  "What's on my screen?",
  'Play something on YouTube',
  'What should I focus on today?',
]

// ─── Agent Config ─────────────────────────────────────────────────────────────

const AGENT_COLORS = {
  NOVA:   { text: 'text-blue-400',   border: 'border-blue-400/40',   bg: 'bg-blue-400/10'   },
  ATLAS:  { text: 'text-amber-400',  border: 'border-amber-400/40',  bg: 'bg-amber-400/10'  },
  HERMES: { text: 'text-emerald-400',border: 'border-emerald-400/40',bg: 'bg-emerald-400/10'},
  ORACLE: { text: 'text-purple-400', border: 'border-purple-400/40', bg: 'bg-purple-400/10' },
  TITAN:  { text: 'text-red-400',    border: 'border-red-400/40',    bg: 'bg-red-400/10'    },
  AEGIS:  { text: 'text-cyan-400',   border: 'border-cyan-400/40',   bg: 'bg-cyan-400/10'   },
  HERALD: { text: 'text-orange-400', border: 'border-orange-400/40', bg: 'bg-orange-400/10' },
}

const AGENT_ICONS = {
  NOVA: '⚡', ATLAS: '📁', HERMES: '🌐',
  ORACLE: '🔍', TITAN: '🖥️', AEGIS: '🌤️', HERALD: '📰',
}

function getAgentStyle(agentName) {
  if (!agentName) return AGENT_COLORS.NOVA
  if (agentName.startsWith('MARK-')) {
    return { text: 'text-gray-400', border: 'border-gray-400/40', bg: 'bg-gray-400/10' }
  }
  return AGENT_COLORS[agentName] || AGENT_COLORS.NOVA
}

// ─── Voice — JARVIS-style female ─────────────────────────────────────────────

function getBestFemaleVoice() {
  const voices = window.speechSynthesis?.getVoices() || []

  // Priority 1: Samantha Enhanced — macOS premium neural, crisp & professional
  const samanthaEnhanced = voices.find(v =>
    v.name.toLowerCase().includes('samantha') &&
    (v.name.includes('Enhanced') || v.name.includes('Premium') || v.name.includes('Neural'))
  )
  if (samanthaEnhanced) return samanthaEnhanced

  // Priority 2: Any Samantha (still excellent on macOS)
  const samantha = voices.find(v => v.name.includes('Samantha') && v.lang.startsWith('en'))
  if (samantha) return samantha

  // Priority 3: Other neural/enhanced English female voices
  const MALE_NAMES = ['albert', 'fred', 'ralph', 'bruce', 'daniel', 'james', 'oliver', 'george', 'tom', 'alex']
  const enhanced = voices.find(v =>
    v.lang.startsWith('en') &&
    (v.name.includes('Enhanced') || v.name.includes('Neural') || v.name.includes('Premium')) &&
    !MALE_NAMES.some(n => v.name.toLowerCase().includes(n))
  )
  if (enhanced) return enhanced

  // Priority 4: Named professional female voices
  for (const n of ['Ava', 'Allison', 'Victoria', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Susan',
    'Google UK English Female', 'Microsoft Zira', 'Microsoft Hazel', 'Microsoft Susan']) {
    const v = voices.find(v => v.name.includes(n) && v.lang.startsWith('en'))
    if (v) return v
  }

  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '').replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1').replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '').replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentBadge({ agentName }) {
  if (!agentName || agentName === 'NOVA') return null
  const style = getAgentStyle(agentName)
  const icon = agentName.startsWith('MARK-') ? '⚙️' : (AGENT_ICONS[agentName] || '⚡')
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${style.text} ${style.border} ${style.bg}`}>
      <span>{icon}</span>
      <span>{agentName}</span>
    </span>
  )
}

function AgentDelegationBadge({ agent }) {
  const style = getAgentStyle(agent)
  const icon = AGENT_ICONS[agent] || '⚙️'
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border my-1 ${style.border} ${style.bg} ${style.text}`}>
      <span>{icon}</span>
      <span>Routing to <strong>{agent}</strong>, Mr. V.</span>
    </div>
  )
}

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
    get_agent_status: <Users className="w-3 h-3" />,
    spawn_mark_agent: <Activity className="w-3 h-3" />,
    kill_mark_agent: <XCircle className="w-3 h-3" />,
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

function TypingIndicator({ agentName }) {
  const style = getAgentStyle(agentName)
  return (
    <div className="flex items-start gap-3 message-enter">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border ${style.bg} ${style.border}`}>
        <span className="text-xs">{AGENT_ICONS[agentName] || '⚡'}</span>
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
  const agentName = message.agent
  const style = getAgentStyle(agentName)

  return (
    <div className={`flex items-start gap-3 message-enter ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser
          ? 'bg-aira-gold/10 border border-aira-gold/30'
          : `${style.bg} border ${style.border}`
      }`}>
        {isUser
          ? <span className="text-xs font-bold text-aira-gold">V</span>
          : <span className="text-xs">{AGENT_ICONS[agentName] || '⚡'}</span>
        }
      </div>

      <div className={`group relative max-w-[82%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Agent badge — show for non-NOVA agents */}
        {!isUser && agentName && agentName !== 'NOVA' && (
          <div className="mb-1">
            <AgentBadge agentName={agentName} />
          </div>
        )}

        {/* Message bubble */}
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

        {/* Tool events */}
        {message.toolEvents?.map((ev, i) => (
          ev.type === 'confirmation_needed'
            ? <ConfirmationCard key={i} confirmationId={ev.confirmation_id} tool={ev.tool} data={ev.data}
                onConfirm={message.onConfirm} onDeny={message.onDeny} />
            : <ToolCallBadge key={i} tool={ev.tool} args={ev.args} result={ev.result}
                success={ev.success !== false} pending={ev.pending} />
        ))}

        {/* Actions */}
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

// ─── Agent Status Panel ───────────────────────────────────────────────────────

function AgentStatusPanel({ onClose }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await axios.get('/api/agents/status')
        setStatus(res.data)
      } catch { /* silently fail */ }
      finally { setLoading(false) }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="absolute top-10 right-0 z-50 w-80 bg-aira-panel border border-aira-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aira-border">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text tracking-wider">AGENT FLEET</span>
        </div>
        <button onClick={onClose} className="text-aira-text-dim hover:text-aira-text text-xs">✕</button>
      </div>

      <div className="p-3 max-h-80 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-aira-text-dim py-2">
            <Loader className="w-3 h-3 animate-spin" /> Loading fleet status…
          </div>
        )}

        {status && !loading && (
          <>
            {/* Permanent agents */}
            <p className="text-[10px] font-mono text-aira-text-dim/60 tracking-widest mb-2">PERMANENT</p>
            <div className="space-y-1 mb-3">
              {Object.entries(status.permanent || {}).map(([name, info]) => {
                const style = getAgentStyle(name)
                const icon = AGENT_ICONS[name] || '⚡'
                return (
                  <div key={name} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${style.border} ${style.bg}`}>
                    <span className="text-sm">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-mono font-semibold ${style.text}`}>{name}</div>
                      <div className="text-[10px] text-aira-text-dim truncate">{info.description}</div>
                    </div>
                    <div className="text-[10px] text-aira-text-dim font-mono flex-shrink-0">
                      {info.tasks > 0 ? `${info.tasks}t` : 'idle'}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* MARK agents */}
            {Object.keys(status.temporary || {}).length > 0 && (
              <>
                <p className="text-[10px] font-mono text-aira-text-dim/60 tracking-widest mb-2">ACTIVE MARKS</p>
                <div className="space-y-1">
                  {Object.entries(status.temporary).map(([name, info]) => (
                    <div key={name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-400/30 bg-gray-400/5">
                      <span className="text-sm">⚙️</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono font-semibold text-gray-300">{name}</div>
                        <div className="text-[10px] text-aira-text-dim truncate">{info.task}</div>
                      </div>
                      <div className="text-[10px] text-green-400 font-mono">active</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {Object.keys(status.temporary || {}).length === 0 && (
              <p className="text-[10px] text-aira-text-dim/50 font-mono">No MARK agents active</p>
            )}

            <div className="mt-3 pt-2 border-t border-aira-border">
              <p className="text-[10px] text-aira-text-dim font-mono">
                {status.total_agents} agents · {status.active_marks} MARK{status.active_marks !== 1 ? 's' : ''} active
              </p>
            </div>
          </>
        )}
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
  const [streamingAgent, setStreamingAgent] = useState('NOVA')
  const [copied, setCopied] = useState(false)
  const [greetingLoaded, setGreetingLoaded] = useState(false)
  const [showAgentPanel, setShowAgentPanel] = useState(false)

  // Voice
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [wakeReady, setWakeReady] = useState(false)
  const [wakeFlash, setWakeFlash] = useState(false)
  const [transcript, setTranscript] = useState('')

  const voiceSupported = 'speechSynthesis' in window
  const sttSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  const loadingRef = useRef(false)
  const listeningRef = useRef(false)
  const voiceRef = useRef(true)
  const wakeRecRef = useRef(null)
  const cmdRecRef = useRef(null)
  const wakeTimerRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const messagesRef = useRef([])
  const scrollContainerRef = useRef(null)
  const userAtBottomRef = useRef(true)

  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { listeningRef.current = listening }, [listening])
  useEffect(() => { voiceRef.current = voiceEnabled }, [voiceEnabled])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // ── TTS — JARVIS-style female voice ──────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!voiceSupported) { onDone?.(); return }
    window.speechSynthesis.cancel()
    const clean = stripMarkdown(text)
    if (!clean) { onDone?.(); return }

    const fire = () => {
      const u = new SpeechSynthesisUtterance(clean)
      u.voice = getBestFemaleVoice()
      u.rate = 1.05    // Measured, confident — JARVIS pace (not rushed)
      u.pitch = 0.95   // Slightly lower = more authoritative, less assistant-like
      u.volume = 1.0
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
    const init = async () => {
      try {
        const histRes = await axios.get('/api/memory/history?limit=40', { timeout: 6000 })
        const pastMessages = (histRes.data?.messages || []).map(m => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(),
          toolEvents: [],
          fromHistory: true,
          agent: null,
        }))

        let greet = getCachedGreeting()
        if (!greet) {
          const greetRes = await axios.get('/api/chat/greeting', { timeout: 10000 })
          greet = greetRes.data?.greeting || 'NOVA online. Good day, Mr. V.'
          setCachedGreeting(greet)
        }
        const greetMsg = {
          role: 'assistant', content: greet,
          timestamp: new Date(), toolEvents: [], agent: 'NOVA'
        }

        const allMsgs = [...pastMessages, greetMsg]
        setMessages(allMsgs)
        messagesRef.current = allMsgs
        setGreetingLoaded(true)
        if (voiceRef.current) setTimeout(() => speak(greet), 600)
      } catch {
        const fallback = {
          role: 'assistant', content: 'NOVA online. What do you need, Mr. V?',
          timestamp: new Date(), toolEvents: [], agent: 'NOVA'
        }
        setMessages([fallback])
        messagesRef.current = [fallback]
        setGreetingLoaded(true)
      }
    }
    init()

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

  useEffect(() => {
    if (pendingMessage && greetingLoaded && !loadingRef.current) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage, greetingLoaded])

  // ── Smart scroll — only auto-scroll if user is already near the bottom ─────
  const handleScroll = useCallback(() => {
    const c = scrollContainerRef.current
    if (!c) return
    userAtBottomRef.current = (c.scrollHeight - c.scrollTop - c.clientHeight) < 80
  }, [])

  // Scroll on new message (smooth, only if at bottom)
  useEffect(() => {
    if (userAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages.length])

  // Scroll during streaming (instant, only if at bottom — avoids animation thrash)
  useEffect(() => {
    if (userAtBottomRef.current && (streamingContent || streamingTools.length > 0)) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [streamingContent, streamingTools.length])

  const handleCopy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  // ── Confirmation handlers ─────────────────────────────────────────────────────
  const handleConfirm = async (confirmationId) => {
    try {
      const res = await axios.post('/api/chat/confirm', { confirmation_id: confirmationId })
      const resultText = res.data?.result || 'Done.'
      setMessages(prev => prev.map(m => ({
        ...m,
        toolEvents: (m.toolEvents || []).map(ev =>
          ev.confirmation_id === confirmationId
            ? { ...ev, type: 'tool_result', result: resultText, success: res.data?.success !== false }
            : ev
        )
      })))
    } catch {
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

    const userMsg = { role: 'user', content: msg, timestamp: new Date(), toolEvents: [], agent: null }
    const updated = [...messagesRef.current, userMsg]
    setMessages(updated); messagesRef.current = updated
    setLoading(true); setStreamingContent(''); setStreamingTools([]); setStreamingAgent('NOVA')

    const history = updated.slice(-20).map(m => ({ role: m.role, content: m.content }))

    let fullContent = ''
    let currentAgent = 'NOVA'
    let currentToolEvents = []

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history.slice(0, -1), session_id: SESSION_ID }),
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

            if (ev.type === 'agent_started') {
              currentAgent = ev.agent
              setStreamingAgent(ev.agent)

            } else if (ev.type === 'agent_delegation') {
              // Show a delegation badge in the stream area
              const delEv = { type: 'delegation', agent: ev.agent, message: ev.message }
              currentToolEvents.push(delEv)
              setStreamingTools([...currentToolEvents])

            } else if (ev.type === 'rate_limit') {
              const secs = ev.retry_after || 60
              setTranscript(`⏳ Rate limited — resets in ~${secs}s`)
              setTimeout(() => setTranscript(''), secs * 1000)

            } else if (ev.type === 'token') {
              fullContent += ev.content
              setStreamingContent(fullContent)

            } else if (ev.type === 'tool_call') {
              const toolEv = { type: 'tool_call', tool: ev.tool, args: ev.args, pending: true }
              currentToolEvents.push(toolEv)
              setStreamingTools([...currentToolEvents])

            } else if (ev.type === 'tool_result') {
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
              // Strip delegation events — they're streaming-only, not message metadata
              const persistedEvents = currentToolEvents.filter(e => e.type !== 'delegation')
              const aiMsg = {
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
                toolEvents: persistedEvents,
                agent: ev.agent || currentAgent,
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
      const errMsg = {
        role: 'assistant', content: '⚠️ Connection lost. Is the backend running?',
        timestamp: new Date(), toolEvents: [], agent: 'NOVA'
      }
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
    const m = [{
      role: 'assistant', content: "Fresh window, Mr. V. Memory's intact — I still know everything.",
      timestamp: new Date(), toolEvents: [], agent: 'NOVA'
    }]
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

          {/* Agent Fleet button */}
          <div className="relative">
            <button
              onClick={() => setShowAgentPanel(!showAgentPanel)}
              className={`flex items-center gap-1 text-xs transition-colors ${showAgentPanel ? 'text-aira-blue' : 'text-aira-text-dim/70 hover:text-aira-blue'}`}
              title="Agent fleet status"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="font-mono">FLEET</span>
              {showAgentPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showAgentPanel && (
              <AgentStatusPanel onClose={() => setShowAgentPanel(false)} />
            )}
          </div>

          <div className="h-4 w-px bg-aira-border" />
          <div className="flex items-center gap-1 text-xs text-aira-text-dim/50 font-mono" title="Memory active">
            <Brain className="w-3 h-3 text-aira-blue/50" />
            <span>MEM</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-aira-text-dim/50 font-mono" title="Screen awareness active">
            <Monitor className="w-3 h-3 text-aira-blue/50" />
            <span>SCREEN</span>
          </div>
          <div className="h-4 w-px bg-aira-border" />
          <button onClick={clearChat} className="flex items-center gap-1.5 text-xs text-aira-text-dim hover:text-aira-blue transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /><span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
      >
        {messages.map((msg, i) => {
          const prevWasHistory = i > 0 && messages[i - 1]?.fromHistory
          const thisIsNew = !msg.fromHistory
          const showDivider = prevWasHistory && thisIsNew
          return (
            <React.Fragment key={i}>
              {showDivider && (
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-aira-border" />
                  <span className="text-xs font-mono text-aira-text-dim/40 flex items-center gap-1">
                    <Brain className="w-3 h-3" /> previous session
                  </span>
                  <div className="flex-1 h-px bg-aira-border" />
                </div>
              )}
              <Message message={msg} onCopy={handleCopy} onSpeak={speak} />
            </React.Fragment>
          )
        })}

        {/* Streaming tool events */}
        {streamingTools.length > 0 && (
          <div className="flex items-start gap-3">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border ${getAgentStyle(streamingAgent).bg} ${getAgentStyle(streamingAgent).border}`}>
              <span className="text-xs animate-pulse">{AGENT_ICONS[streamingAgent] || '⚡'}</span>
            </div>
            <div className="flex flex-col">
              {streamingTools.map((ev, i) => {
                if (ev.type === 'delegation') {
                  return <AgentDelegationBadge key={i} agent={ev.agent} />
                }
                if (ev.type === 'tool_call' || ev.type === 'tool_result') {
                  return <ToolCallBadge key={i} tool={ev.tool} args={ev.args} result={ev.result} success={ev.success !== false} pending={ev.pending} />
                }
                return null
              })}
            </div>
          </div>
        )}

        {/* Streaming text */}
        {streamingContent && (
          <div className="flex items-start gap-3 message-enter">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border ${getAgentStyle(streamingAgent).bg} ${getAgentStyle(streamingAgent).border}`}>
              <span className="text-xs animate-pulse">{AGENT_ICONS[streamingAgent] || '⚡'}</span>
            </div>
            <div className="flex flex-col items-start gap-1">
              {streamingAgent && streamingAgent !== 'NOVA' && (
                <AgentBadge agentName={streamingAgent} />
              )}
              <div className="aira-panel px-4 py-3 max-w-[82%]">
                <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-aira-blue prose-code:text-aira-blue prose-code:bg-aira-darker prose-code:px-1 prose-code:rounded prose-li:my-0.5 prose-strong:text-aira-text">
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
                <span className="inline-block w-1.5 h-4 bg-aira-blue ml-0.5 animate-pulse align-text-bottom" />
              </div>
            </div>
          </div>
        )}

        {loading && !streamingContent && streamingTools.length === 0 && <TypingIndicator agentName={streamingAgent} />}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
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
          NOVA · 7-Agent Fleet · Groq LLaMA 3.3 70B · Say "Hey Nova" · Built for Mr. V
        </p>
      </div>
    </div>
  )
}
