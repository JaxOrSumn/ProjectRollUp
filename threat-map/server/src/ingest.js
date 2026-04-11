/**
 * Feed ingestion + NLP classification for confirmed serious threat events.
 *
 * Scope: mass violence, terrorism, insurgency/coup, sabotage, organized crime.
 * Excludes: protests, civil unrest, sanctions, cybercrime, election disputes,
 *           natural disasters, incidents below serious criminal threshold.
 */
import crypto from 'crypto'

// ── Threat category keyword rules ──────────────────────
const CATEGORY_RULES = [
  {
    category: 'mass_violence',
    pattern: /shooting|gunman|stabbing|massacre|mass casualt|bomb(?:ing| blast)|explosion.*civ|attack.*kill|killed.*people|wounded.*people/i,
    threshold: 1,
  },
  {
    category: 'terrorism',
    pattern: /terror(?:ist|ism|attack)|claimed.*attack|suicide bomb|isis|al-qaeda|al qaeda|hamas attack|hezbollah attack|jihadist|militant.*attack/i,
    threshold: 1,
  },
  {
    category: 'insurgency',
    pattern: /coup|seizure of power|armed uprising|rebel.*seize|seized.*capital|insurgent.*attack|militia.*attack|armed group.*captur/i,
    threshold: 1,
  },
  {
    category: 'sabotage',
    pattern: /sabotage|pipeline.*blast|pipeline.*attack|power grid.*attack|telecom.*attack|rail.*sabotage|infrastructure.*attack|deliberate.*damage.*(?:grid|pipeline|cable)/i,
    threshold: 1,
  },
  {
    category: 'organized_crime',
    pattern: /cartel|drug.*interdiction|trafficking.*network|human.*trafficking.*bust|narco|drug.*seizure|organized crime.*arrest|gang.*massacre/i,
    threshold: 1,
  },
]

// Exclusion patterns — discard before category matching
const EXCLUSION_PATTERN = /protest|demonstration|civil unrest|sanction|cyber(?:attack|hack)|election dispute|earthquake|flood|hurricane|wildfire|storm|drought/i

// Minimum casualty mention required for mass_violence (3+ casualties threshold)
const CASUALTY_PATTERN = /(\d+)\s*(?:people\s+)?(?:killed|dead|shot|wounded|injur)/i

function classifyEvent(headline, summary) {
  const text = `${headline} ${summary || ''}`

  if (EXCLUSION_PATTERN.test(text)) return null

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) {
      // Extra check for mass_violence: require 3+ casualties mentioned
      if (rule.category === 'mass_violence') {
        const m = text.match(CASUALTY_PATTERN)
        if (!m || parseInt(m[1]) < 3) continue
      }
      return rule.category
    }
  }
  return null
}

// ── Country centroid fallback ──────────────────────────
const COUNTRY_CENTROIDS = {
  'United States': [37.09, -95.71], 'Russia': [61.52, 105.32], 'China': [35.86, 104.20],
  'Ukraine': [48.38, 31.17], 'Israel': [31.05, 34.85], 'Gaza': [31.35, 34.31],
  'Pakistan': [30.38, 69.35], 'Afghanistan': [33.94, 67.71], 'Syria': [34.80, 38.99],
  'Iraq': [33.22, 43.68], 'Yemen': [15.55, 48.52], 'Somalia': [5.15, 46.20],
  'Nigeria': [9.08, 8.68], 'Mali': [17.57, -3.99], 'Sudan': [12.86, 30.22],
  'Mexico': [23.63, -102.55], 'Colombia': [4.57, -74.30], 'Brazil': [-14.24, -51.93],
  'Myanmar': [21.92, 95.96], 'Ethiopia': [9.15, 40.49], 'DR Congo': [-4.04, 21.76],
}

function geocodeFromText(text) {
  for (const [country, coords] of Object.entries(COUNTRY_CENTROIDS)) {
    if (text.includes(country)) return { lat: coords[0], lon: coords[1], location_name: country }
  }
  return { lat: 0, lon: 0, location_name: 'Unknown' }
}

// ── GDELT GKG RSS (free, no auth) ─────────────────────
async function fetchGDELT() {
  try {
    const res  = await fetch('https://api.gdeltproject.org/api/v2/doc/doc?query=violence+attack+terrorism&mode=artlist&maxrecords=25&format=json')
    const data = await res.json()
    return (data.articles || []).map(a => ({
      headline: a.title || '',
      summary:  a.title || '',
      url:      a.url   || '',
      outlet:   a.domain || 'GDELT',
      occurred_at: a.seendate ? new Date(a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).toISOString() : new Date().toISOString(),
      location_hint: a.title || '',
    }))
  } catch { return [] }
}

// ── Reuters RSS (no auth, public) ─────────────────────
async function fetchReutersRSS() {
  try {
    const res  = await fetch('https://feeds.reuters.com/reuters/worldNews')
    const text = await res.text()
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1])
    return items.map(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || ''
      const link  = (item.match(/<link>(.*?)<\/link>/) || [])[1] || ''
      const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1] || ''
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || ''
      return {
        headline: title.trim(),
        summary:  desc.replace(/<[^>]+>/g, '').trim(),
        url:      link.trim(),
        outlet:   'Reuters',
        occurred_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        location_hint: `${title} ${desc}`,
      }
    }).filter(a => a.headline)
  } catch { return [] }
}

// ── AP News RSS ────────────────────────────────────────
async function fetchAPRSS() {
  try {
    const res  = await fetch('https://rsshub.app/apnews/topics/apf-topnews')
    const text = await res.text()
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1])
    return items.map(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || ''
      const link  = (item.match(/<link>(.*?)<\/link>/) || [])[1] || ''
      const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || [])[1] || ''
      return {
        headline: title.trim(),
        summary:  desc.replace(/<[^>]+>/g, '').trim().slice(0, 400),
        url:      link.trim(),
        outlet:   'AP News',
        occurred_at: new Date().toISOString(),
        location_hint: `${title} ${desc}`,
      }
    }).filter(a => a.headline)
  } catch { return [] }
}

// ── Main ingest cycle ──────────────────────────────────
export async function ingestCycle(db, broadcast) {
  const sources = await Promise.allSettled([fetchGDELT(), fetchReutersRSS(), fetchAPRSS()])
  const articles = sources.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  const insert = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, headline, category, lat, lon, location_name, source_outlet, source_url, occurred_at, ingested_at)
    VALUES (@id, @headline, @category, @lat, @lon, @location_name, @source_outlet, @source_url, @occurred_at, @ingested_at)
  `)

  let newCount = 0
  for (const article of articles) {
    const category = classifyEvent(article.headline, article.summary)
    if (!category) continue

    const geo = geocodeFromText(article.location_hint || article.headline)
    const id  = crypto.createHash('sha1').update(article.url || article.headline).digest('hex').slice(0, 16)

    const event = {
      id,
      headline:      article.headline,
      category,
      lat:           geo.lat,
      lon:           geo.lon,
      location_name: geo.location_name,
      source_outlet: article.outlet,
      source_url:    article.url,
      occurred_at:   article.occurred_at,
      ingested_at:   new Date().toISOString(),
    }

    const result = insert.run(event)
    if (result.changes > 0) {
      broadcast(event)
      newCount++
    }
  }

  console.log(`[ingest] processed ${articles.length} articles, ${newCount} new events`)
}
