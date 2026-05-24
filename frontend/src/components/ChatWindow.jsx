import React, { useState, useRef, useEffect } from 'react'
import { Send, Zap, Copy, RotateCcw, Mic } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import axios from 'axios'

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

function Message({ message, onCopy }) {
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

        {/* Timestamp + Copy */}
        <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-aira-text-dim">
            {message.timestamp?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </span>
          <button
            onClick={() => onCopy(message.content)}
            className="text-aira-text-dim hover:text-aira-blue transition-colors"
          >
            <Copy className="w-3 h-3" />
          </button>
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
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

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

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sendMessage = async (text = input) => {
    const userMessage = text.trim()
    if (!userMessage || loading) return

    setInput('')
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
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: fullContent,
                  timestamp: new Date(),
                }])
                setStreamingContent('')
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Connection error. Please check that the backend is running and try again.',
        timestamp: new Date(),
      }])
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
    setMessages([WELCOME_MESSAGE])
    setStreamingContent('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-aira-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">AIRA INTERFACE</span>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-1.5 text-xs text-aira-text-dim hover:text-aira-blue transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.map((msg, i) => (
          <Message key={i} message={msg} onCopy={handleCopy} />
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
        <div className="flex items-end gap-3">
          <div className="flex-1 bg-aira-darker border border-aira-border rounded-xl px-4 py-2.5 focus-within:border-aira-blue transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message AIRA... (Enter to send, Shift+Enter for new line)"
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
