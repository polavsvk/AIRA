/**
 * NOVA Pattern Manager
 * ────────────────────
 * Shows Mr. V his learned habits: pending suggestions + active rules.
 * Lets him accept, decline, pause, resume, and freeze all automation.
 *
 * Designed to feel like an Iron Man suit manifest — concise, dense,
 * no wasted space.
 */

import { useState, useEffect, useCallback } from 'react'
import { Zap, Shield, Pause, Play, Trash2, CheckCircle, XCircle, Lock, Unlock } from 'lucide-react'

const API = 'http://localhost:8000'

async function apiFetch(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return res.json()
}

const TIER_COLOR = { 1: 'text-emerald-400', 2: 'text-amber-400' }
const TIER_LABEL = { 1: 'AUTO', 2: 'CONFIRM' }
const STATUS_COLOR = {
  active: 'text-emerald-400',
  suggested: 'text-sky-400',
  paused: 'text-zinc-500',
  declined: 'text-red-500 line-through opacity-40',
}

export default function PatternManager({ onClose }) {
  const [status, setStatus]       = useState(null)
  const [suggested, setSuggested] = useState([])
  const [rules, setRules]         = useState([])
  const [tab, setTab]             = useState('suggested')   // 'suggested' | 'active' | 'all'
  const [loading, setLoading]     = useState(false)

  const refresh = useCallback(async () => {
    const [s, sug, all] = await Promise.all([
      apiFetch('/api/patterns/status'),
      apiFetch('/api/patterns/rules/suggested'),
      apiFetch('/api/patterns/rules'),
    ])
    setStatus(s)
    setSuggested(sug.rules || [])
    setRules(all.rules || [])
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function act(path, body) {
    setLoading(true)
    await apiFetch(path, 'POST', body)
    await refresh()
    setLoading(false)
  }

  const displayed = tab === 'suggested'
    ? suggested
    : tab === 'active'
      ? rules.filter(r => r.status === 'active')
      : rules

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[520px] max-h-[80vh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-sky-400" />
            <span className="font-semibold text-white text-sm tracking-wide">HABIT MEMORY</span>
            {status && (
              <span className="ml-2 text-xs text-zinc-500">
                {status.active_count} active · {status.suggested_count} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Freeze toggle */}
            <button
              onClick={() => act(status?.frozen ? '/api/patterns/unfreeze' : '/api/patterns/freeze')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all
                ${status?.frozen
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500'}`}
            >
              {status?.frozen ? <Lock size={12} /> : <Unlock size={12} />}
              {status?.frozen ? 'FROZEN' : 'FREEZE'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-zinc-800">
          {[
            { key: 'suggested', label: `Pending (${suggested.length})` },
            { key: 'active',    label: `Active (${rules.filter(r => r.status === 'active').length})` },
            { key: 'all',       label: 'All' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors
                ${tab === t.key
                  ? 'text-sky-400 border-b-2 border-sky-400'
                  : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Freeze banner ── */}
        {status?.frozen && (
          <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
            <Shield size={12} />
            All automation paused. NOVA will ask before acting.
          </div>
        )}

        {/* ── List ── */}
        <div className="flex-1 overflow-y-auto">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 text-sm">
              {tab === 'suggested'
                ? 'No pending suggestions yet. Keep using NOVA — it\'s watching.'
                : 'Nothing here.'}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {displayed.map(rule => (
                <li key={rule.id} className="px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-zinc-800/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold tracking-widest ${TIER_COLOR[rule.tier]}`}>
                        {TIER_LABEL[rule.tier]}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider ${STATUS_COLOR[rule.status]}`}>
                        {rule.status}
                      </span>
                    </div>
                    <p className="text-sm text-white truncate">{rule.description}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Seen {rule.count_seen}× · Fired {rule.count_fired}×
                      {rule.tier === 2 && (
                        <span className="ml-2 text-amber-400">· Always confirms</span>
                      )}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {rule.status === 'suggested' && (
                      <>
                        <ActionBtn
                          icon={<CheckCircle size={14} />}
                          label="Accept"
                          color="text-emerald-400 hover:bg-emerald-500/10"
                          disabled={loading}
                          onClick={() => act('/api/patterns/rules/accept', { rule_id: rule.id })}
                        />
                        <ActionBtn
                          icon={<XCircle size={14} />}
                          label="Decline"
                          color="text-red-400 hover:bg-red-500/10"
                          disabled={loading}
                          onClick={() => act('/api/patterns/rules/decline', { rule_id: rule.id })}
                        />
                      </>
                    )}
                    {rule.status === 'active' && (
                      <ActionBtn
                        icon={<Pause size={14} />}
                        label="Pause"
                        color="text-zinc-400 hover:bg-zinc-700"
                        disabled={loading}
                        onClick={() => act('/api/patterns/rules/pause', { rule_id: rule.id })}
                      />
                    )}
                    {rule.status === 'paused' && (
                      <ActionBtn
                        icon={<Play size={14} />}
                        label="Resume"
                        color="text-sky-400 hover:bg-sky-500/10"
                        disabled={loading}
                        onClick={() => act('/api/patterns/rules/resume', { rule_id: rule.id })}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <p className="text-xs text-zinc-600">
            Say <span className="text-zinc-400">"NOVA freeze"</span> to pause all automation instantly.
          </p>
          <button
            onClick={refresh}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ icon, label, color, onClick, disabled }) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded-lg transition-all disabled:opacity-40 ${color}`}
    >
      {icon}
    </button>
  )
}
