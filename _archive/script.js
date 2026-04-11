const API_BASE = 'https://projectrollup.onrender.com';
const STAY_VISIBLE = 100;

const els = {
  status: document.getElementById('status'),
  resultCount: document.getElementById('resultCount'),
  windowInfo: document.getElementById('windowInfo'),
  storyList: document.getElementById('storyList'),
  storyListWrap: document.getElementById('storyListWrap'),
  searchInput: document.getElementById('searchInput'),
  sourceFilter: document.getElementById('sourceFilter'),
  sortSelect: document.getElementById('sortSelect'),
  refreshBtn: document.getElementById('refreshBtn'),
  moreBtn: document.getElementById('moreBtn'),
  toggleCompactBtn: document.getElementById('toggleCompactBtn'),
  detailTitle: document.getElementById('detailTitle'),
  detailMeta: document.getElementById('detailMeta'),
  detailSummary: document.getElementById('detailSummary'),
  detailFacts: document.getElementById('detailFacts'),
  openSummaryBtn: document.getElementById('openSummaryBtn'),
  summaryModal: document.getElementById('summaryModal'),
  summaryTitle: document.getElementById('summaryTitle'),
  summaryBody: document.getElementById('summaryBody'),
  summaryMeta: document.getElementById('summaryMeta'),
  summaryClose: document.getElementById('summaryClose'),
  globeWidget: document.getElementById('globeWidget'),
  globeLabel: document.getElementById('globeLabel'),
  globeStatus: document.getElementById('globeStatus'),
  markerDot: document.getElementById('markerDot'),
  orbitPath: document.getElementById('orbitPath'),
};

let items = [];
let visibleCount = STAY_VISIBLE;
let selected = 0;
let compact = false;
let query = '';
let sourceFilter = 'all';
let sortMode = 'rank';
let selectedStory = null;
let lastFocusedEl = null;
let summaryCache = new Map();
const locationCache = new Map();
const loadedPages = new Set();
let page = 1;
let loadState = 'loading';

const GEO_DB = [
  { name: 'Tokyo, Japan', aliases: ['tokyo', 'japan', 'tokyo, japan', 'japanese'], lat: 35.6762, lon: 139.6503 },
  { name: 'Paris, France', aliases: ['paris', 'france', 'paris, france', 'french'], lat: 48.8566, lon: 2.3522 },
  { name: 'Washington, D.C., USA', aliases: ['washington', 'washington dc', 'washington, d.c.', 'dc', 'd.c.', 'white house', 'capitol'], lat: 38.9072, lon: -77.0369 },
  { name: 'Washington State, USA', aliases: ['washington state', 'seattle', 'spokane', 'tacoma'], lat: 47.7511, lon: -120.7401 },
  { name: 'Georgia, USA', aliases: ['georgia', 'atlanta', 'savannah', 'usa georgia'], lat: 32.1656, lon: -82.9001 },
  { name: 'Georgia', aliases: ['tbilisi', 'kutaisi', 'batumi', 'country georgia'], lat: 42.3154, lon: 43.3569 },
  { name: 'London, UK', aliases: ['london', 'uk', 'britain', 'british', 'england'], lat: 51.5072, lon: -0.1276 },
  { name: 'New York, USA', aliases: ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens'], lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles, USA', aliases: ['los angeles', 'la', 'hollywood'], lat: 34.0522, lon: -118.2437 },
  { name: 'Berlin, Germany', aliases: ['berlin', 'germany', 'german'], lat: 52.52, lon: 13.405 },
  { name: 'Kyiv, Ukraine', aliases: ['kyiv', 'kiev', 'ukraine', 'ukrainian'], lat: 50.4501, lon: 30.5234 },
  { name: 'Moscow, Russia', aliases: ['moscow', 'russia', 'russian'], lat: 55.7558, lon: 37.6173 },
  { name: 'Beijing, China', aliases: ['beijing', 'china', 'chinese'], lat: 39.9042, lon: 116.4074 },
  { name: 'Seoul, South Korea', aliases: ['seoul', 'south korea', 'korea', 'korean'], lat: 37.5665, lon: 126.978 },
  { name: 'Delhi, India', aliases: ['delhi', 'india', 'indian', 'mumbai', 'bangalore'], lat: 28.6139, lon: 77.209 },
  { name: 'Jerusalem, Israel', aliases: ['jerusalem', 'israel', 'tel aviv', 'israeli'], lat: 31.7683, lon: 35.2137 },
  { name: 'Sydney, Australia', aliases: ['sydney', 'australia', 'australian', 'melbourne'], lat: -33.8688, lon: 151.2093 },
  { name: 'São Paulo, Brazil', aliases: ['sao paulo', 'são paulo', 'brazil', 'brazilian', 'rio de janeiro'], lat: -23.5505, lon: -46.6333 },
];

