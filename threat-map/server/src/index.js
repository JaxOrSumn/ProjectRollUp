import express from 'express'
import { createServer } from 'http'
import { Server as SocketIO } from 'socket.io'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import path from 'path'
import { ingestCycle } from './ingest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4000
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../threat-map.db')

// ── Database setup ──────────────────────────────────────
export const db = new Database(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    headline TEXT NOT NULL,
    category TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    location_name TEXT,
    source_outlet TEXT,
    source_url TEXT,
    occurred_at TEXT,
    ingested_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(ingested_at);
`)

// ── Express + Socket.io ─────────────────────────────────
const app  = express()
const http = createServer(app)
const io   = new SocketIO(http, { cors: { origin: '*' } })

app.use(express.json())
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next() })

app.get('/api/events', (req, res) => {
  const since = req.query.since || new Date(Date.now() - 7 * 86400_000).toISOString()
  const rows  = db.prepare(
    'SELECT * FROM events WHERE ingested_at >= ? ORDER BY ingested_at DESC LIMIT 500'
  ).all(since)
  res.json(rows)
})

app.get('/api/health', (_req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM events').get()
  res.json({ status: 'ok', total_events: count.n })
})

// ── Ingest cycle ────────────────────────────────────────
export function broadcastEvent(event) {
  io.emit('new_event', event)
}

async function runIngest() {
  try { await ingestCycle(db, broadcastEvent) }
  catch (err) { console.error('[ingest] error:', err.message) }
}

runIngest()
setInterval(runIngest, 5 * 60 * 1000)  // every 5 minutes

io.on('connection', socket => {
  console.log('[ws] client connected:', socket.id)
  socket.on('disconnect', () => console.log('[ws] client disconnected:', socket.id))
})

http.listen(PORT, () => console.log(`[threat-map] server running on :${PORT}`))
