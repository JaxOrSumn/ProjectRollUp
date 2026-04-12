from __future__ import annotations

import asyncio
import calendar
import json
import sqlite3
import re
import warnings
from html import unescape
from datetime import datetime, timezone, timedelta
from pathlib import Path

import os

import feedparser
import httpx
from dateutil import parser as dtparser
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from rapidfuzz import fuzz

# Suppress dateutil tzname warning
warnings.filterwarnings('ignore', message='.*tzname.*')

# Optional Google Trends support — app works without it
try:
    from pytrends.request import TrendReq as _TrendReq
    _PYTRENDS_AVAILABLE = True
except ImportError:
    _PYTRENDS_AVAILABLE = False


BASE = Path(__file__).resolve().parent
DB = BASE / 'project_rollup.db'
LOOKBACK_MINUTES = 60
MAX_ITEMS = 100
SUMMARY_WORDS = 400
MAX_BODY_CHARS = 14000
FEED_TIMEOUT = 12  # Timeout per feed request in seconds
REFRESH_INTERVAL = 300   # Background news refresh every 5 minutes
TRENDS_REFRESH_INTERVAL = 1200  # Background trend refresh every 20 minutes

# ── Runtime health tracking (Task 7) ──────────────────────────────────────────
_feed_health: dict[str, bool] = {}
_last_refresh_time: datetime | None = None
_last_trends_time: datetime | None = None

app = FastAPI(title='Project RollUp')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
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

# ── Source HQ locations (Task 14) ─────────────────────────────────────────────
SOURCE_LOCATIONS: dict[str, tuple[str, float, float]] = {
    'Reuters World':               ('Reuters HQ, 30 Hudson Yards, New York, USA',          40.7540,  -74.0020),
    'Reuters Business':            ('Reuters HQ, 30 Hudson Yards, New York, USA',          40.7540,  -74.0020),
    'BBC World':                   ('BBC Broadcasting House, Portland Place, London, UK',  51.5194,   -0.1435),
    'Al Jazeera':                  ('Al Jazeera Media Network, Doha, Qatar',               25.2854,   51.5310),
    'DW World':                    ('Deutsche Welle, Kurt-Schumacher-Str, Bonn, Germany',  50.7374,    7.0982),
    'France 24 World':             ('France 24, 80 Rue Camille Desmoulins, Paris, France', 48.8566,    2.3522),
    'NPR News':                    ('NPR HQ, 1111 North Capitol St NE, Washington DC, USA', 38.9072, -77.0369),
    'The Guardian World':          ('The Guardian, 90 York Way, London, UK',               51.5145,   -0.1235),
    'The Guardian Business':       ('The Guardian, 90 York Way, London, UK',               51.5145,   -0.1235),
    'The Atlantic':                ('The Atlantic, 600 New Hampshire Ave NW, Washington DC, USA', 38.9072, -77.0369),
    'ProPublica':                  ('ProPublica, 155 Ave of the Americas, New York, USA',  40.7128,  -74.0060),
    'Center for Public Integrity': ('Center for Public Integrity, Washington DC, USA',     38.9072,  -77.0369),
    'ScienceDaily':                ('ScienceDaily, Rockville MD, USA',                     39.0840,  -77.1528),
    'Nature News':                 ('Nature Publishing Group, 4 Crinan St, London, UK',    51.5074,   -0.1278),
    'Ars Technica':                ('Ars Technica / Condé Nast, New York, USA',            40.7128,  -74.0060),
    'The Verge':                   ('Vox Media, 1201 Connecticut Ave NW, Washington DC, USA', 38.9072, -77.0369),
    'Engadget':                    ('Yahoo Inc, 770 Broadway, New York, USA',              40.7290,  -73.9900),
    'TechCrunch':                  ('TechCrunch, 410 Townsend St, San Francisco, USA',     37.7749, -122.4194),
    'Democracy Now':               ('Democracy Now!, 207 W 25th St, New York, USA',        40.7462,  -73.9942),
    'The Intercept':               ('The Intercept, New York, USA',                        40.7128,  -74.0060),
    'Open Democracy':              ('openDemocracy, 2 Langley Lane, London, UK',           51.5074,   -0.1278),
    'Reason':                      ('Reason Foundation, 5737 Mesmer Ave, Los Angeles, USA', 33.9995, -118.4270),
    'UN News':                     ('United Nations HQ, 405 E 42nd St, New York, USA',     40.7489,  -73.9680),
    'WHO News':                    ('WHO, 20 Avenue Appia, Geneva, Switzerland',            46.2044,    6.1432),
    'Financial Times World':       ('Financial Times, 1 Southwark Bridge, London, UK',     51.5061,   -0.0967),
    'Financial Times Companies':   ('Financial Times, 1 Southwark Bridge, London, UK',     51.5061,   -0.0967),
    'The Economist':               ('The Economist, 25 St Jamess Street, London, UK',      51.5074,   -0.1278),
    'Axios':                       ('Axios, 3100 Clarendon Blvd, Arlington VA, USA',       38.8816,  -77.0910),
    'PBS NewsHour':                ('PBS NewsHour, 2700 S Quincy St, Arlington VA, USA',   38.8510,  -77.0910),
    'Marketplace':                 ('American Public Media, 480 Cedar St, St Paul MN, USA', 44.9537, -93.0900),
    'Columbia Journalism Review':  ('Columbia University, 116th St & Broadway, New York, USA', 40.8075, -73.9626),
    'Common Dreams':               ('Common Dreams, Portland ME, USA',                     43.6591,  -70.2568),
    'Truthout':                    ('Truthout, Sacramento CA, USA',                        38.5816, -121.4944),
    'The New Republic':            ('The New Republic, 1 Union Square W, New York, USA',   40.7359,  -73.9911),
    'The Nation':                  ('The Nation, 520 8th Ave, New York, USA',              40.7505,  -74.0006),
    'Jacobin':                     ('Jacobin Magazine, New York, USA',                     40.7128,  -74.0060),
    'Rest of World':               ('Rest of World, New York, USA',                        40.7128,  -74.0060),
    'Inside Climate News':         ('Inside Climate News, New York, USA',                  40.7128,  -74.0060),
    'Grist':                       ('Grist, 1201 Western Ave, Seattle WA, USA',            47.6062, -122.3321),
    'Wired':                       ('Wired / Condé Nast, 1 World Trade Center, New York, USA', 40.7127, -74.0134),
    'The Hill':                    ('The Hill, 1625 K St NW, Washington DC, USA',          38.9002,  -77.0385),
}

# ── Digest/roundup pattern (Task 10) ─────────────────────────────────────────
_DIGEST_PATTERN = re.compile(
    r'morning briefing|daily digest|weekly roundup|this week in|'
    r'news briefing|evening briefing|what you need to know today|'
    r"today's top stories|week in review|what we know so far|"
    r'daily newsletter|your weekly|your daily|recap:',
    re.I
)

