import React, { useState, useEffect } from 'react'
import { Cloud, Wind, Droplets, Thermometer, RefreshCw, MapPin, LocateFixed } from 'lucide-react'
import axios from 'axios'

const WEATHER_ICONS = {
  '01d': '☀️', '01n': '🌙', '02d': '⛅', '02n': '⛅',
  '03d': '☁️', '03n': '☁️', '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️', '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️', '13d': '❄️', '13n': '❄️',
  '50d': '🌫️', '50n': '🌫️',
}

export default function WeatherWidget() {
  const [weather, setWeather] = useState(null)
  const [city, setCity] = useState('London')
  const [inputCity, setInputCity] = useState('')
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)

  const fetchWeather = async (targetCity) => {
    setLoading(true)
    try {
      const res = await axios.get(`/api/weather?city=${encodeURIComponent(targetCity)}`, { timeout: 8000 })
      setWeather(res.data)
      setCity(targetCity)
    } catch {
      setWeather(null)
    } finally {
      setLoading(false)
    }
  }

  // Auto-detect city via IP geolocation (no browser permission needed, instant)
  const detectLocation = async () => {
    setLocating(true)
    try {
      // IP-based geolocation — free, no API key, no permission popup
      const res = await axios.get('https://ipapi.co/json/', { timeout: 5000 })
      const detectedCity = res.data?.city || 'London'
      await fetchWeather(detectedCity)
    } catch {
      // Fallback to browser geolocation
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const { latitude: lat, longitude: lon } = pos.coords
              const r = await axios.get(`/api/weather/coords?lat=${lat}&lon=${lon}`, { timeout: 8000 })
              setWeather(r.data)
              setCity(r.data?.current?.city || 'Your Location')
            } catch {
              await fetchWeather('London')
            } finally {
              setLocating(false)
            }
          },
          async () => { await fetchWeather('London'); setLocating(false) },
          { timeout: 5000 }
        )
        return
      }
      await fetchWeather('London')
    } finally {
      setLocating(false)
    }
  }

  useEffect(() => { detectLocation() }, [])

  const handleCitySubmit = (e) => {
    e.preventDefault()
    if (inputCity.trim()) { fetchWeather(inputCity.trim()); setInputCity('') }
  }

  if (loading || locating) {
    return (
      <div className="aira-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">WEATHER</span>
        </div>
        <div className="flex items-center justify-center gap-2 h-16">
          <RefreshCw className="w-4 h-4 text-aira-blue animate-spin" />
          <span className="text-xs text-aira-text-dim font-mono">{locating ? 'DETECTING LOCATION…' : 'LOADING…'}</span>
        </div>
      </div>
    )
  }

  if (!weather) {
    return (
      <div className="aira-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <Cloud className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">WEATHER</span>
        </div>
        <p className="text-xs text-red-400 mb-2">Weather unavailable. Check your API key.</p>
        <button onClick={() => fetchWeather(city)} className="text-xs text-aira-blue hover:underline">Retry</button>
      </div>
    )
  }

  const current = weather.current
  const forecast = weather.forecast || []

  return (
    <div className="aira-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">WEATHER</span>
          {weather.demo && <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded font-mono">DEMO</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={detectLocation} title="Re-detect location" className="text-aira-text-dim hover:text-aira-blue transition-colors">
            <LocateFixed className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => fetchWeather(city)} className="text-aira-text-dim hover:text-aira-blue transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <form onSubmit={handleCitySubmit} className="flex gap-2 mb-3">
        <div className="flex-1 flex items-center gap-1 bg-aira-darker border border-aira-border rounded px-2 py-1">
          <MapPin className="w-3 h-3 text-aira-text-dim" />
          <input value={inputCity} onChange={e => setInputCity(e.target.value)}
            placeholder={current?.city || 'Enter city…'}
            className="bg-transparent text-xs text-aira-text outline-none flex-1 w-full" />
        </div>
        <button type="submit" className="text-xs px-2 py-1 bg-aira-blue/10 border border-aira-blue/30 text-aira-blue rounded hover:bg-aira-blue/20 transition-colors">Go</button>
      </form>

      {current && (
        <>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-2xl font-bold text-aira-text">{current.temperature}°C</div>
              <div className="text-xs text-aira-text-dim">{current.description}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-2.5 h-2.5 text-aira-blue" />
                <span className="text-xs text-aira-text-dim">{current.city}{current.country ? `, ${current.country}` : ''}</span>
              </div>
            </div>
            <div className="text-3xl">{WEATHER_ICONS[current.icon] || '🌡️'}</div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="flex items-center gap-1">
              <Thermometer className="w-3 h-3 text-aira-blue" />
              <span className="text-xs text-aira-text-dim">Feels {current.feels_like}°</span>
            </div>
            <div className="flex items-center gap-1">
              <Droplets className="w-3 h-3 text-aira-blue" />
              <span className="text-xs text-aira-text-dim">{current.humidity}%</span>
            </div>
            <div className="flex items-center gap-1">
              <Wind className="w-3 h-3 text-aira-blue" />
              <span className="text-xs text-aira-text-dim">{current.wind_speed}km/h</span>
            </div>
          </div>
        </>
      )}

      {forecast.length > 0 && (
        <>
          <div className="border-t border-aira-border mb-3" />
          <div className="space-y-2">
            {forecast.map((day, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-aira-text-dim w-20 truncate">{day.day}</span>
                <span className="text-sm">{WEATHER_ICONS[day.icon] || '🌡️'}</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-aira-text">{day.high}°</span>
                  <span className="text-aira-text-dim">{day.low}°</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
