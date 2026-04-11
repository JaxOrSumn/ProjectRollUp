import React, { useCallback, useEffect, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import { io } from 'socket.io-client'
import type { ThreatEvent, ThreatCategory, FilterState } from './types'
import './app.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

const CATEGORY_COLORS: Record<ThreatCategory, string> = {
  mass_violence:   '#ff3333',
  terrorism:       '#ff7700',
  insurgency:      '#ffcc00',
  sabotage:        '#cc44ff',
  organized_crime: '#44ccff',
}

const CATEGORY_LABELS: Record<ThreatCategory, string> = {
  mass_violence:   'MASS VIOLENCE',
  terrorism:       'TERRORISM',
  insurgency:      'INSURGENCY / COUP',
  sabotage:        'SABOTAGE',
  organized_crime: 'ORGANIZED CRIME',
}

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as ThreatCategory[]

const TIME_RANGES = ['24h', '7d', '30d'] as const

export default function App() {
  const [events, setEvents]         = useState<ThreatEvent[]>([])
  const [selected, setSelected]     = useState<ThreatEvent | null>(null)
  const [eventCount, setEventCount] = useState(0)
  const [filters, setFilters]       = useState<FilterState>({
    categories: new Set(ALL_CATEGORIES),
    timeRange: '7d',
  })
  const globeRef = useRef<any>(null)

  // Fetch initial events
  useEffect(() => {
    const since = timeRangeToISO(filters.timeRange)
    fetch(`${API}/api/events?since=${since}`)
      .then(r => r.json())
      .then((data: ThreatEvent[]) => { setEvents(data); setEventCount(data.length) })
      .catch(console.error)
  }, [filters.timeRange])

  // Live WebSocket updates
  useEffect(() => {
    const socket = io(API)
    socket.on('new_event', (evt: ThreatEvent) => {
      setEvents(prev => [evt, ...prev])
      setEventCount(c => c + 1)
    })
    return () => { socket.disconnect() }
  }, [])

  const filteredEvents = events.filter(e => filters.categories.has(e.category))

  const globePoints = filteredEvents.map(e => ({
    lat: e.lat,
    lng: e.lon,
    size: 0.4,
    color: CATEGORY_COLORS[e.category] || '#ffffff',
    event: e,
  }))

  const toggleCategory = (cat: ThreatCategory) => {
    setFilters(f => {
      const next = new Set(f.categories)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return { ...f, categories: next }
    })
  }

  const handlePointClick = useCallback((point: any) => {
    setSelected(point.event as ThreatEvent)
  }, [])

  return (
    <div className="app">
      <header className="tm-header">
        <div className="tm-logo">THREAT MAP</div>
        <div className="tm-subtitle">OPEN-SOURCE INTELLIGENCE · CONFIRMED EVENTS ONLY</div>
        <div className="tm-count">{eventCount} EVENTS TRACKED</div>
      </header>

      {/* Filter toolbar */}
      <div className="tm-toolbar">
        <div className="tm-filter-group">
          <span className="tm-filter-label">TIME:</span>
          {TIME_RANGES.map(r => (
            <button
              key={r}
              className={`tm-pill ${filters.timeRange === r ? 'active' : ''}`}
              onClick={() => setFilters(f => ({ ...f, timeRange: r }))}
            >{r.toUpperCase()}</button>
          ))}
        </div>
        <div className="tm-filter-group">
          <span className="tm-filter-label">CATEGORY:</span>
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`tm-pill ${filters.categories.has(cat) ? 'active' : ''}`}
              style={{ '--pill-color': CATEGORY_COLORS[cat] } as React.CSSProperties}
              onClick={() => toggleCategory(cat)}
            >{CATEGORY_LABELS[cat]}</button>
          ))}
        </div>
      </div>

      {/* Globe */}
      <div className="tm-globe-wrap">
        <Globe
          ref={globeRef}
          backgroundColor="#0a0a0a"
          globeImageUrl=""
          bumpImageUrl=""
          showGraticules
          showAtmosphere={false}
          polygonsData={[]}
          pointsData={globePoints}
          pointLat="lat"
          pointLng="lng"
          pointAltitude={0.01}
          pointRadius="size"
          pointColor="color"
          pointLabel={(p: any) => p.event?.headline || ''}
          onPointClick={handlePointClick}
        />
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="tm-detail">
          <button className="tm-detail-close" onClick={() => setSelected(null)}>✕</button>
          <div className="tm-detail-cat" style={{ color: CATEGORY_COLORS[selected.category] }}>
            {CATEGORY_LABELS[selected.category]}
          </div>
          <div className="tm-detail-headline">{selected.headline}</div>
          <div className="tm-detail-meta">
            <span>{selected.location_name}</span>
            <span>{new Date(selected.occurred_at).toLocaleDateString()}</span>
            <span>{selected.source_outlet}</span>
          </div>
          {selected.source_url && (
            <a className="tm-detail-link" href={selected.source_url} target="_blank" rel="noopener noreferrer">
              READ SOURCE →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function timeRangeToISO(range: typeof TIME_RANGES[number]): string {
  const now = Date.now()
  const map = { '24h': 86400_000, '7d': 604800_000, '30d': 2592000_000 }
  return new Date(now - map[range]).toISOString()
}
