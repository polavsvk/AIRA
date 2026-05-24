import React, { useState, useEffect } from 'react'
import { Newspaper, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react'
import axios from 'axios'

const CATEGORIES = ['general', 'technology', 'business', 'science', 'health', 'sports']

export default function NewsWidget() {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('general')
  const [demo, setDemo] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const fetchNews = async (cat = category) => {
    setLoading(true)
    try {
      const res = await axios.get(`/api/news?category=${cat}`)
      setNews(res.data.articles || [])
      setDemo(res.data.demo || false)
    } catch (err) {
      console.error('News fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchNews() }, [])

  const handleCategoryChange = (cat) => {
    setCategory(cat)
    fetchNews(cat)
  }

  return (
    <div className="aira-panel p-4 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">NEWS FEED</span>
          {demo && (
            <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded font-mono">
              DEMO
            </span>
          )}
        </div>
        <button onClick={() => fetchNews()} className="text-aira-text-dim hover:text-aira-blue transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex gap-1 flex-wrap mb-3 flex-shrink-0">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={`text-xs px-2 py-0.5 rounded font-mono transition-colors capitalize
              ${category === cat
                ? 'bg-aira-blue/20 text-aira-blue border border-aira-blue/40'
                : 'text-aira-text-dim border border-aira-border hover:border-aira-blue/40 hover:text-aira-blue'
              }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* News List */}
      <div className="overflow-y-auto space-y-2 flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <RefreshCw className="w-5 h-5 text-aira-blue animate-spin" />
          </div>
        ) : news.length === 0 ? (
          <div className="text-center text-aira-text-dim text-xs py-4">No articles found.</div>
        ) : (
          news.map((article, i) => (
            <div
              key={i}
              className="border border-aira-border rounded-lg p-2.5 hover:border-aira-blue/30 transition-colors cursor-pointer"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-aira-text leading-relaxed line-clamp-2">{article.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-aira-text-dim">{article.source}</span>
                    <span className="text-xs text-aira-text-dim">·</span>
                    <span className="text-xs text-aira-text-dim">{article.publishedAt}</span>
                  </div>
                </div>
                <ChevronDown className={`w-3 h-3 text-aira-text-dim flex-shrink-0 mt-0.5 transition-transform ${expanded === i ? 'rotate-180' : ''}`} />
              </div>

              {expanded === i && article.description && (
                <div className="mt-2 pt-2 border-t border-aira-border">
                  <p className="text-xs text-aira-text-dim leading-relaxed">{article.description}</p>
                  {article.url !== '#' && (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-aira-blue mt-1.5 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      Read more <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
