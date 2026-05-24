import React, { useState, useEffect, useRef } from 'react'
import { Radio, ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-react'
import Header from './components/Header'
import ChatWindow from './components/ChatWindow'
import WeatherWidget from './components/WeatherWidget'
import NewsWidget from './components/NewsWidget'
import TaskManager from './components/TaskManager'
import DailyBriefing from './components/DailyBriefing'
import axios from 'axios'

export default function App() {
  const [isOnline, setIsOnline] = useState(false)
  const [showBriefing, setShowBriefing] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingChatMessage, setPendingChatMessage] = useState(null)
  const chatRef = useRef(null)

  // Check backend health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await axios.get('/api/health')
        setIsOnline(true)
      } catch {
        setIsOnline(false)
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleBriefingToChat = (message) => {
    setPendingChatMessage(message)
  }

  return (
    <div className="h-screen flex flex-col bg-aira-dark overflow-hidden">
      {/* Header */}
      <Header isOnline={isOnline} />

      {/* Main Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left Sidebar */}
        <aside className={`flex-shrink-0 border-r border-aira-border flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'
        }`}>
          <div className="flex flex-col h-full overflow-hidden p-3 gap-3">

            {/* Daily Briefing Button */}
            <button
              onClick={() => setShowBriefing(true)}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border border-aira-blue/30 bg-aira-blue/5 text-aira-blue hover:bg-aira-blue/10 transition-colors group"
            >
              <Radio className="w-4 h-4 group-hover:animate-pulse" />
              <span className="text-xs font-mono tracking-wider">DAILY BRIEFING</span>
              <span className="ml-auto text-xs text-aira-blue/50">▶</span>
            </button>

            {/* Weather Widget */}
            <WeatherWidget />

            {/* Task Manager */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <TaskManager />
            </div>
          </div>
        </aside>

        {/* Collapse Toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="flex-shrink-0 w-5 flex items-center justify-center border-r border-aira-border bg-aira-darker hover:bg-aira-panel transition-colors group"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {sidebarCollapsed
            ? <ChevronRight className="w-3 h-3 text-aira-text-dim group-hover:text-aira-blue" />
            : <ChevronLeft className="w-3 h-3 text-aira-text-dim group-hover:text-aira-blue" />
          }
        </button>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          <ChatWindow
            ref={chatRef}
            pendingMessage={pendingChatMessage}
            onPendingMessageSent={() => setPendingChatMessage(null)}
          />
        </main>

        {/* Right Sidebar — News */}
        <aside className="flex-shrink-0 w-72 border-l border-aira-border flex flex-col">
          <div className="flex flex-col h-full overflow-hidden p-3">
            <NewsWidget />
          </div>
        </aside>
      </div>

      {/* Daily Briefing Modal */}
      {showBriefing && (
        <DailyBriefing
          onClose={() => setShowBriefing(false)}
          onSendToChat={handleBriefingToChat}
        />
      )}
    </div>
  )
}