function htmlesc(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s,.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
function parseSummary(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
}
function estimateReadTime(text) { return Math.max(1, Math.ceil(wordCount(text) / 210)); }
function readStory(r) { return [r.headline, r.summary, r.snippet, r.source, r.body, r.location, r.city, r.region, r.country, r.tags].filter(Boolean).join(' '); }
function pickLocationCandidate(article) {
  const parts = [article.country, article.region, article.city, article.location, article.dateline, article.coords, article.geo].filter(Boolean);
  if (parts.length) return { label: parts.join(', '), confidence: 0.96, source: 'structured' };
  const text = norm(readStory(article));
  let best = null;
  for (const loc of GEO_DB) {
    for (const alias of loc.aliases) {
      const token = norm(alias);
      if (!token) continue;
      const re = new RegExp(`\\b${token.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(text)) {
        const score = Math.min(0.92, 0.38 + token.split(' ').length * 0.14 + (text.includes(',') ? 0.06 : 0));
        if (!best || score > best.confidence) best = { label: loc.name, confidence: score, source: 'text', loc };
      }
    }
  }
  return best;
}
function inferLocation(article) {
  const key = norm([article.id, article.headline, article.source, article.summary, article.snippet, article.location, article.city, article.country].join('|'));
  if (locationCache.has(key)) return locationCache.get(key);
  const candidate = pickLocationCandidate(article);
  let result;
  if (candidate && candidate.confidence >= 0.58) {
    const matched = GEO_DB.find((x) => x.name === candidate.label) || candidate.loc;
    result = { status: 'locked', label: candidate.label, display: `LOCKED: ${candidate.label.toUpperCase()}`, lat: matched?.lat, lon: matched?.lon, confidence: candidate.confidence };
  } else {
    result = { status: 'searching', label: 'Signal unclear', display: 'SIGNAL UNCLEAR', confidence: candidate?.confidence || 0 };
  }
  locationCache.set(key, result);
  return result;
}
function mapToGlobe(loc) {
  if (!els.globeWidget) return;
  els.globeWidget.classList.add('visible');
  els.globeStatus.textContent = loc.display;
  els.globeLabel.textContent = loc.label || 'LOCATION UNKNOWN';
  if (loc.status === 'locked' && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    const x = 80 + (loc.lon / 180) * 58;
    const y = 80 - (loc.lat / 90) * 58;
    els.markerDot.setAttribute('cx', String(x));
    els.markerDot.setAttribute('cy', String(y));
    els.markerDot.style.opacity = '1';
    els.orbitPath.style.opacity = '.55';
  } else {
    els.markerDot.style.opacity = '0';
    els.orbitPath.style.opacity = '.9';
  }
}
function stripHtml(html) { return String(html || '').replace(/<[^>]+>/g, ' '); }
function summarizeText(title, source, body, meta, sourceCount, ageMinutes, score) {
  const bodyText = stripHtml(body).replace(/\s+/g, ' ').trim();
  const metaText = stripHtml(meta).replace(/\s+/g, ' ').trim();
  const sourcePhrase = sourceCount === 1 ? source : `${source} and ${sourceCount - 1} other source(s)`;
  const paragraphs = [metaText, bodyText].filter(Boolean).join('. ');
  const sentences = parseSummary(paragraphs);
  const selectedSentences = [];
  let words = 0;
  for (const sentence of sentences) {
    const c = wordCount(sentence);
    if (words + c > 400) break;
    selectedSentences.push(sentence);
    words += c;
    if (words >= 280) break;
  }
  const intro = `${title} is being tracked by Project RollUp from ${sourcePhrase}. It is ${ageMinutes} minutes old.`;
  const outro = 'This write-up is limited to sourced facts and reported details; it avoids speculation and preserves the article’s core informational content.';
  const summary = [intro, ...selectedSentences, outro].join(' ').replace(/\s+/g, ' ').trim();
  return summary.split(/\s+/).slice(0, 400).join(' ');
}
function normalizeStory(story) {
  const summaryText = story.summary || '';
  return {
    ...story,
    displaySource: story.source || 'Unknown source',
    displayTime: story.published ? new Date(story.published).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : story.age,
    displayAge: story.age || '',
    summary: summaryText,
    readTime: estimateReadTime(summaryText || story.headline),
  };
}
function setLoadState(next) {
  loadState = next;
  els.status.textContent = next === 'ready' ? `${filteredItems().length} stories loaded` : next === 'loading' ? 'Loading…' : next;
}
function uniqueSources() {
  return [...new Set(items.map((x) => x.source).filter(Boolean))].sort();
}
function filteredItems() {
  let list = [...items];
  if (sourceFilter !== 'all') list = list.filter((x) => x.source === sourceFilter);
  if (query.trim()) {
    const q = norm(query);
    list = list.filter((x) => norm([x.headline, x.source, x.summary, x.reason].join(' ')).includes(q));
  }
  if (sortMode === 'time') list.sort((a, b) => (a.age_minutes ?? 9999) - (b.age_minutes ?? 9999));
  if (sortMode === 'source') list.sort((a, b) => (b.source_count ?? 0) - (a.source_count ?? 0));
  return list;
}
function updateSourceFilter() {
  const current = sourceFilter;
  const sources = uniqueSources();
  els.sourceFilter.innerHTML = `<option value='all'>All sources</option>` + sources.map((s) => `<option value='${htmlesc(s)}'>${htmlesc(s)}</option>`).join('');
  els.sourceFilter.value = sources.includes(current) ? current : 'all';
}
function renderList() {
  const list = filteredItems();
  const subset = list.slice(0, visibleCount);
  els.resultCount.textContent = `${list.length} headlines`;
  els.windowInfo.textContent = `Showing ${subset.length} of ${list.length} • ${visibleCount >= STAY_VISIBLE ? '100+ guaranteed window' : 'expanded view'}`;
  if (!subset.length) {
    els.storyList.innerHTML = `<div class='loadState'>No matches. Broaden your search or filter.</div>`;
    return;
  }
  els.storyList.innerHTML = subset.map((r, i) => {
    const isSelected = selectedStory && r.headline === selectedStory.headline && r.source === selectedStory.source;
    const loc = inferLocation(r);
    return `
      <article class='storyCard ${isSelected ? 'selected' : ''}' data-index='${i}' tabindex='0' role='button' aria-label='Open ${htmlesc(r.headline)}'>
        <div class='storyCardTop'>
          <h3 class='storyCardTitle'>${htmlesc(r.headline)}</h3>
        </div>
        <div class='storyCardMeta'>
          <span class='chip'>${htmlesc(r.source || 'Unknown')}</span>
          <span class='chip'>${htmlesc(r.displayTime || r.age || '')}</span>
          <span class='chip'>${r.source_count ?? 1} source${(r.source_count ?? 1) === 1 ? '' : 's'}</span>
          <span class='chip'>${htmlesc(loc.label || 'Location unknown')}</span>
        </div>
        <p class='storyCardSummary'>${htmlesc(r.summary || r.reason || 'No summary available yet.')}</p>
        <div class='storyCardFooter'>
          <span>${r.readTime || 1} min read</span>
          <span>${htmlesc(r.displayAge || r.age || 'Fresh')}</span>
        </div>
      </article>`;
  }).join('');
}
function renderDetail(story) {
  if (!story) {
    els.detailTitle.textContent = 'Choose a headline';
    els.detailMeta.textContent = 'The selection detail will appear here.';
    els.detailSummary.textContent = 'Select a headline to see a concise, fact-based write-up based on available feed text and article content when available.';
    els.detailFacts.innerHTML = '';
    els.openSummaryBtn.disabled = true;
    if (els.globeWidget) els.globeWidget.classList.remove('visible');
    return;
  }
  const loc = inferLocation(story);
  selectedStory = story;
  mapToGlobe(loc);
  els.detailTitle.textContent = story.headline;
  els.detailMeta.textContent = `${story.source || 'Unknown source'} • ${story.displayTime || story.age || ''} • ${story.source_count ?? 1} source${(story.source_count ?? 1) === 1 ? '' : 's'}`;
  els.detailSummary.textContent = story.summary || 'No summary available.';
  els.detailFacts.innerHTML = [
    ['Location', loc.label || 'Unknown'],
    ['Why ranked', story.reason || 'Ranking rationale unavailable'],
    ['Published', story.displayTime || 'Unknown'],
    ['Source count', String(story.source_count ?? 1)],
    ['Age', story.age || 'Unknown'],
  ].map(([k, v]) => `<div class='factRow'><div class='factLabel'>${htmlesc(k)}</div><div class='factValue'>${htmlesc(v)}</div></div>`).join('');
  els.openSummaryBtn.disabled = false;
}
function selectByIndex(index) {
  const list = filteredItems();
  if (!list.length) return;
  selected = Math.max(0, Math.min(list.length - 1, index));
  renderList();
  renderDetail(list[selected]);
  scrollSelectedIntoView();
}
function scrollSelectedIntoView() {
  const card = els.storyList.querySelector('.storyCard.selected');
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function selectNext(delta) { selectByIndex(selected + delta); }
function openSummary(story) {
  if (!story) return;
  lastFocusedEl = document.activeElement;
  const key = `${story.headline}__${story.source}`;
  const cached = summaryCache.get(key);
  els.summaryTitle.textContent = story.headline;
  els.summaryMeta.textContent = 'Generating fact-based write-up…';
  els.summaryBody.textContent = 'Loading…';
  els.summaryModal.classList.add('open');
  els.summaryModal.setAttribute('aria-hidden', 'false');
  if (cached) {
    els.summaryMeta.textContent = cached.meta;
    els.summaryBody.textContent = cached.body;
    return;
  }
  fetch(`${API_BASE}/api/story?headline=${encodeURIComponent(story.headline)}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const body = data.summary || story.summary || 'No summary available.';
      const meta = `${data.source || story.source || 'Project RollUp'} • ${data.age_minutes ?? story.age_minutes ?? 0}m`;
      summaryCache.set(key, { meta, body });
      els.summaryMeta.textContent = meta;
      els.summaryBody.textContent = body;
    })
    .catch((err) => {
      els.summaryMeta.textContent = 'Summary unavailable';
      els.summaryBody.textContent = `Could not load summary: ${err.message}`;
    });
}
function closeSummary() {
  els.summaryModal.classList.remove('open');
  els.summaryModal.setAttribute('aria-hidden', 'true');
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
}
function setStories(stories, append = false) {
  const normalized = stories.map(normalizeStory);
  if (append) {
    const seen = new Set(items.map((x) => `${x.headline}__${x.source}`));
    for (const story of normalized) {
      const key = `${story.headline}__${story.source}`;
      if (!seen.has(key)) items.push(story);
    }
  } else {
    items = normalized;
  }
  items = dedupeStories(items);
  updateSourceFilter();
  setLoadState('ready');
  renderList();
  const list = filteredItems();
  if (list.length) renderDetail(list[Math.min(selected, list.length - 1)]);
  els.moreBtn.disabled = loadedPages.has(page) && items.length >= 1000;
}
function dedupeStories(list) {
  const out = [];
  const seen = new Set();
  for (const story of list) {
    const key = norm(story.headline);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(story);
    }
  }
  return out.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.age_minutes || 9999) - (b.age_minutes || 9999));
}
function fetchStories() {
  setLoadState('loading');
  return fetch(`${API_BASE}/api/stories?page=${page}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const stories = data.stories || [];
      loadedPages.add(page);
      setStories(page === 1 ? stories : stories, page > 1);
      els.status.textContent = `${items.length} stories loaded • ${data.as_of || new Date().toISOString()}`;
      return stories;
    })
    .catch((err) => {
      setLoadState('error');
      els.status.textContent = `Error loading stories: ${err.message}`;
      els.storyList.innerHTML = `<div class='loadState'>Could not load stories. Check the backend connection and try again.</div>`;
      throw err;
    });
}
function loadMore() {
  page += 1;
  visibleCount = Math.max(visibleCount, STAY_VISIBLE * page);
  return fetchStories();
}
function applySortAndFilter() {
  const list = filteredItems();
  selected = Math.max(0, Math.min(selected, list.length - 1));
  renderList();
  renderDetail(list[selected]);
}
function seedUI() {
  els.refreshBtn?.addEventListener('click', () => { page = 1; visibleCount = STAY_VISIBLE; fetchStories(); });
  els.moreBtn?.addEventListener('click', () => loadMore());
  els.toggleCompactBtn?.addEventListener('click', () => { compact = !compact; document.body.classList.toggle('compactMode', compact); els.toggleCompactBtn.textContent = compact ? 'Exit compact cards' : 'Toggle compact cards'; });
  els.searchInput?.addEventListener('input', (e) => { query = e.target.value; applySortAndFilter(); });
  els.sourceFilter?.addEventListener('change', (e) => { sourceFilter = e.target.value; applySortAndFilter(); });
  els.sortSelect?.addEventListener('change', (e) => { sortMode = e.target.value; applySortAndFilter(); });
  els.storyListWrap?.addEventListener('click', (e) => {
    const card = e.target.closest('.storyCard');
    if (!card) return;
    const list = filteredItems();
    const story = list[Number(card.dataset.index)];
    if (!story) return;
    selected = Number(card.dataset.index);
    renderList();
    renderDetail(story);
    openSummary(story);
  });
  els.storyListWrap?.addEventListener('keydown', (e) => {
    const card = e.target.closest('.storyCard');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const list = filteredItems();
      const story = list[Number(card.dataset.index)];
      if (story) openSummary(story);
    }
  });
  els.openSummaryBtn?.addEventListener('click', () => selectedStory && openSummary(selectedStory));
  els.summaryClose?.addEventListener('click', closeSummary);
  els.summaryModal?.addEventListener('click', (e) => { if (e.target === els.summaryModal) closeSummary(); });
  window.addEventListener('keydown', (e) => {
    if (els.summaryModal.classList.contains('open')) {
      if (e.key === 'Escape') closeSummary();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { page = 1; visibleCount = STAY_VISIBLE; fetchStories(); }
    if (e.key === 'Enter' && selectedStory) openSummary(selectedStory);
    if (e.key === 'ArrowDown') selectNext(1);
    if (e.key === 'ArrowUp') selectNext(-1);
    if (e.key === '/') { e.preventDefault(); els.searchInput.focus(); }
    if (e.key === 'PageDown') loadMore();
  });
  els.storyListWrap?.addEventListener('scroll', () => {
    const nearBottom = els.storyListWrap.scrollTop + els.storyListWrap.clientHeight >= els.storyListWrap.scrollHeight - 400;
    if (nearBottom && items.length >= visibleCount && visibleCount < 400) {
      visibleCount += 24;
      renderList();
    }
  });
}
function initGlobeFallback() {
  if (!els.globeWidget) return;
  if (window.matchMedia('(max-width: 767px)').matches) return;
  els.globeWidget.classList.add('visible');
}
// ── Trends ────────────────────────────────────────────────────────────────────

let trendsData = [];
let trendsLoaded = false;
let trendCategoryFilter = 'all';
let trendVelocityFilter = 'all';

const VELOCITY_LABELS = {
  ACCELERATING: '↑ RISING',
  PEAKING:      '→ PEAKING',
  STEADY:       '· STEADY',
  FADING:       '↓ FADING',
};

const PLATFORM_SHORT = {
  'HackerNews':    'HN',
  'Reddit':        'Reddit',
  'Google Trends': 'Google',
};

function trendAge(minutes) {
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function filteredTrends() {
  return trendsData.filter(t => {
    if (trendCategoryFilter !== 'all' && !t.categories.includes(trendCategoryFilter)) return false;
    if (trendVelocityFilter !== 'all' && t.velocity !== trendVelocityFilter) return false;
    return true;
  });
}

function countRelatedStories(topic) {
  if (!items.length) return 0;
  const q = norm(topic);
  return items.filter(s => norm([s.headline, s.summary].join(' ')).includes(q.split(' ')[0])).length;
}

function renderTrends() {
  const list = filteredTrends();
  const trendList = document.getElementById('trendList');
  const trendCount = document.getElementById('trendCount');
  trendCount.textContent = `${list.length} trend${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    trendList.innerHTML = `<div class='loadState'>${trendsLoaded ? 'No trends match the current filters.' : 'Loading trends…'}</div>`;
    return;
  }

  trendList.innerHTML = list.map((t, i) => {
    const velLabel = VELOCITY_LABELS[t.velocity] || t.velocity;
    const platforms = t.platforms.map(p =>
      `<span class='platformBadge pb-${(p.replace(/\s/g, '')).toLowerCase()}'>${htmlesc(PLATFORM_SHORT[p] || p)}</span>`
    ).join('');
    const cats = (t.categories || []).map(c => `<span class='chip'>${htmlesc(c)}</span>`).join('');
    const related = countRelatedStories(t.topic);
    const relatedBtn = related > 0
      ? `<button class='btnGhost trendFeedBtn' data-topic='${htmlesc(t.topic)}' type='button'>${related} stor${related === 1 ? 'y' : 'ies'} in feed →</button>`
      : '';
    const subreddit = t.subreddit ? `<span class='trendSub'>${htmlesc(t.subreddit)}</span>` : '';
    return `
      <article class='trendCard' data-index='${i}'>
        <div class='trendCardTop'>
          <span class='velocityBadge vel-${t.velocity}'>${htmlesc(velLabel)}</span>
          <div class='trendCats'>${cats}</div>
        </div>
        <h3 class='trendCardTitle'>${htmlesc(t.topic)}</h3>
        <div class='trendPlatforms'><span class='platformLabel'>Spotted on:</span> ${platforms} ${subreddit}</div>
        <div class='trendCardMeta'>
          <span>${htmlesc(trendAge(t.age_minutes))}</span>
          ${t.signals ? `<span>${t.signals.toLocaleString()} signals</span>` : ''}
          <span>${t.cross_platform_count}/${t.cross_platform_count >= 3 ? 3 : t.cross_platform_count} platform${t.cross_platform_count !== 1 ? 's' : ''}</span>
        </div>
        <div class='trendCardFooter'>
          <a class='trendLink' href='${htmlesc(t.url)}' target='_blank' rel='noopener noreferrer'>View on ${htmlesc(t.primary_platform)} →</a>
          ${relatedBtn}
        </div>
      </article>`;
  }).join('');
}

function fetchTrends() {
  const trendList = document.getElementById('trendList');
  const trendSources = document.getElementById('trendSources');
  trendList.innerHTML = `<div class='loadState'>Fetching trends…</div>`;
  fetch(`${API_BASE}/api/trends`)
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      trendsData = data.trends || [];
      trendsLoaded = true;
      const asOf = document.getElementById('trendAsOf');
      if (asOf && data.as_of) {
        asOf.textContent = `Last updated: ${new Date(data.as_of).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      }
      if (trendSources && data.sources) {
        trendSources.textContent = `Sources: ${data.sources.join(', ')}`;
      }
      renderTrends();
    })
    .catch(err => {
      trendList.innerHTML = `<div class='loadState'>Could not load trends: ${htmlesc(err.message)}</div>`;
    });
}

function seedTrendsUI() {
  document.getElementById('trendRefreshBtn')?.addEventListener('click', fetchTrends);
  document.getElementById('trendCategoryFilter')?.addEventListener('change', e => {
    trendCategoryFilter = e.target.value;
    renderTrends();
  });
  document.getElementById('trendVelocityFilter')?.addEventListener('change', e => {
    trendVelocityFilter = e.target.value;
    renderTrends();
  });
  document.getElementById('trendList')?.addEventListener('click', e => {
    const btn = e.target.closest('.trendFeedBtn');
    if (!btn) return;
    const topic = btn.dataset.topic || '';
    // Switch to news tab and pre-fill search
    switchTab('news');
    const si = document.getElementById('searchInput');
    if (si) {
      si.value = topic.split(' ').slice(0, 3).join(' ');
      query = si.value;
      applySortAndFilter();
    }
  });
}

function switchTab(tab) {
  const newsView = document.getElementById('newsView');
  const trendsView = document.getElementById('trendsView');
  const tabNews = document.getElementById('tabNews');
  const tabTrends = document.getElementById('tabTrends');
  if (tab === 'trends') {
    newsView.hidden = true;
    trendsView.hidden = false;
    tabNews.classList.remove('active');
    tabTrends.classList.add('active');
    if (!trendsLoaded) fetchTrends();
  } else {
    trendsView.hidden = true;
    newsView.hidden = false;
    tabTrends.classList.remove('active');
    tabNews.classList.add('active');
  }
}

function seedTabNav() {
  document.getElementById('tabNews')?.addEventListener('click', () => switchTab('news'));
  document.getElementById('tabTrends')?.addEventListener('click', () => switchTab('trends'));
}

// ── Init ──────────────────────────────────────────────────────────────────────
seedUI();
initGlobeFallback();
seedTabNav();
seedTrendsUI();
fetchStories();
setInterval(() => { page = 1; visibleCount = STAY_VISIBLE; fetchStories(); }, 300000);