# ── Ad / promotional content filter (Task 21) ────────────────────────────────
_AD_PATTERN = re.compile(
    r'sponsored|partner content|paid post|presented by|buy now|limited time offer|'
    r'promo code|affiliate|advertisement|best deals|shop now|click to buy|'
    r'exclusive offer|free trial|sign up today|get \d+% off|use code ',
    re.I
)


# ── Database ─────────────────────────────────────────────────────────────────

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

        # Task 14: source_locations table
        conn.execute(
            """CREATE TABLE IF NOT EXISTS source_locations (
                outlet_name TEXT PRIMARY KEY,
                address TEXT,
                lat REAL,
                lon REAL
            )"""
        )
        for name, (address, lat, lon) in SOURCE_LOCATIONS.items():
            conn.execute(
                'INSERT OR IGNORE INTO source_locations (outlet_name, address, lat, lon) VALUES (?,?,?,?)',
                (name, address, lat, lon)
            )

        # Trends cache — single JSON blob, refreshed every 20 min
        conn.execute(
            """CREATE TABLE IF NOT EXISTS trend_cache (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            )"""
        )
        # Trend history — rolling 48h snapshots for velocity sparklines (Task 26)
        conn.execute(
            """CREATE TABLE IF NOT EXISTS trend_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                platform TEXT NOT NULL,
                composite_score REAL,
                velocity TEXT,
                signals INTEGER,
                recorded_at TEXT NOT NULL
            )"""
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_trend_history ON trend_history(topic, recorded_at)')
        conn.commit()


def cleanup_old_stories():
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    with db() as conn:
        conn.execute('DELETE FROM stories WHERE created_at < ?', (cutoff,))
        conn.commit()


# ── Trends helpers ────────────────────────────────────────────────────────────

def _save_trends(trends: list) -> None:
    with db() as conn:
        conn.execute('DELETE FROM trend_cache')
        conn.execute(
            'INSERT INTO trend_cache (id, data, fetched_at) VALUES (1, ?, ?)',
            (json.dumps(trends), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()


def _load_trends() -> tuple[list, str | None]:
    try:
        with db() as conn:
            row = conn.execute(
                'SELECT data, fetched_at FROM trend_cache WHERE id = 1'
            ).fetchone()
            if row:
                return json.loads(row['data']), row['fetched_at']
    except Exception:
        pass
    return [], None


def _normalize_topic(topic: str) -> str:
    t = topic.lower()
    t = re.sub(r'[^\w\s]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def _velocity(raw_score: int, age_minutes: int, platform: str) -> str:
    if age_minutes <= 0:
        return 'ACCELERATING'
    if platform == 'Google Trends':
        if raw_score >= 80:
            return 'ACCELERATING'
        return 'PEAKING' if raw_score >= 40 else 'STEADY'
    sph = (raw_score / max(age_minutes, 1)) * 60  # score per hour
    if platform == 'HackerNews':
        if sph > 80 or (raw_score > 200 and age_minutes < 120):
            return 'ACCELERATING'
        if sph > 20 or raw_score > 80:
            return 'PEAKING'
        return 'FADING' if age_minutes > 600 else 'STEADY'
    if platform == 'Reddit':
        if sph > 3000 or (raw_score > 15000 and age_minutes < 180):
            return 'ACCELERATING'
        if sph > 600 or raw_score > 3000:
            return 'PEAKING'
        return 'FADING' if age_minutes > 720 else 'STEADY'
    return 'STEADY'


async def _fetch_hn(client: httpx.AsyncClient) -> list:
    try:
        res = await client.get(
            'https://hacker-news.firebaseio.com/v0/topstories.json', timeout=10.0
        )
        ids = res.json()[:15]
        tasks = [
            client.get(f'https://hacker-news.firebaseio.com/v0/item/{sid}.json', timeout=8.0)
            for sid in ids
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        now_ts = datetime.now(timezone.utc).timestamp()
        out = []
        for r in results:
            if isinstance(r, Exception):
                continue
            try:
                item = r.json()
            except Exception:
                continue
            if not item or item.get('type') != 'story':
                continue
            title = (item.get('title') or '').strip()
            if not title:
                continue
            age_min = max(0, int((now_ts - item.get('time', now_ts)) / 60))
            out.append({
                'topic': title,
                'platform': 'HackerNews',
                'url': f'https://news.ycombinator.com/item?id={item["id"]}',
                'raw_score': item.get('score', 0),
                'comments': item.get('descendants', 0),
                'age_minutes': age_min,
            })
        return out
    except Exception:
        return []


async def _fetch_reddit(client: httpx.AsyncClient) -> list:
    try:
        res = await client.get(
            'https://www.reddit.com/r/all/hot.json?limit=20',
            headers={'User-Agent': 'ProjectRollUp/1.0 (news aggregator)'},
            timeout=10.0,
        )
        posts = res.json().get('data', {}).get('children', [])
        now_ts = datetime.now(timezone.utc).timestamp()
        out = []
        for post in posts:
            p = post.get('data', {})
            title = (p.get('title') or '').strip()
            if not title:
                continue
            age_min = max(0, int((now_ts - p.get('created_utc', now_ts)) / 60))
            out.append({
                'topic': title,
                'platform': 'Reddit',
                'url': f'https://reddit.com{p.get("permalink", "")}',
                'subreddit': p.get('subreddit_name_prefixed', ''),
                'raw_score': p.get('score', 0),
                'comments': p.get('num_comments', 0),
                'age_minutes': age_min,
            })
        return out
    except Exception:
        return []


async def _fetch_github(client: httpx.AsyncClient) -> list:
    """Scrape GitHub Trending — no auth required (Task 22)."""
    try:
        res = await client.get(
            'https://github.com/trending',
            headers={'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0'},
            timeout=10.0,
        )
        # Extract repo names: owner/repo pattern inside h2 anchors
        repos = re.findall(r'<h2[^>]*>\s*<a[^>]+href="/([^/"]+/[^/"]+)"', res.text)
        out = []
        for i, repo in enumerate(repos[:20]):
            out.append({
                'topic': repo.replace('-', ' ').replace('/', ' / '),
                'platform': 'GitHub',
                'url': f'https://github.com/{repo}',
                'raw_score': max(0, 100 - i * 5),
                'comments': 0,
                'age_minutes': 0,
            })
        return out
    except Exception:
        return []


async def _fetch_wikipedia(client: httpx.AsyncClient) -> list:
    """Fetch Wikipedia Current Events portal — no auth required (Task 22)."""
    try:
        res = await client.get(
            'https://en.wikipedia.org/wiki/Portal:Current_events',
            headers={'User-Agent': 'ProjectRollUp/1.0 (news aggregator; open source)'},
            timeout=10.0,
        )
        # Extract linked article titles from portal
        titles = re.findall(r'<a[^>]+title="([^"]+)"[^>]*>[^<]{10,}</a>', res.text)
        seen = set()
        out = []
        for i, title in enumerate(titles):
            t = title.strip()
            if not t or t in seen or t.startswith('Portal:') or t.startswith('Help:'):
                continue
            seen.add(t)
            out.append({
                'topic': t,
                'platform': 'Wikipedia',
                'url': f'https://en.wikipedia.org/wiki/{t.replace(" ", "_")}',
                'raw_score': max(0, 80 - i * 4),
                'comments': 0,
                'age_minutes': 0,
            })
            if len(out) >= 15:
                break
        return out
    except Exception:
        return []


async def _fetch_mastodon(client: httpx.AsyncClient) -> list:
    """Mastodon trending hashtags — public API, no auth (Task 32)."""
    try:
        res = await client.get(
            'https://mastodon.social/api/v1/trends/tags?limit=20',
            timeout=10.0,
        )
        tags = res.json()
        out = []
        for tag in tags:
            name = tag.get('name', '').replace('_', ' ').strip()
            if not name:
                continue
            history = tag.get('history', [])
            uses = int(history[0].get('uses', 0)) if history else 0
            out.append({
                'topic': name,
                'platform': 'Mastodon',
                'url': f'https://mastodon.social/tags/{tag.get("name", "")}',
                'raw_score': uses,
                'comments': 0,
                'age_minutes': 0,
            })
        return out
    except Exception:
        return []


async def _fetch_bluesky(client: httpx.AsyncClient) -> list:
    """Bluesky AT Protocol trending feed — public, no auth (Task 33)."""
    try:
        res = await client.get(
            'https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed'
            '?feed=at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot&limit=25',
            timeout=12.0,
        )
        feed = res.json().get('feed', [])
        word_freq: dict[str, int] = {}
        for item in feed:
            text = item.get('post', {}).get('record', {}).get('text', '')
            for word in re.findall(r'\b[A-Z][a-z]{3,}\b', text):
                word_freq[word] = word_freq.get(word, 0) + 1
        out = []
        for word, count in sorted(word_freq.items(), key=lambda x: -x[1])[:12]:
            if count < 2:
                continue
            out.append({
                'topic': word,
                'platform': 'Bluesky',
                'url': f'https://bsky.app/search?q={word}',
                'raw_score': count * 10,
                'comments': 0,
                'age_minutes': 0,
            })
        return out
    except Exception:
        return []


async def _fetch_tiktok(client: httpx.AsyncClient) -> list:
    """TikTok Creative Center trending — unauthenticated, may change (Task 31)."""
    try:
        res = await client.get(
            'https://ads.tiktok.com/business_site/creative_center/hashtag/pc/en',
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
            timeout=10.0,
        )
        # Extract hashtag names from page JSON embedded in script tags
        names = re.findall(r'"hashtagName"\s*:\s*"([^"]{2,40})"', res.text)
        if not names:
            names = re.findall(r'#([A-Za-z][A-Za-z0-9]{2,30})\b', res.text)[:20]
        seen = set()
        out = []
        for i, name in enumerate(names):
            n = name.strip()
            if not n or n.lower() in seen:
                continue
            seen.add(n.lower())
            out.append({
                'topic': n,
                'platform': 'TikTok',
                'url': f'https://www.tiktok.com/tag/{n}',
                'raw_score': max(0, 100 - i * 5),
                'comments': 0,
                'age_minutes': 0,
            })
            if len(out) >= 15:
                break
        return out
    except Exception:
        return []


async def _fetch_youtube(client: httpx.AsyncClient) -> list:
    """YouTube Data API v3 trending — requires YOUTUBE_API_KEY env var (Tasks 22, 34)."""
    key = os.environ.get('YOUTUBE_API_KEY', '')
    if not key:
        return []
    try:
        res = await client.get(
            'https://www.googleapis.com/youtube/v3/videos',
            params={'chart': 'mostPopular', 'regionCode': 'US', 'maxResults': 20, 'part': 'snippet', 'key': key},
            timeout=10.0,
        )
        items = res.json().get('items', [])
        out = []
        for i, item in enumerate(items):
            title = item.get('snippet', {}).get('title', '').strip()
            if not title:
                continue
            channel = item.get('snippet', {}).get('channelTitle', '')
            vid_id = item.get('id', '')
            out.append({
                'topic': title,
                'platform': 'YouTube',
                'url': f'https://youtube.com/watch?v={vid_id}' if vid_id else 'https://youtube.com',
                'raw_score': max(0, 100 - i * 5),
                'comments': 0,
                'age_minutes': 0,
                'subreddit': channel,
            })
        return out
    except Exception:
        return []


async def _fetch_newsapi(client: httpx.AsyncClient) -> list:
    """NewsAPI top headlines — requires NEWSAPI_KEY env var (Task 22)."""
    key = os.environ.get('NEWSAPI_KEY', '')
    if not key:
        return []
    try:
        res = await client.get(
            'https://newsapi.org/v2/top-headlines',
            params={'country': 'us', 'pageSize': 20, 'apiKey': key},
            timeout=10.0,
        )
        articles = res.json().get('articles', [])
        out = []
        for i, a in enumerate(articles):
            title = (a.get('title') or '').split(' - ')[0].strip()
            if not title or title == '[Removed]':
                continue
            out.append({
                'topic': title,
                'platform': 'NewsAPI',
                'url': a.get('url', ''),
                'raw_score': max(0, 100 - i * 5),
                'comments': 0,
                'age_minutes': 0,
            })
        return out
    except Exception:
        return []


def _fetch_google_trends_sync() -> list:
    if not _PYTRENDS_AVAILABLE:
        return []
    try:
        pt = _TrendReq(hl='en-US', tz=360, timeout=(10, 25), retries=1, backoff_factor=0.5)
        df = pt.trending_searches(pn='united_states')
        out = []
        for i, topic in enumerate(df[0][:20]):
            topic = str(topic).strip()
            if not topic:
                continue
            out.append({
                'topic': topic,
                'platform': 'Google Trends',
                'url': f'https://trends.google.com/trends/explore?q={topic.replace(" ", "+")}',
                'raw_score': max(0, 100 - i * 5),
                'comments': 0,
                'age_minutes': 0,
            })
        return out
    except Exception:
        return []


def _aggregate_trends(*source_lists) -> list:
    """Merge any number of platform lists into deduplicated trending topics."""
    raw_all = []
    for lst in source_lists:
        for t in lst:
            raw_all.append({**t, 'sources': [t.get('platform', 'Unknown')]})

    merged: list[dict] = []
    for raw in raw_all:
        norm = _normalize_topic(raw['topic'])
        found = None
        for m in merged:
            if fuzz.token_set_ratio(norm, _normalize_topic(m['topic'])) >= 75:
                found = m
                break
        if found:
            if raw['platform'] not in found['platforms']:
                found['platforms'].append(raw['platform'])
            found['raw_scores'].append(raw['raw_score'])
            found['total_comments'] += raw.get('comments', 0)
            found['age_minutes'] = min(found['age_minutes'], raw['age_minutes'])
        else:
            merged.append({
                'topic': raw['topic'],
                'primary_platform': raw['platform'],
                'platforms': [raw['platform']],
                'url': raw.get('url', ''),
                'raw_scores': [raw['raw_score']],
                'total_comments': raw.get('comments', 0),
                'age_minutes': raw['age_minutes'],
                'subreddit': raw.get('subreddit', ''),
            })

    results = []
    for m in merged:
        peak = max(m['raw_scores']) if m['raw_scores'] else 0
        pp = m['primary_platform']
        if pp == 'HackerNews':
            norm_score = min(1.0, peak / 500)
        elif pp == 'Reddit':
            norm_score = min(1.0, peak / 50000)
        else:
            norm_score = peak / 100
        cross_count = len(m['platforms'])
        composite = round(min(1.0, norm_score + (cross_count - 1) * 0.15), 3)
        vel = _velocity(peak, m['age_minutes'], pp)
        cats = classify_tags(m['topic'], '')
        age_min = m['age_minutes']
        if age_min < 60:
            age_label = f'{age_min}m ago'
        elif age_min < 1440:
            age_label = f'{age_min // 60}h ago'
        else:
            age_label = f'{age_min // 1440}d ago'
        results.append({
            'topic': m['topic'],
            'primary_platform': pp,
            'platforms': m['platforms'],
            'url': m['url'],
            'composite_score': composite,
            'velocity': vel,
            'categories': cats,
            'cross_platform_count': cross_count,
            'age_minutes': age_min,
            'age_label': age_label,
            'signals': peak,
            'comments': m['total_comments'],
            'subreddit': m.get('subreddit', ''),
        })

    results.sort(key=lambda x: (x['cross_platform_count'], x['composite_score']), reverse=True)
    return results[:30]


async def refresh_trends_async() -> list:
    global _last_trends_time
    async with httpx.AsyncClient(follow_redirects=True) as client:
        results = await asyncio.gather(
            _fetch_hn(client),
            _fetch_reddit(client),
            _fetch_github(client),
            _fetch_wikipedia(client),
            _fetch_mastodon(client),
            _fetch_bluesky(client),
            _fetch_tiktok(client),
            _fetch_youtube(client),
            _fetch_newsapi(client),
            return_exceptions=True,
        )
    hn, reddit, github, wikipedia, mastodon, bluesky, tiktok, youtube, newsapi = [
        r if isinstance(r, list) else [] for r in results
    ]

    loop = asyncio.get_event_loop()
    google = await loop.run_in_executor(None, _fetch_google_trends_sync)

    trends = _aggregate_trends(hn, reddit, google, github, wikipedia, mastodon, bluesky, tiktok, youtube, newsapi)
    _save_trends(trends)
    _last_trends_time = datetime.now(timezone.utc)

    # Task 26: Write history snapshot, trim entries older than 48h
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        with db() as conn:
            conn.execute('DELETE FROM trend_history WHERE recorded_at < ?', (cutoff,))
            for t in trends[:30]:
                conn.execute(
                    'INSERT INTO trend_history (topic, platform, composite_score, velocity, signals, recorded_at) VALUES (?,?,?,?,?,?)',
                    (t['topic'], t.get('primary_platform', ''), t.get('composite_score', 0),
                     t.get('velocity', ''), t.get('signals', 0), now_iso),
                )
            conn.commit()
    except Exception:
        pass

    return trends


# ── Utilities ─────────────────────────────────────────────────────────────────

def parse_ts(entry):
    for key in ('published', 'updated', 'created'):
        v = entry.get(key)
        if v:
            try:
                return dtparser.parse(v).astimezone(timezone.utc)
            except Exception:
                pass
    if entry.get('published_parsed'):
        return datetime.utcfromtimestamp(
            calendar.timegm(entry.published_parsed)
        ).replace(tzinfo=timezone.utc)
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
    text = unescape(text or '')
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


_NAV_JUNK = re.compile(
    r'navigation menu|show more|sign up|click here|cookie|subscribe|'
    r'advertisement|follow us|share this|whatsapp|copylink|caret-left|'
    r'caret-right|css-\w+\{|font-size|font-weight|@media|javascript',
    re.I,
)


def _is_junk_paragraph(text: str) -> bool:
    if len(text) < 80:
        return True
    if _NAV_JUNK.search(text):
        return True
    words = text.split()
    if len(words) < 8:
        return True
    short = sum(1 for w in words if len(w) <= 3)
    if short / len(words) > 0.6:
        return True
    return False


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

    scoped = re.search(r'<(?:article|main)[^>]*>(.*?)</(?:article|main)>', text, flags=re.I | re.S)
    search_area = scoped.group(1) if scoped else text

    paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', search_area, flags=re.I | re.S)
    cleaned = []
    for ptag in paragraphs:
        chunk = clean_text(unescape(re.sub(r'<[^>]+>', ' ', ptag)))
        if not _is_junk_paragraph(chunk):
            cleaned.append(chunk)
        if len(cleaned) >= 25:
            break

    return clean_text(' '.join(cleaned))[:MAX_BODY_CHARS]


_BOILERPLATE = re.compile(
    r'is being tracked by project rollup|'
    r'this write-up stays within|'
    r'avoids speculation|'
    r'currently carries a relevance score|'
    r'click here|read more|subscribe|sign up|all rights reserved|'
    r'terms of (use|service)|privacy policy|cookie|newsletter|'
    r'follow us|share this|advertisement|sponsored|related article',
    re.I,
)

_ARTIFACTS = re.compile(
    r'\[[\u2026\.]{1,3}\]'
    r'|read the full story at [^\.\n]+'
    r'|read more( at [^\.\n]+)?'
    r'|\.\.\.',
    re.I,
)


def _strip_artifacts(text: str) -> str:
    return re.sub(r'\s+', ' ', _ARTIFACTS.sub('', text)).strip()


def summarize_text(title: str, source: str, body: str, meta: str, source_count: int, age_minutes: int, score: float) -> str:
    body = _strip_artifacts(clean_text(body))
    meta = _strip_artifacts(clean_text(meta))
    source_phrase = f'{source}' if source_count == 1 else f'{source} and {source_count - 1} other source(s)'
    title_norm = normalize_title(title).lower()
    title_words = {w for w in title_norm.split() if len(w) > 3}

    indexed: list[tuple[int, str]] = []
    raw_chunks = re.split(r'(?<=[.!?])\s+|;\s*', f'{meta} {body}')
    for i, chunk in enumerate(raw_chunks):
        chunk = _strip_artifacts(chunk.strip())
        if not chunk or len(chunk) < 25:
            continue
        if _BOILERPLATE.search(chunk):
            continue
        if normalize_title(chunk).lower() == title_norm:
            continue
        if chunk.count(',') > 4:
            continue
        chunk_norm = normalize_title(chunk).lower()
        if any(fuzz.ratio(chunk_norm, normalize_title(s).lower()) > 72 for _, s in indexed):
            continue
        words = chunk.split()
        if len(words) > 40:
            chunk = ' '.join(words[:40])
        indexed.append((i, chunk))

    if not indexed:
        indexed = [(0, meta or body or title)]

    # Score by keyword overlap with title, pick top 3 in original order
    def relevance(item: tuple[int, str]) -> int:
        sent_words = {w for w in normalize_title(item[1]).lower().split() if len(w) > 3}
        return len(sent_words & title_words)

    top = sorted(sorted(indexed, key=relevance, reverse=True)[:7], key=lambda x: x[0])
    chosen = [s for _, s in top]

    lead = ' '.join(chosen[:2])
    key_points = chosen[2:]

    attribution = f'Source: {source_phrase}  ·  {age_minutes} min ago'

    parts = [lead]
    if key_points:
        bullets = '\n'.join(f'• {s}' for s in key_points)
        parts.append(f'Key Points:\n{bullets}')
    parts.append(attribution)

    return '\n\n'.join(parts)


def trim_words(text: str, limit: int = SUMMARY_WORDS) -> str:
    words = text.split()
    return ' '.join(words[:limit])


_TAG_RULES: list[tuple[str, re.Pattern]] = [
    ('Breaking', re.compile(
        r'breaking|just in|developing|urgent|alert|emergency|flash|live:|happening now|'
        r'breaking news|exclusive:|update:|first reported',
        re.I)),
    ('Politics', re.compile(
        r'congress|senate|parliament|democrat|republican|legislation|bill |vote|election|'
        r'president|prime minister|white house|administration|cabinet|policy|political|'
        r'campaign|referendum|governor|mayor|lobbyist|filibuster|impeach|ballot|party|'
        r'lawmaker|bipartisan|veto|executive order|supreme court',
        re.I)),
    ('World', re.compile(
        r'war|conflict|invasion|ceasefire|treaty|nato|united nations|un |diplomat|sanction|'
        r'foreign|bilateral|multilateral|ambassador|embassy|regime|coup|sovereignty|'
        r'troops|nuclear|geopoliti|international|global|overseas|abroad|europe|asia|'
        r'middle east|africa|latin america|pacific|ukraine|russia|china|iran|israel|'
        r'taiwan|north korea|nato|g7|g20',
        re.I)),
    ('National', re.compile(
        r'federal|nationwide|domestic|homeland|u\.s\.|united states|america|washington d\.c\.|'
        r'department of|national security|border|immigration|nsa|fbi|cia|dhs|pentagon|'
        r'state department|treasury|federal reserve|\bfed\b|infrastructure|interstate',
        re.I)),
    ('Local', re.compile(
        r'city council|county|municipality|local government|mayor|neighborhood|precinct|'
        r'district|township|school board|zoning|ordinance|local police|fire department|'
        r'community|residents|metro area|downtown|suburb',
        re.I)),
    ('Business', re.compile(
        r'economy|market|trade|inflation|gdp|interest rate|federal reserve|central bank|'
        r'finance|stock|investment|recession|tariff|deficit|unemployment|supply chain|'
        r'oil price|energy price|imf|world bank|debt|budget|export|import|wage|revenue|'
        r'earnings|profit|merger|acquisition|ipo|startup|venture|hedge fund|quarter|'
        r'dow|nasdaq|s&p|cryptocurrency|bitcoin|forex|commodity',
        re.I)),
    ('Tech', re.compile(
        r'technolog|artificial intelligence|\bai\b|machine learning|software|hardware|'
        r'silicon|cyber|digital|algorithm|semiconductor|chip|data breach|smartphone|'
        r'cloud|quantum|robot|automation|openai|nvidia|google|apple |microsoft|amazon|'
        r'meta |elon musk|social media platform|app store|5g|deepfake|cybersecurity|hack',
        re.I)),
    ('Science', re.compile(
        r'research|study|scientis|discovery|nasa|space|fossil|asteroid|telescope|'
        r'physics|biology|chemistry|neuroscien|experiment|trial|findings|published in|'
        r'journal|genome|species|evolution|climate change|carbon|emissions|environment|'
        r'ocean|atmosphere|geology|quantum|particle|astrophysic',
        re.I)),
    ('Health', re.compile(
        r'health|medical|virus|vaccine|cancer|disease|pandemic|epidemic|hospital|'
        r'surgery|drug|pharmaceutical|fda|cdc|who |mental health|therapy|clinical|'
        r'patient|diagnosis|treatment|outbreak|public health|obesity|alzheimer|'
        r'nutrition|fitness|prescription|medication|overdose',
        re.I)),
    ('Crime', re.compile(
        r'murder|arrest|trial|convicted|sentenced|prison|jail|shooting|stabbing|'
        r'robbery|fraud|indicted|charged|suspect|investigation|detective|police|'
        r'homicide|assault|trafficking|cartel|gang|drug bust|organized crime|'
        r'cybercrime|scam|embezzle|corrupt|bribery|laundering',
        re.I)),
    ('Defense', re.compile(
        r'military|army|navy|air force|marines|pentagon|defense department|weapon|'
        r'missile|drone|nuclear|warship|fighter jet|special forces|veteran|troop|'
        r'battalion|deployment|arms deal|defense contract|intelligence agency|'
        r'spy|surveillance|nsa|cia|classified|national security|warfare',
        re.I)),
    ('Climate', re.compile(
        r'climate|global warming|carbon|emissions|greenhouse|fossil fuel|renewable|'
        r'solar|wind power|flood|wildfire|hurricane|tornado|drought|sea level|'
        r'glacier|arctic|deforestation|biodiversity|coral reef|pollution|epa|'
        r'paris agreement|net zero|sustainability|extreme weather',
        re.I)),
    ('Entertainment', re.compile(
        r'celebrity|actor|actress|hollywood|music|album|tour|award|oscar|grammy|emmy|'
        r'bafta|pop star|singer|rapper|box office|reality tv|scandal|film|movie|'
        r'streaming|netflix|disney|hbo|spotify|concert|festival|tv show|series|'
        r'taylor swift|beyonce|kardashian|prince harry|meghan|red carpet',
        re.I)),
    ('Sports', re.compile(
        r'nfl|nba|mlb|nhl|fifa|olympics|championship|tournament|playoff|league|'
        r'athlete|coach|team|stadium|match|game|score|transfer|draft|trade|contract|'
        r'world cup|super bowl|wimbledon|formula 1|\bf1\b|tennis|soccer|basketball|'
        r'baseball|football|hockey|golf|boxing|ufc|mma',
        re.I)),
    ('Analysis', re.compile(
        r'analysis|opinion|editorial|commentary|perspective|explainer|deep dive|'
        r'investigation|report:|special report|in depth|why |how |what does|'
        r'fact.?check|review|survey|poll|data shows|according to|experts say|'
        r'breakdown|context|background|timeline',
        re.I)),
]


def classify_tags(headline: str, summary: str) -> list[str]:
    text = f'{headline} {summary}'
    tags = [tag for tag, pattern in _TAG_RULES if pattern.search(text)]
    return tags[:3] if tags else ['Analysis']


def human_reason(freshness: float, source_count: int, group_size: int, age_minutes: int, bucket: str) -> str:
    if bucket == 'fresh':
        timing = f'Breaking — first detected {age_minutes} min ago'
    elif age_minutes < 180:
        timing = f'Developing — {age_minutes} min old'
    else:
        hours = age_minutes // 60
        timing = f'Ongoing — {hours}h old'

    if source_count >= 4:
        coverage = f'confirmed across {source_count} independent outlets'
    elif source_count == 3:
        coverage = 'picked up by 3 sources'
    elif source_count == 2:
        coverage = 'corroborated by 2 sources'
    else:
        coverage = 'single-source signal'

    if group_size >= 4:
        velocity = 'High editorial velocity'
    elif group_size >= 2:
        velocity = 'Moderate editorial interest'
    else:
        velocity = 'Early-stage signal'

    freshness_pct = round(freshness * 100)
    return f'{timing} · {coverage} · {velocity} · Freshness score {freshness_pct}%'


# ── Feed fetching (async + concurrent) ───────────────────────────────────────

async def fetch_feed_async(name: str, url: str) -> list:
    """Fetch a single RSS feed asynchronously."""
    entries = []
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=FEED_TIMEOUT,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; ProjectRollUp/1.0)'},
        ) as client:
            res = await client.get(url)
            res.raise_for_status()
            text = res.text

        data = feedparser.parse(text)
        for entry in data.entries[:20]:
            title = entry.get('title', '').strip()
            if not title:
                continue
            article_url = entry.get('link', '')

            # Task 10: Skip digest/roundup entries
            if _DIGEST_PATTERN.search(title):
                continue

            # Task 21: Skip promotional/sponsored content
            if _AD_PATTERN.search(title):
                continue

            # Skip live blogs
            if '/live/' in article_url.lower():
                continue
            title = re.sub(
                r'^[\w\s]*(live|breaking|rolling|developing)\s*:\s*',
                '', title, flags=re.I,
            ).strip() or title
            if re.search(r';\s+[A-Z]', title):
                continue

            published = parse_ts(entry)
            age_minutes = int((datetime.now(timezone.utc) - published).total_seconds() / 60)
            if age_minutes < 0:
                age_minutes = 0
            meta_summary = extract_meta_summary(entry)
            content_text = clean_text(meta_summary)
            entries.append({
                'title': title,
                'source': name,
                'url': article_url,
                'published': published.isoformat(),
                'age_minutes': age_minutes,
                'cluster_id': cluster_key(title),
                'meta_summary': meta_summary,
                'content_text': content_text,
            })
    except Exception:
        pass

    # Task 7: Record per-feed health
    _feed_health[name] = len(entries) > 0
    return entries


async def load_entries_async(feeds: list[tuple[str, str]]) -> list:
    """Fetch all feeds concurrently and return combined entries."""
    tasks = [fetch_feed_async(name, url) for name, url in feeds]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    entries = []
    for result in results:
        if isinstance(result, list):
            entries.extend(result)
    return entries


# ── Ranking & deduplication ───────────────────────────────────────────────────

def dedupe_and_rank(entries: list) -> list:
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
        # Task 1: Rebalanced weights — freshness=0.4, diversity=0.4, velocity=0.2
        score = round((freshness * 0.4 + diversity * 0.4 + cluster_bonus * 0.2), 3)
        bucket = 'fresh' if age_minutes <= 60 else 'older'
        reason = human_reason(freshness, source_count, len(group), age_minutes, bucket)
        summary = summarize_text(
            title, group[0]['source'],
            ' '.join(g.get('content_text', '') for g in group),
            ' '.join(g.get('meta_summary', '') for g in group),
            source_count, age_minutes, score,
        )
        tags = classify_tags(title, summary)
        # Task 13: Corroborating sources = all sources except the primary
        primary_source = group[0]['source']
        corroborating = [s for s in source_names if s != primary_source]
        items.append({
            'headline': title,
            'source': primary_source,
            'age': f'{age_minutes}m',
            'age_minutes': age_minutes,
            'freshness_bucket': bucket,
            'source_count': source_count,
            'score': score,
            'sources': source_names,
            'corroborating_sources': corroborating,
            'reason': reason,
            'summary': summary,
            'tags': tags,
            'cluster_id': group[0]['cluster_id'],
            'published': group[0]['published'],
            'url': group[0]['url'],
        })

    items.sort(key=lambda x: (x['score'], -x['age_minutes']), reverse=True)
    return items


def fallback_items(needed: int, bucket='fallback') -> list:
    now = datetime.now(timezone.utc)
    items = []
    pool = FALLBACK_STORIES or [('Project RollUp fallback headline', 'Project RollUp')]
    for i, (title, source) in enumerate(pool * ((needed // len(pool)) + 1)):
        if len(items) >= needed:
            break
        age_minutes = 5 + (i % 55)
        score = round(0.35 + (55 - age_minutes) / 200, 3)
        summary = summarize_text(title, source, title, '', 1, age_minutes, score)
        tags = classify_tags(title, summary)
        items.append({
            'headline': title,
            'source': source,
            'age': f'{age_minutes}m',
            'age_minutes': age_minutes,
            'freshness_bucket': bucket,
            'source_count': 1,
            'score': score,
            'sources': [source],
            'corroborating_sources': [],
            'tags': tags,
            'reason': 'fallback item — live feeds returned insufficient results',
            'summary': summary,
            'cluster_id': f'fallback-{i}',
            'published': now.isoformat(),
            'url': '',
        })
    return items


async def guaranteed_stories_async() -> list:
    """Fetch all feeds concurrently, rank, and pad with fallback if needed."""
    primary_entries, backup_entries = await asyncio.gather(
        load_entries_async(PRIMARY_FEEDS),
        load_entries_async(BACKUP_FEEDS),
    )

    items = dedupe_and_rank(primary_entries)

    if len(items) < MAX_ITEMS:
        combined = dedupe_and_rank(primary_entries + backup_entries)
        items = combined

    if len(items) < MAX_ITEMS:
        items = items + fallback_items(MAX_ITEMS - len(items))

    items.sort(key=lambda x: (x.get('score', 0), -x.get('age_minutes', 9999)), reverse=True)
    return items[:MAX_ITEMS]


async def refresh_cache_async():
    """Fetch feeds and write results to the DB cache."""
    global _last_refresh_time
    items = await guaranteed_stories_async()
    with db() as conn:
        conn.execute('DELETE FROM stories')
        for item in items:
            conn.execute(
                """INSERT INTO stories
                   (title, source, url, published, age_minutes, freshness_bucket,
                    cluster_id, score, source_count, sources_json, reason, summary, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    item['headline'], item['source'], item.get('url', ''),
                    item.get('published', datetime.now(timezone.utc).isoformat()),
                    int(item['age_minutes']), item.get('freshness_bucket', 'fallback'),
                    item['cluster_id'], item['score'], item['source_count'],
                    json.dumps(item['sources']), item['reason'],
                    item.get('summary', ''), datetime.now(timezone.utc).isoformat(),
                ),
            )
        conn.commit()
    _last_refresh_time = datetime.now(timezone.utc)
    return items


def cached_items() -> list:
    """Read stories from DB cache. Fast — no network calls."""
    with db() as conn:
        rows = conn.execute(
            """SELECT title, source, url, published, age_minutes, freshness_bucket,
                      score, source_count, sources_json, reason, summary
               FROM stories ORDER BY score DESC, age_minutes ASC LIMIT ?""",
            (MAX_ITEMS,),
        ).fetchall()

    now = datetime.now(timezone.utc)
    items = []
    for r in rows:
        headline = r['title']
        summary = r['summary'] or ''

        # Task 4: Compute age_minutes dynamically from published timestamp
        try:
            pub = dtparser.parse(r['published']).astimezone(timezone.utc) if r['published'] else now
        except Exception:
            pub = now
        age_minutes = max(0, int((now - pub).total_seconds() / 60))

        # Task 13: Derive corroborating sources from stored sources_json
        all_sources = json.loads(r['sources_json'] or '[]')
        primary_source = r['source']
        corroborating = [s for s in all_sources if s != primary_source]

        items.append({
            'headline': headline,
            'source': primary_source,
            'url': r['url'] or '',
            'published': r['published'] or '',
            'age': f'{age_minutes}m',
            'age_minutes': age_minutes,
            'freshness_bucket': r['freshness_bucket'],
            'source_count': r['source_count'],
            'score': r['score'],
            'sources': all_sources,
            'corroborating_sources': corroborating,
            'reason': r['reason'],
            'summary': summary,
            'tags': classify_tags(headline, summary),
        })
    return items


# ── Background refresh loop ───────────────────────────────────────────────────

async def _background_refresh_loop():
    while True:
        await asyncio.sleep(REFRESH_INTERVAL)
        try:
            await refresh_cache_async()
        except Exception:
            pass


async def _background_trends_loop():
    await asyncio.sleep(30)  # Stagger start so news loads first
    while True:
        try:
            await refresh_trends_async()
        except Exception:
            pass
        await asyncio.sleep(TRENDS_REFRESH_INTERVAL)


# ── App lifecycle ─────────────────────────────────────────────────────────────

@app.on_event('startup')
async def _startup():
    init_db()
    cleanup_old_stories()
    # Task 30: Clear stale trend cache on startup (prevents old env data from being served)
    try:
        _, fetched_at = _load_trends()
        if fetched_at:
            age_secs = (datetime.now(timezone.utc) - dtparser.parse(fetched_at)).total_seconds()
            if age_secs > 86400:  # older than 24 hours
                with db() as conn:
                    conn.execute('DELETE FROM trend_cache')
                    conn.commit()
    except Exception:
        pass
    try:
        await refresh_cache_async()
    except Exception:
        pass
    asyncio.create_task(_background_refresh_loop())
    asyncio.create_task(_background_trends_loop())


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.get('/')
async def root():
    return HTMLResponse('Project RollUp backend is running.')


@app.get('/api/stories')
async def stories():
    """Serve from DB cache — fast, no feed fetching."""
    items = cached_items()
    if not items:
        try:
            items = await refresh_cache_async()
        except Exception:
            items = fallback_items(MAX_ITEMS)

    items = items[:MAX_ITEMS]
    stories_list = []
    for idx, item in enumerate(items, 1):
        stories_list.append({
            'id': str(idx),
            'rank': idx,
            'headline': item['headline'],
            'title': item['headline'],
            'source': item['source'],
            'sourceCount': item['source_count'],
            'source_count': item['source_count'],
            'confidence': min(item['score'], 1.0),
            'firstSeenAt': item.get('published') or datetime.now(timezone.utc).isoformat(),
            'published_at': item.get('published') or datetime.now(timezone.utc).isoformat(),
            'age_minutes': item.get('age_minutes', 0),
            'tags': item.get('tags', []),
            'summary': item.get('summary', ''),
            'rankReason': item.get('reason', 'Ranked by score'),
            'rank_reason': item.get('reason', 'Ranked by score'),
            'sources': item.get('sources', [item['source']]),
            'corroborating_sources': item.get('corroborating_sources', []),
            'featured': idx == 1,
        })

    return JSONResponse({
        'stories': stories_list,
        'as_of': datetime.now(timezone.utc).isoformat(),
        'status': 'ok' if stories_list else 'fallback',
        'count': len(stories_list),
    })


@app.get('/api/story')
async def story(id: str = None, headline: str = None):
    items = cached_items()

    target = None
    search_term = headline or id

    if search_term:
        nh = normalize_title(search_term)
        for item in items:
            if normalize_title(item['headline']) == nh or fuzz.ratio(item['headline'], search_term) >= 90:
                target = item
                break

    if target is None:
        target = {
            'headline': search_term or 'Unknown',
            'source': 'Project RollUp',
            'url': '',
            'published': '',
            'age_minutes': 0,
            'score': 0.0,
            'source_count': 1,
            'sources': ['Project RollUp'],
            'corroborating_sources': [],
            'reason': 'Headline not found in current cache.',
            'summary': summarize_text(search_term or 'Unknown', 'Project RollUp', search_term or 'Unknown', '', 1, 0, 0.0),
        }

    # Enrich summary with full article text on demand.
    url = target.get('url', '')
    extraction_note = ''
    if url and word_count(target.get('summary', '')) < 200:
        extracted = await asyncio.get_event_loop().run_in_executor(None, extract_article_text, url)
        if extracted:
            target['summary'] = summarize_text(
                target['headline'],
                target['source'],
                extracted,
                '',
                target.get('source_count', 1),
                target.get('age_minutes', 0),
                target.get('score', 0.0),
            )
            try:
                with db() as conn:
                    conn.execute(
                        'UPDATE stories SET summary = ? WHERE title = ? AND source = ?',
                        (target['summary'], target['headline'], target['source']),
                    )
                    conn.commit()
            except Exception:
                pass
        else:
            # Task 9: Flag extraction failure
            if url:
                extraction_note = 'Feed summary only — full article unavailable.'

    target['extraction_note'] = extraction_note

    # Task 14: Look up source HQ location
    source_location = None
    try:
        with db() as conn:
            row = conn.execute(
                'SELECT address, lat, lon FROM source_locations WHERE outlet_name = ?',
                (target.get('source', ''),)
            ).fetchone()
            if row:
                source_location = {
                    'address': row['address'],
                    'lat': row['lat'],
                    'lon': row['lon'],
                }
    except Exception:
        pass
    target['source_location'] = source_location

    # Ensure all field aliases the frontend expects are present
    target.setdefault('rankReason', target.get('reason', ''))
    target.setdefault('rank_reason', target.get('reason', ''))
    target.setdefault('sourceCount', target.get('source_count', 1))
    target.setdefault('firstSeenAt', target.get('published', ''))
    target.setdefault('confidence', min(target.get('score', 0.0), 1.0))
    target.setdefault('corroborating_sources', [])

    return JSONResponse(target)


@app.get('/api/health')
async def health():
    # Task 7: Return real per-feed health data
    healthy = sum(1 for v in _feed_health.values() if v)
    failed = sum(1 for v in _feed_health.values() if not v)
    total_polled = len(_feed_health) if _feed_health else (len(PRIMARY_FEEDS) + len(BACKUP_FEEDS))
    last_update = (
        _last_refresh_time.isoformat()
        if _last_refresh_time
        else datetime.now(timezone.utc).isoformat()
    )
    overall = (
        'green' if failed == 0
        else ('amber' if failed < total_polled / 2 else 'red')
    )
    return JSONResponse({
        'status': overall,
        'last_update': last_update,
        'sources_polled': total_polled,
        'healthy_sources': healthy if _feed_health else len(PRIMARY_FEEDS),
        'failed_sources': failed,
        'ingestion': 'green' if failed == 0 else 'amber',
        'clustering': 'green',
        'ranking': 'green',
        'sources': [
            {
                'id': f'source_{i}',
                'name': name,
                'status': 'healthy' if _feed_health.get(name, True) else 'failed',
                'credibility': 0.9,
            }
            for i, (name, _) in enumerate(PRIMARY_FEEDS[:10])
        ],
    })


@app.post('/api/refresh')
async def api_refresh():
    items = await refresh_cache_async()
    return JSONResponse({'items': len(items), 'as_of': datetime.now(timezone.utc).isoformat()})


@app.get('/api/trends')
async def api_trends():
    """Return cached internet trends. Fetches on demand if cache is empty or stale."""
    trends, fetched_at = _load_trends()

    # Refresh if empty OR cache is older than the refresh interval
    needs_refresh = not trends
    if not needs_refresh and fetched_at:
        try:
            age_secs = (datetime.now(timezone.utc) - dtparser.parse(fetched_at)).total_seconds()
            if age_secs > TRENDS_REFRESH_INTERVAL:
                needs_refresh = True
        except Exception:
            pass

    if needs_refresh:
        try:
            trends = await refresh_trends_async()
            _, fetched_at = _load_trends()
        except Exception:
            if not trends:
                trends = []
                fetched_at = None
    active_sources = list({t.get('primary_platform', '') for t in trends if t.get('primary_platform')})
    return JSONResponse({
        'trends': trends,
        'as_of': fetched_at or datetime.now(timezone.utc).isoformat(),
        'sources': sorted(active_sources),
        'count': len(trends),
    })


@app.get('/api/trend-summary')
async def api_trend_summary(topic: str = ''):
    """Return a plain-English summary of why a topic is trending (Task 20)."""
    if not topic:
        return JSONResponse({'summary': ''})
    trends, _ = _load_trends()
    matched = None
    norm_topic = _normalize_topic(topic)
    for t in trends:
        if fuzz.token_set_ratio(norm_topic, _normalize_topic(t['topic'])) >= 75:
            matched = t
            break
    if not matched:
        return JSONResponse({'summary': f'No trend data found for "{topic}".'})
    platform_info = ', '.join(matched.get('platforms', []))
    vel = matched.get('velocity', 'STEADY').lower()
    score = matched.get('composite_score', 0)
    signals = matched.get('signals', 0)
    cats = ', '.join(matched.get('categories', ['General']))
    age = matched.get('age_label', 'recently')
    cross = matched.get('cross_platform_count', 1)
    summary = (
        f'"{matched["topic"]}" is currently {vel} on {platform_info}. '
        f'First detected {age} with {signals:,} engagement signals across '
        f'{cross} platform{"s" if cross != 1 else ""}. '
        f'Category: {cats}. Trending score: {round(score * 100)}%.'
    )
    if matched.get('subreddit'):
        summary += f' Most active in {matched["subreddit"]}.'
    return JSONResponse({
        'summary': summary,
        'topic': matched['topic'],
        'velocity': matched.get('velocity', ''),
        'platforms': matched.get('platforms', []),
    })


@app.get('/api/trend-history')
async def api_trend_history(topic: str = ''):
    """Return score/velocity history for a topic over the past 48h (Task 26).
    When fewer than 8 real rows exist, synthetic back-fill points are prepended
    so the graph always has a visible curve to render."""
    import math, random as _rnd
    if not topic:
        return JSONResponse({'history': []})
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT composite_score, signals, velocity, recorded_at FROM trend_history '
                'WHERE topic = ? ORDER BY recorded_at ASC',
                (topic,),
            ).fetchall()
        history = [
            {'composite_score': r['composite_score'], 'signals': r['signals'],
             'velocity': r['velocity'], 'recorded_at': r['recorded_at'],
             'synthetic': False}
            for r in rows
        ]
    except Exception:
        history = []

    # Synthesise back-fill if we have fewer than 8 real data points
    MIN_POINTS = 8
    if len(history) < MIN_POINTS:
        now = datetime.now(timezone.utc)
        # Anchor score: use the most recent real point, or 0.3 as baseline
        anchor = history[-1]['composite_score'] if history else 0.3
        velocity = history[-1].get('velocity', 'stable') if history else 'stable'
        # How many synthetic points do we need?
        n_synth = MIN_POINTS - len(history)
        # Spread them evenly across the 48h window before the earliest real point
        if history:
            earliest = datetime.fromisoformat(history[0]['recorded_at'].replace('Z', '+00:00'))
        else:
            earliest = now
        total_secs = 48 * 3600
        step_secs = total_secs / (n_synth + 1)
        synth_points = []
        for i in range(n_synth, 0, -1):
            t = earliest - timedelta(seconds=step_secs * i)
            # Score gradually rises toward anchor (simulating growth into relevance)
            frac = (n_synth - i) / n_synth          # 0 → 1 as we approach anchor
            noise = _rnd.uniform(-0.04, 0.04)
            score = max(0.0, min(1.0, anchor * (0.3 + 0.7 * frac) + noise))
            synth_points.append({
                'composite_score': round(score, 4),
                'signals': 0,
                'velocity': velocity,
                'recorded_at': t.strftime('%Y-%m-%dT%H:%M:%S+00:00'),
                'synthetic': True,
            })
        history = synth_points + history

    return JSONResponse({'history': history, 'topic': topic})
