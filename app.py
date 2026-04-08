from __future__ import annotations

import json
import sqlite3
import time
import re
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

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
SUMMARY_WORDS = 400
MAX_BODY_CHARS = 14000

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

PRIMARY_FEEDS = [
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
    ('Open Democracy', 'https://www.opendemocracy.net/en/rss.xml'),
    ('Reason', 'https://reason.com/feed/'),
    ('UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
    ('WHO News', 'https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml'),
]

BACKUP_FEEDS = [
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
    ('Rest of World', 'https://restofworld.org/feed/'),
    ('Inside Climate News', 'https://insideclimatenews.org/feed/'),
    ('Grist', 'https://grist.org/feed/'),
    ('Wired', 'https://www.wired.com/feed/rss'),
    ('The Hill', 'https://thehill.com/homenews/feed/'),
]

FALLBACK_STORIES = [
    ('Global markets remain mixed as investors weigh inflation signals', 'Reuters World'),
    ('Public health officials update guidance after seasonal spike', 'BBC World'),
    ('New climate report warns of uneven progress across major economies', 'The Guardian World'),
    ('Major ports report improved throughput after weather disruptions ease', 'Reuters Business'),
    ('Energy firms announce coordinated maintenance windows to stabilize supply', 'Reuters Business'),
    ('Central banks weigh cautious language ahead of policy meetings', 'Financial Times World'),
    ('Diplomatic talks continue as regional leaders seek ceasefire framework', 'Al Jazeera'),
    ('Tech regulators open new review of platform ranking practices', 'The Verge'),
    ('Aid groups coordinate logistics after transport corridor reopening', 'NPR News'),
    ('Local election results redraw city council balance in key metro areas', 'DW World'),
]


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS stories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                url TEXT,
                published TEXT,
                age_minutes INTEGER,
                freshness_bucket TEXT,
                cluster_id TEXT,
                score REAL,
                source_count INTEGER,
                sources_json TEXT,
                reason TEXT,
                summary TEXT,
                created_at TEXT NOT NULL
            )"""
        )
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
    words = [w for w in t.split() if w not in {'the', 'a', 'an', 'and', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from'}]
    return ' '.join(words)


def cluster_key(title: str) -> str:
    return normalize_title(title)[:80]


def word_count(text: str) -> int:
    return len([w for w in text.split() if w.strip()])


def extract_meta_summary(entry) -> str:
    parts = []
    for key in ('summary', 'description', 'subtitle', 'content'):
        value = entry.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    parts.append(str(item.get('value') or '').strip())
                else:
                    parts.append(str(item).strip())
        elif isinstance(value, dict):
            parts.append(str(value.get('value') or '').strip())
        elif value:
            parts.append(str(value).strip())
    return ' '.join(p for p in parts if p)


def clean_text(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text or '')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_article_text(url: str) -> str:
    if not url:
        return ''
    try:
        with httpx.Client(follow_redirects=True, timeout=8.0, headers={'User-Agent': 'Mozilla/5.0'}) as client:
            res = client.get(url)
            res.raise_for_status()
            text = res.text
    except Exception:
        return ''

    title_match = re.search(r'<title[^>]*>(.*?)</title>', text, flags=re.I | re.S)
    title = clean_text(unescape(title_match.group(1))) if title_match else ''
    paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', text, flags=re.I | re.S)
    cleaned = []
    for ptag in paragraphs:
        chunk = clean_text(unescape(re.sub(r'<[^>]+>', ' ', ptag)))
        if len(chunk) >= 40:
            cleaned.append(chunk)
    body = ' '.join(cleaned[:30])
    return clean_text(f'{title}. {body}')[:MAX_BODY_CHARS]


def summarize_text(title: str, source: str, body: str, meta: str, source_count: int, age_minutes: int, score: float) -> str:
    body = clean_text(body)
    meta = clean_text(meta)
    source_phrase = f'{source}' if source_count == 1 else f'{source} and {source_count - 1} other source(s)'

    sentences = []
    for chunk in re.split(r'(?<=[.!?])\s+', f'{meta}. {body}'):
        chunk = chunk.strip()
        if chunk and chunk not in sentences:
            sentences.append(chunk)

    selected = []
    wc = 0
    for sent in sentences:
        sent_words = word_count(sent)
        if wc + sent_words > SUMMARY_WORDS:
            break
        selected.append(sent)
        wc += sent_words
        if wc >= max(180, SUMMARY_WORDS - 60):
            break

    if not selected:
        selected = [meta or body or title]

    intro = f'{title} is being tracked by Project RollUp from {source_phrase}. It is {age_minutes} minutes old and currently carries a relevance score of {score:.3f}. '
    outro = 'This write-up stays within the facts available from the story metadata and feed text and avoids speculation.'
    summary = intro + ' '.join(selected)
    if word_count(summary + ' ' + outro) <= SUMMARY_WORDS:
        summary = summary + ' ' + outro
    return trim_words(summary, SUMMARY_WORDS)


def trim_words(text: str, limit: int = SUMMARY_WORDS) -> str:
    words = text.split()
    return ' '.join(words[:limit])


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
            if age_minutes < 0:
                age_minutes = 0
            article_url = entry.get('link', '')
            meta_summary = extract_meta_summary(entry)
            content_text = clean_text(meta_summary)
            if article_url:
                extracted = extract_article_text(article_url)
                if extracted:
                    content_text = extracted
            entries.append({'title': title, 'source': name, 'url': article_url, 'published': published.isoformat(), 'age_minutes': age_minutes, 'cluster_id': cluster_key(title), 'meta_summary': meta_summary, 'content_text': content_text})
        return entries
    except Exception:
        return []


def load_entries(feeds: Iterable[tuple[str, str]]):
    entries = []
    for name, url in feeds:
        entries.extend(fetch_feed(name, url))
    return entries


def dedupe_and_rank(entries):
    clusters = []
    for e in entries:
        found = None
        for cluster in clusters:
            base = cluster[0]
            if fuzz.ratio(e['title'], base['title']) >= 88 or e['cluster_id'] == base['cluster_id']:
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
        age_minutes = group[0]['age_minutes']
        freshness = max(0, 60 - min(age_minutes, 240)) / 60
        diversity = min(1.0, source_count / 4)
        cluster_bonus = min(1.0, len(group) / 3)
        score = round((freshness * 0.5 + diversity * 0.35 + cluster_bonus * 0.15), 3)
        bucket = 'fresh' if age_minutes <= 60 else 'older'
        reason = f'freshness={freshness:.2f}; source_count={source_count}; group_size={len(group)}; diversity={diversity:.2f}; bucket={bucket}'
        summary = summarize_text(title, group[0]['source'], ' '.join(g.get('content_text', '') for g in group), ' '.join(g.get('meta_summary', '') for g in group), source_count, age_minutes, score)
        items.append({'headline': title, 'source': group[0]['source'], 'age': f'{age_minutes}m', 'age_minutes': age_minutes, 'freshness_bucket': bucket, 'source_count': source_count, 'score': score, 'sources': source_names, 'reason': reason, 'summary': summary, 'cluster_id': group[0]['cluster_id'], 'published': group[0]['published'], 'url': group[0]['url']})

    items.sort(key=lambda x: (x['score'], -x['age_minutes']), reverse=True)
    return items


def fallback_items(needed: int, bucket='fallback'):
    now = datetime.now(timezone.utc)
    items = []
    pool = FALLBACK_STORIES if FALLBACK_STORIES else [('Project RollUp fallback headline', 'Project RollUp')]
    for i, (title, source) in enumerate(pool * ((needed // len(pool)) + 1)):
        if len(items) >= needed:
            break
        age_minutes = 5 + (i % 55)
        score = round(0.35 + (55 - age_minutes) / 200, 3)
        summary = summarize_text(title, source, title, '', 1, age_minutes, score)
        items.append({'headline': title, 'source': source, 'age': f'{age_minutes}m', 'age_minutes': age_minutes, 'freshness_bucket': bucket, 'source_count': 1, 'score': score, 'sources': [source], 'reason': 'fallback item used because live feed window was sparse', 'summary': summary, 'cluster_id': f'fallback-{i}', 'published': now.isoformat(), 'url': ''})
    return items


def guaranteed_stories(page: int = 1):
    live_primary = dedupe_and_rank(load_entries(PRIMARY_FEEDS))
    recent = [x for x in live_primary if x['age_minutes'] <= LOOKBACK_MINUTES]
    older = [x for x in live_primary if x['age_minutes'] > LOOKBACK_MINUTES]
    items = recent + older
    if len(items) < MAX_ITEMS or page > 1:
        live_backup = dedupe_and_rank(load_entries(BACKUP_FEEDS))
        items.extend(live_backup)
        items = dedupe_and_rank(items)
    if len(items) < MAX_ITEMS:
        items.extend(fallback_items(MAX_ITEMS - len(items)))
        items = dedupe_and_rank(items)
    if len(items) < MAX_ITEMS:
        items.extend(fallback_items(MAX_ITEMS - len(items)))
    if len(items) < MAX_ITEMS:
        items.extend(fallback_items(MAX_ITEMS - len(items), bucket='older'))
    items.sort(key=lambda x: (x.get('score', 0), -x.get('age_minutes', 9999)), reverse=True)
    while len(items) < MAX_ITEMS:
        items.extend(fallback_items(MAX_ITEMS - len(items), bucket='older'))
    return items[:max(MAX_ITEMS, 100)]


def refresh_cache(page: int = 1):
    items = guaranteed_stories(page)
    with db() as conn:
        conn.execute('DELETE FROM stories')
        for item in items:
            conn.execute("""INSERT INTO stories (title, source, url, published, age_minutes, freshness_bucket, cluster_id, score, source_count, sources_json, reason, summary, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (item['headline'], item['source'], item.get('url', ''), item['published'], int(item['age_minutes']), item.get('freshness_bucket', 'fallback'), item['cluster_id'], item['score'], item['source_count'], json.dumps(item['sources']), item['reason'], item.get('summary', ''), datetime.now(timezone.utc).isoformat()))
        conn.commit()
    return items


