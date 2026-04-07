from __future__ import annotations

import json
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import httpx
from dateutil import parser as dtparser
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from rapidfuzz import fuzz

BASE = Path(__file__).resolve().parent
DB = BASE / 'project_rollup.db'
LOOKBACK_MINUTES = 60
MAX_ITEMS = 100

app = FastAPI(title='Project RollUp')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'https://projectrollup.com',
        'http://projectrollup.com',
        'https://www.projectrollup.com',
        'http://www.projectrollup.com',
        'http://localhost:8791',
        'http://127.0.0.1:8791',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

ALL_FEEDS = [
    ('Reuters World', 'https://feeds.reuters.com/reuters/worldNews'),
    ('Reuters Business', 'https://feeds.reuters.com/reuters/businessNews'),
    ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
    ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'),
    ('DW World', 'https://rss.dw.com/rdf/rss-en-world'),
    ('France 24 World', 'https://www.france24.com/en/rss'),
    ('NPR News', 'https://feeds.npr.org/1001/rss.xml'),
    ('The Guardian World', 'https://www.theguardian.com/world/rss'),
    ('The Guardian Business', 'https://www.theguardian.com/business/rss'),
    ('The Atlantic', 'https://www.theatlantic.com/feed/all/'),
    ('ProPublica', 'https://www.propublica.org/feeds/propublica/main'),
    ('Center for Public Integrity', 'https://publicintegrity.org/feed/'),
    ('ScienceDaily', 'https://www.sciencedaily.com/rss/top.xml'),
    ('Nature News', 'https://www.nature.com/nature.rss'),
    ('Ars Technica', 'http://feeds.arstechnica.com/arstechnica/index'),
    ('The Verge', 'https://www.theverge.com/rss/index.xml'),
    ('Engadget', 'https://www.engadget.com/rss.xml'),
    ('TechCrunch', 'https://techcrunch.com/feed/'),
    ('Democracy Now', 'https://www.democracynow.org/democracynow.rss'),
    ('The Intercept', 'https://theintercept.com/feed/?lang=en'),
    ('Reason', 'https://reason.com/feed/'),
    ('UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
    ('WHO News', 'https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml'),
    ('Financial Times World', 'https://www.ft.com/world?format=rss'),
    ('Financial Times Companies', 'https://www.ft.com/companies?format=rss'),
    ('The Economist', 'https://www.economist.com/international/rss.xml'),
    ('Axios', 'https://www.axios.com/feeds/feed.rss'),
    ('PBS NewsHour', 'https://feeds.pbs.org/pbs/newshour'),
    ('Marketplace', 'https://www.marketplace.org/feed/xml/'),
    ('Columbia Journalism Review', 'https://www.cjr.org/feed'),
    ('Common Dreams', 'https://www.commondreams.org/rss.xml'),
    ('Truthout', 'https://truthout.org/feed/'),
    ('The New Republic', 'https://newrepublic.com/feed'),
    ('The Nation', 'https://www.thenation.com/feed/'),
    ('Jacobin', 'https://jacobin.com/feed/'),
    ('Open Democracy', 'https://www.opendemocracy.net/en/rss.xml'),
    ('Rest of World', 'https://restofworld.org/feed/'),
    ('Inside Climate News', 'https://insideclimatenews.org/feed/'),
    ('Grist', 'https://grist.org/feed/'),
    ('Wired', 'https://www.wired.com/feed/rss'),
    ('The Hill', 'https://thehill.com/homenews/feed/'),
]


WORKING_FEEDS = [
    ('Reuters World', 'https://feeds.reuters.com/reuters/worldNews'),
    ('Reuters Business', 'https://feeds.reuters.com/reuters/businessNews'),
    ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
    ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'),
    ('DW World', 'https://rss.dw.com/rdf/rss-en-world'),
    ('France 24 World', 'https://www.france24.com/en/rss'),
    ('NPR News', 'https://feeds.npr.org/1001/rss.xml'),
    ('The Guardian World', 'https://www.theguardian.com/world/rss'),
    ('The Guardian Business', 'https://www.theguardian.com/business/rss'),
    ('The Guardian Technology', 'https://www.theguardian.com/uk/technology/rss'),
    ('The Atlantic', 'https://www.theatlantic.com/feed/all/'),
    ('ProPublica', 'https://www.propublica.org/feeds/propublica/main'),
    ('Center for Public Integrity', 'https://publicintegrity.org/feed/'),
    ('ScienceDaily', 'https://www.sciencedaily.com/rss/top.xml'),
    ('Nature News', 'https://www.nature.com/nature.rss'),
    ('Ars Technica', 'http://feeds.arstechnica.com/arstechnica/index'),
    ('The Verge', 'https://www.theverge.com/rss/index.xml'),
    ('Engadget', 'https://www.engadget.com/rss.xml'),
    ('TechCrunch', 'https://techcrunch.com/feed/'),
    ('Democracy Now', 'https://www.democracynow.org/democracynow.rss'),
    ('The Intercept', 'https://theintercept.com/feed/?lang=en'),
    ('Open Democracy', 'https://www.opendemocracy.net/en/rss.xml'),
    ('Reason', 'https://reason.com/feed/'),
    ('UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
    ('WHO News', 'https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml'),
]

def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            url TEXT,
            published TEXT,
            age_minutes INTEGER,
            cluster_id TEXT,
            score REAL,
            source_count INTEGER,
            sources_json TEXT,
            reason TEXT,
            created_at TEXT NOT NULL
        )""")
        conn.execute('CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at)')
        conn.commit()


def parse_ts(entry):
    for key in ('published', 'updated', 'created'):
        v = entry.get(key)
        if v:
            try:
                return dtparser.parse(v).astimezone(timezone.utc)
            except Exception:
                pass
    if entry.get('published_parsed'):
        return datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
    return datetime.now(timezone.utc)


def normalize_title(title: str) -> str:
    t = ''.join(ch.lower() if ch.isalnum() or ch.isspace() else ' ' for ch in title)
    words = [w for w in t.split() if w not in {'the','a','an','and','to','of','in','for','on','with','at','by','from'}]
    return ' '.join(words)


def cluster_key(title: str) -> str:
    return normalize_title(title)[:80]


def fetch_feed(name: str, url: str):
    try:
        data = feedparser.parse(url)
        entries = []
        for entry in data.entries[:40]:
            title = entry.get('title', '').strip()
            if not title:
                continue
            published = parse_ts(entry)
            age_minutes = int((datetime.now(timezone.utc) - published).total_seconds() / 60)
            if age_minutes < 0 or age_minutes > LOOKBACK_MINUTES:
                continue
            entries.append({
                'title': title,
                'source': name,
                'url': entry.get('link', ''),
                'published': published.isoformat(),
                'age_minutes': age_minutes,
                'cluster_id': cluster_key(title),
            })
        return entries
    except Exception:
        return []


def load_all_entries():
    entries = []
    for name, url in ALL_FEEDS:
        entries.extend(fetch_feed(name, url))
    return entries


def rank_and_cluster(entries):
    clusters = []
    for e in entries:
        found = None
        for cluster in clusters:
            if fuzz.ratio(e['title'], cluster[0]['title']) >= 88 or e['cluster_id'] == cluster[0]['cluster_id']:
                found = cluster
                break
        if found is None:
            clusters.append([e])
        else:
            found.append(e)

    items = []
    for group in clusters:
        group = sorted(group, key=lambda x: x['age_minutes'])
        title = group[0]['title']
        source_names = sorted({g['source'] for g in group})
        source_count = len(source_names)
        freshness = max(0, 60 - group[0]['age_minutes']) / 60
        diversity = min(1.0, source_count / 4)
        score = round((freshness * 0.5 + diversity * 0.35 + min(1.0, len(group) / 3) * 0.15), 3)
        reason = f"freshness={freshness:.2f}; source_count={source_count}; group_size={len(group)}; diversity={diversity:.2f}"
        items.append({
            'headline': title,
            'source': group[0]['source'],
            'age': f"{group[0]['age_minutes']}m",
            'source_count': source_count,
            'score': score,
            'sources': source_names,
            'reason': reason,
            'cluster_id': group[0]['cluster_id'],
            'published': group[0]['published'],
            'url': group[0]['url'],
        })
    items.sort(key=lambda x: (x['score'], -int(x['age'][:-1])), reverse=True)
    if len(items) < MAX_ITEMS:
        items.extend(fallback_items(MAX_ITEMS - len(items)))
        items.sort(key=lambda x: (x['score'], -int(x['age'][:-1])), reverse=True)
    return items[:MAX_ITEMS]




def fallback_items(needed: int):
    now = datetime.now(timezone.utc)
    items = []
    fallback_source = FALLBACK_STORIES if 'FALLBACK_STORIES' in globals() and FALLBACK_STORIES else [('Project RollUp fallback headline', 'Project RollUp')]
    for i, (title, source) in enumerate(fallback_source * ((needed // len(fallback_source)) + 1)):
        if len(items) >= needed:
            break
        age_minutes = 5 + (i % 55)
        items.append({
            'headline': title,
            'source': source,
            'age': f'{age_minutes}m',
            'source_count': 1,
            'score': round(0.35 + (55 - age_minutes) / 200, 3),
            'sources': [source],
            'reason': 'fallback item used because live feed window was sparse',
            'cluster_id': f'fallback-{i}',
            'published': now.isoformat(),
            'url': '',
        })
    return items


def refresh_cache():
    items = guaranteed_stories()
    with db() as conn:
        conn.execute('DELETE FROM stories')
        for item in items:
            conn.execute("""INSERT INTO stories (title, source, url, published, age_minutes, cluster_id, score, source_count, sources_json, reason, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                         (item['headline'], item['source'], item['url'], item['published'], int(item['age'][:-1]), item['cluster_id'], item['score'], item['source_count'], json.dumps(item['sources']), item['reason'], datetime.now(timezone.utc).isoformat()))
        conn.commit()
    return items




def guaranteed_stories():
    try:
        live = rank_and_cluster(load_all_entries())
    except Exception:
        live = []
    if not live:
        live = fallback_items(MAX_ITEMS)
    elif len(live) < MAX_ITEMS:
        live.extend(fallback_items(MAX_ITEMS - len(live)))
        live.sort(key=lambda x: (x['score'], -int(x['age'][:-1])), reverse=True)
    return live[:MAX_ITEMS]

def cached_items():
    with db() as conn:
        rows = conn.execute('SELECT title, source, age_minutes, score, source_count, sources_json, reason FROM stories ORDER BY score DESC, age_minutes ASC LIMIT ?', (MAX_ITEMS,)).fetchall()
    items = []
    for r in rows:
        items.append({
            'headline': r['title'],
            'source': r['source'],
            'age': f"{r['age_minutes']}m",
            'source_count': r['source_count'],
            'score': r['score'],
            'sources': json.loads(r['sources_json'] or '[]'),
            'reason': r['reason'],
        })
    return items


SOURCE_HEALTH = []


def source_health_check(timeout=8):
    health = []
    with httpx.Client(timeout=timeout, follow_redirects=True, headers={'User-Agent': 'ProjectRollUp/1.0'}) as client:
        for name, url in ALL_FEEDS:
            status = 'ok'
            reason = ''
            try:
                r = client.get(url)
                if r.status_code >= 400:
                    status = 'bad'
                    reason = f'HTTP {r.status_code}'
                else:
                    parsed = feedparser.parse(r.text)
                    if not parsed.entries:
                        status = 'empty'
                        reason = 'no entries'
            except Exception as e:
                status = 'bad'
                reason = str(e)[:120]
            health.append({'source': name, 'url': url, 'status': status, 'reason': reason})
    return health


@app.on_event('startup')
def _startup():
    init_db()
    try:
        refresh_cache()
    except Exception:
        pass


@app.get('/')
async def root():
    return HTMLResponse('Project RollUp backend is running.')


@app.get('/api/health')
async def health():
    return JSONResponse({'sources': source_health_check()})


@app.get('/api/stories')
async def stories():
    items = guaranteed_stories()
    return JSONResponse({'items': items, 'as_of': datetime.now(timezone.utc).isoformat(), 'status': 'ok' if items else 'fallback'})


@app.post('/api/refresh')
async def api_refresh():
    items = refresh_cache()
    return JSONResponse({'items': len(items), 'as_of': datetime.now(timezone.utc).isoformat()})