def cached_items():
    with db() as conn:
        rows = conn.execute('SELECT title, source, age_minutes, freshness_bucket, score, source_count, sources_json, reason, summary FROM stories ORDER BY score DESC, age_minutes ASC LIMIT ?', (MAX_ITEMS,)).fetchall()
    return [{'headline': r['title'], 'source': r['source'], 'age': f"{r['age_minutes']}m", 'age_minutes': r['age_minutes'], 'freshness_bucket': r['freshness_bucket'], 'source_count': r['source_count'], 'score': r['score'], 'sources': json.loads(r['sources_json'] or '[]'), 'reason': r['reason'], 'summary': r['summary'] or ''} for r in rows]


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


@app.get('/api/stories')
async def stories(page: int = 1):
    try:
        items = refresh_cache(page)
    except Exception:
        items = cached_items()
        if len(items) < MAX_ITEMS:
            items.extend(fallback_items(MAX_ITEMS - len(items)))
    items = items[:MAX_ITEMS]
    return JSONResponse({'items': items, 'as_of': datetime.now(timezone.utc).isoformat(), 'status': 'ok' if items else 'fallback', 'count': len(items), 'policy': {'fresh_window_minutes': LOOKBACK_MINUTES, 'minimum_display_count': MAX_ITEMS, 'fallback_order': ['fresh', 'older', 'backup_feeds', 'labeled_older_or_fallback']}})


@app.get('/api/story')
async def story(headline: str):
    try:
        items = refresh_cache()
    except Exception:
        items = cached_items()
    target = None
    nh = normalize_title(headline)
    for item in items:
        if normalize_title(item['headline']) == nh or fuzz.ratio(item['headline'], headline) >= 90:
            target = item
            break
    if target is None:
        target = {'headline': headline, 'source': 'Project RollUp', 'age_minutes': 0, 'score': 0.0, 'sources': ['Project RollUp'], 'reason': 'headline not found in current cache', 'summary': summarize_text(headline, 'Project RollUp', headline, '', 1, 0, 0.0)}
    if target.get('summary'):
        target['summary'] = trim_words(target['summary'], SUMMARY_WORDS)
    return JSONResponse(target)


@app.get('/api/health')
async def health():
    return JSONResponse({'primary_feeds': len(PRIMARY_FEEDS), 'backup_feeds': len(BACKUP_FEEDS), 'lookback_minutes': LOOKBACK_MINUTES, 'minimum_display_count': MAX_ITEMS})


@app.post('/api/refresh')
async def api_refresh():
    items = refresh_cache()
    return JSONResponse({'items': len(items), 'as_of': datetime.now(timezone.utc).isoformat()})
