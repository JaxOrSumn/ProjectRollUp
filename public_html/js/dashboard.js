// ── Dashboard State ─────────────────────────────────────
let stories = [];
let systemState = {};
let sources = [];

// ── Persistent State (localStorage) ────────────────────
let mutedSources = JSON.parse(localStorage.getItem('rollup_muted') || '[]');
let pinnedIds    = JSON.parse(localStorage.getItem('rollup_pinned') || '[]');
let readIds      = new Set(JSON.parse(localStorage.getItem('rollup_read') || '[]'));
let searchQuery  = '';

// ── Refresh Timing ──────────────────────────────────────
const REFRESH_INTERVAL_SECS = 300; // 5 minutes, matches backend
let _lastRefreshAt = Date.now();

// ── API Endpoints ───────────────────────────────────────
const API_BASE = 'https://projectrollup.onrender.com';
const USE_MOCK = false;

// ── Tag Colour Map (shared by feed cards + briefing modal) ──
const TAG_COLORS = {
  'Geopolitics':       'tag-geo',
  'Tech':              'tag-tech',
  'Economic':         'tag-econ',
  'Scientific Reports':'tag-sci',
  'Media':             'tag-media',
  'Celebrity News':    'tag-celeb',
  'General':           'tag-general',
};

// ── Fetch Functions ─────────────────────────────────────

async function fetchStories() {
  if (USE_MOCK) { stories = MOCK_STORIES; return; }
  try {
    const res = await fetch(`${API_BASE}/api/stories`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    stories = data.stories || [];
    hideError();
  } catch (err) {
    console.error('Failed to fetch stories:', err);
    showError(err.message);
    if (!stories.length) stories = MOCK_STORIES;
  }
}

async function fetchSystemState() {
  if (USE_MOCK) { systemState = SYSTEM_STATE; sources = MOCK_SOURCES; return; }
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    systemState = {
      missionStatus:  data.status      || 'green',
      lastRefresh:    data.last_update || new Date().toISOString(),
      sourcesPolled:  data.sources_polled  || 0,
      healthySources: data.healthy_sources || 0,
      failedSources:  data.failed_sources  || 0,
      ingestion:  data.ingestion  || 'green',
      clustering: data.clustering || 'green',
      ranking:    data.ranking    || 'green',
      apiStatus:  'green',
    };
    sources = data.sources || MOCK_SOURCES;
  } catch (err) {
    console.error('Failed to fetch system state:', err);
    systemState = SYSTEM_STATE;
    sources = MOCK_SOURCES;
  }
}

async function fetchStoryDetail(id) {
  if (USE_MOCK) return MOCK_STORIES.find(s => s.id === id);
  const localStory = stories.find(s => s.id === id);
  const headline   = localStory?.headline || localStory?.title;
  try {
    const param = headline
      ? `headline=${encodeURIComponent(headline)}`
      : `id=${encodeURIComponent(id)}`;
    const res = await fetch(`${API_BASE}/api/story?${param}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch story detail:', err);
    return localStory;
  }
}

// ── Error State UI (Task 18) ────────────────────────────

function showError(reason) {
  hideError();
  const feed = document.getElementById('feed');
  if (!feed) return;
  let secs = 30;
  const el = document.createElement('div');
  el.id = 'error-state';
  el.className = 'error-state';
  el.innerHTML = `
    <div class="error-icon">&#9888;</div>
    <div class="error-title">SIGNAL LOST</div>
    <div class="error-detail">Backend unreachable — ${escapeHtml(reason)}</div>
    <div class="error-retry">Retrying in <span id="error-countdown">${secs}</span>s&hellip;</div>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="retryNow()">RETRY NOW</button>
  `;
  feed.insertBefore(el, feed.firstChild);
  window._errorRetryTimer = setInterval(() => {
    secs--;
    const cd = document.getElementById('error-countdown');
    if (cd) cd.textContent = secs;
    if (secs <= 0) { clearInterval(window._errorRetryTimer); retryNow(); }
  }, 1000);
}

function hideError() {
  const el = document.getElementById('error-state');
  if (el) el.remove();
  if (window._errorRetryTimer) { clearInterval(window._errorRetryTimer); window._errorRetryTimer = null; }
}

async function retryNow() {
  hideError();
  await refresh();
}

// ── Search (Task 15) ────────────────────────────────────

function onSearchInput(val) {
  searchQuery = val.trim().toLowerCase();
  document.getElementById('search-clear').style.display = searchQuery ? 'inline-block' : 'none';
  renderFeed();
}

function clearSearch() {
  searchQuery = '';
  const inp = document.getElementById('headline-search');
  if (inp) inp.value = '';
  document.getElementById('search-clear').style.display = 'none';
  renderFeed();
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const safe = escapeHtml(text);
  const re   = new RegExp(`(${escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark class="search-highlight">$1</mark>');
}

// ── Read / Unread (Task 17) ─────────────────────────────

function markRead(id) {
  readIds.add(id);
  localStorage.setItem('rollup_read', JSON.stringify([...readIds]));
}

function markAllRead() {
  stories.forEach(s => readIds.add(s.id));
  localStorage.setItem('rollup_read', JSON.stringify([...readIds]));
  renderFeed();
}

// ── Mute Source (Task 6) ────────────────────────────────

function muteSource(sourceName) {
  if (!mutedSources.includes(sourceName)) {
    mutedSources.push(sourceName);
    localStorage.setItem('rollup_muted', JSON.stringify(mutedSources));
  }
  closeBriefing();
  renderFeed();
}

function unmuteAll() {
  mutedSources = [];
  localStorage.removeItem('rollup_muted');
  renderFeed();
}

// ── Pin Signal (Task 6) ─────────────────────────────────

function pinSignal(id) {
  if (pinnedIds.includes(id)) {
    pinnedIds = pinnedIds.filter(p => p !== id);
  } else {
    pinnedIds.push(id);
  }
  localStorage.setItem('rollup_pinned', JSON.stringify(pinnedIds));
  renderFeed();
}

// ── Export Report (Task 6) ──────────────────────────────

function exportReport(id) {
  const story = stories.find(s => s.id === id);
  if (!story) return;
  const text = [
    'PROJECT ROLLUP — SIGNAL BRIEFING',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `HEADLINE: ${story.headline || story.title || ''}`,
    `SOURCE:   ${story.source || ''}`,
    `TIME:     ${timeAgo(story.firstSeenAt || story.published_at)}`,
    `SIGNAL:   ${signalStrength(story.confidence || 0).label}`,
    `TAGS:     ${(story.tags || []).join(', ') || 'General'}`,
    '',
    story.summary || '',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Exported from Project RollUp — ${new Date().toUTCString()}`,
  ].join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.briefing-actions .btn-export');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'COPIED!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  }).catch(() => {
    // Fallback: open in new window
    const w = window.open('', '_blank');
    if (w) { w.document.write(`<pre>${text}</pre>`); w.document.close(); }
  });
}

// ── Permalink / Deep Link (Task 19) ────────────────────

function storyToHash(story) {
  const raw = (story.headline || story.title || '') + '|' + (story.source || '');
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
  }
  return 'signal-' + Math.abs(h).toString(36);
}

function updateURLForStory(story) {
  if (!story) return;
  history.replaceState(null, '', '#' + storyToHash(story));
}

function clearURLHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ── Render Functions ────────────────────────────────────

function renderHeader() {
  const statusDot   = document.getElementById('status-dot');
  const statusText  = document.getElementById('mission-status-text');
  const lastRefresh = document.getElementById('last-refresh');
  const sourceCount = document.getElementById('source-count');
  const healthyCount= document.getElementById('healthy-count');
  const failedCount = document.getElementById('failed-count');

  const status = systemState.missionStatus || 'green';
  statusDot.className = 'live-dot';
  if (status === 'amber' || status === 'degraded') statusDot.classList.add('amber');
  if (status === 'red'   || status === 'failed')   statusDot.classList.add('red');

  statusText.textContent  = `MISSION STATUS: ${status.toUpperCase()}`;
  lastRefresh.textContent = timeAgo(systemState.lastRefresh || new Date().toISOString());
  sourceCount.textContent  = systemState.sourcesPolled  || '—';
  healthyCount.textContent = systemState.healthySources || '—';
  failedCount.textContent  = systemState.failedSources  || '—';
}

function renderFeed() {
  const feed = document.getElementById('feed');
  if (!feed) return;

  // Filter + search
  let filtered = filterStories(stories);
  if (searchQuery) {
    filtered = filtered.filter(s => {
      const hay = ((s.headline || s.title || '') + ' ' + (s.summary || '')).toLowerCase();
      return hay.includes(searchQuery);
    });
  }

  // Pinned items float to top
  const sorted = [
    ...filtered.filter(s => pinnedIds.includes(s.id)),
    ...filtered.filter(s => !pinnedIds.includes(s.id)),
  ];

  if (sorted.length === 0) {
    feed.innerHTML = '<p style="color:var(--color-slate);text-align:center;padding:24px;">No signals match current filters.</p>';
    return;
  }

  feed.innerHTML = sorted.map(story => {
    const cardClass   = ['signal-card', 'fade-in'];
    if (story.featured)     cardClass.push('featured');
    if (story.rank === 1)   cardClass.push('top-signal');
    if (!readIds.has(story.id)) cardClass.push('unread');

    const isPinned     = pinnedIds.includes(story.id);
    const sourceDisplay= story.source || 'Unknown';
    const storyTags    = story.tags || [];
    const cardTagsHTML = storyTags.length
      ? `<div class="card-tags">${storyTags.map(t => `<span class="tag-chip ${TAG_COLORS[t] || ''}">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="${cardClass.join(' ')}" data-id="${escapeHtml(story.id)}" onclick="openBriefing('${escapeHtml(story.id)}')">
        <div class="card-header">
          ${!readIds.has(story.id) ? '<span class="unread-dot"></span>' : ''}
          <div class="card-rank">#${story.rank}</div>
          <div class="card-headline">${highlightMatch(story.headline || story.title, searchQuery)}</div>
          <div class="card-time">${timeAgo(story.firstSeenAt || story.published_at)}</div>
        </div>
        <div class="card-meta">
          <span class="card-source">${escapeHtml(sourceDisplay)}</span>
          <span class="source-count">${story.sourceCount || story.source_count || 1} SOURCES</span>
        </div>
        ${cardTagsHTML}
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openBriefing('${escapeHtml(story.id)}')">OPEN BRIEFING</button>
          <button class="btn btn-ghost btn-sm ${isPinned ? 'btn-pinned' : ''}" onclick="event.stopPropagation();pinSignal('${escapeHtml(story.id)}')">${isPinned ? 'UNPIN' : 'PIN SIGNAL'}</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderSystemStatus() {
  const container = document.getElementById('system-status');
  const systems = [
    { label: 'Ingestion',  value: systemState.ingestion  || 'unknown' },
    { label: 'Clustering', value: systemState.clustering || 'unknown' },
    { label: 'Ranking',    value: systemState.ranking    || 'unknown' },
    { label: 'API',        value: systemState.apiStatus  || 'unknown' },
  ];
  container.innerHTML = systems.map(sys => `
    <div class="status-row">
      <span class="status-label">${sys.label}</span>
      <span class="badge ${statusClass(sys.value)}">${sys.value.toUpperCase()}</span>
    </div>
  `).join('');
}

function renderSourceHealth() {
  const container = document.getElementById('source-health');
  const displaySources = sources.slice(0, 10);
  container.innerHTML = `
    <div class="source-list">
      ${displaySources.map(src => `
        <div class="source-item">
          <span class="source-name">${escapeHtml(src.name)}</span>
          <span class="source-status">
            <span class="badge ${statusClass(src.status)}" style="padding:2px 6px;">${src.status.toUpperCase()}</span>
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Filter Bar Render ───────────────────────────────────

function renderFilterBar() {
  // Topic pills — populated from live stories
  const topicContainer = document.getElementById('filter-topic-pills');
  if (topicContainer) {
    const allTags = new Set();
    stories.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));
    topicContainer.innerHTML = Array.from(allTags).map(tag => {
      const isActive = activeFilters.tags.includes(tag);
      return `<span class="filter-pill ${isActive ? 'active' : ''}" onclick="toggleTagFilter('${escapeHtml(tag)}')">${escapeHtml(tag)}</span>`;
    }).join('');
  }

  // Time pills — update active state
  [0, 60, 360, 1440].forEach(v => {
    const el = document.getElementById(`fp-time-${v}`);
    if (el) el.classList.toggle('active', activeFilters.timeRange === v);
  });

  // Source pills — update active state
  [0, 2, 3, 4].forEach(v => {
    const el = document.getElementById(`fp-src-${v}`);
    if (el) el.classList.toggle('active', activeFilters.minSources === v);
  });

  // Active chips row
  const chipsRow = document.getElementById('active-chips-row');
  if (!chipsRow) return;

  const chips = [];
  activeFilters.tags.forEach(tag => {
    chips.push(`<span class="active-chip">${escapeHtml(tag)}<span class="chip-x" onclick="toggleTagFilter('${escapeHtml(tag)}')">&#x2715;</span></span>`);
  });
  if (activeFilters.timeRange > 0) {
    const labels = { 60: '< 1H', 360: '< 6H', 1440: '< 24H' };
    chips.push(`<span class="active-chip">TIME: ${labels[activeFilters.timeRange]}<span class="chip-x" onclick="setTimeFilter(0)">&#x2715;</span></span>`);
  }
  if (activeFilters.minSources > 0) {
    chips.push(`<span class="active-chip">SOURCES: ${activeFilters.minSources}+<span class="chip-x" onclick="setSourceFilter(0)">&#x2715;</span></span>`);
  }

  const hasActive = chips.length > 0;
  chipsRow.style.display = hasActive ? 'flex' : 'none';

  if (hasActive) {
    const filtered = filterStories(stories);
    const total    = stories.filter(s => !mutedSources.includes(s.source)).length;
    chipsRow.innerHTML = `
      <span class="filter-active-label">ACTIVE:</span>
      ${chips.join('')}
      <span class="filter-count">${filtered.length} of ${total} signals</span>
      <button class="filter-clear-all" onclick="clearFilters()">CLEAR ALL</button>
    `;
  }
}

// ── Color Theme ─────────────────────────────────────────

const COLOR_THEMES = {
  green:  { accent: '#35ff7a', deep: '#1f8f4a' },
  white:  { accent: '#e2e8e2', deep: '#8a9490' },
  purple: { accent: '#c084fc', deep: '#7c3aed' },
  indigo: { accent: '#818cf8', deep: '#4338ca' },
  blue:   { accent: '#38bdf8', deep: '#0369a1' },
  amber:  { accent: '#fbbf24', deep: '#92400e' },
};

function applyTheme(name) {
  const t = COLOR_THEMES[name] || COLOR_THEMES.green;
  document.documentElement.style.setProperty('--color-green', t.accent);
  document.documentElement.style.setProperty('--color-deep-green', t.deep);
  localStorage.setItem('rollup_theme', name);
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('selected', el.dataset.theme === name);
  });
}

function loadSavedTheme() {
  const saved = localStorage.getItem('rollup_theme') || 'green';
  applyTheme(saved);
}

function renderCoverageTheater() {
  const container = document.getElementById('coverage-theater');
  const allTags   = new Set();
  stories.forEach(s => (s.tags || []).forEach(tag => allTags.add(tag)));

  if (allTags.size === 0) {
    container.innerHTML = '<p style="color:var(--color-slate);font-size:12px;">No tags available</p>';
    return;
  }
  container.innerHTML = `
    <div class="tag-pills">
      ${Array.from(allTags).map(tag => {
        const isActive = activeFilters.tags.includes(tag);
        return `<span class="tag-pill ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}" onclick="toggleTagFilter('${escapeHtml(tag)}')">${escapeHtml(tag)}</span>`;
      }).join('')}
    </div>
  `;
}

// ── Briefing Modal ──────────────────────────────────────

async function openBriefing(id) {
  const modal   = document.getElementById('briefing-modal');
  const content = document.getElementById('briefing-content');

  modal.style.display = 'flex';
  content.innerHTML   = '<p style="color:var(--color-slate);">Loading briefing&hellip;</p>';

  // Mark as read
  markRead(id);
  renderFeed();

  // Update URL to permalink (Task 19)
  const localStory = stories.find(s => s.id === id);
  if (localStory) updateURLForStory(localStory);

  const story = await fetchStoryDetail(id);
  if (!story) {
    content.innerHTML = '<p style="color:var(--color-warning);">Story not found.</p>';
    return;
  }

  const headline      = story.headline || story.title;
  const summary       = story.summary  || story.body || 'No summary available.';
  const sourceDisplay = story.source   || 'Unknown';
  const sourceCount   = story.sourceCount || story.source_count || 1;
  const firstSeen     = timeAgo(story.firstSeenAt || story.published_at);
  const tags          = story.tags || [];
  const rankReason    = story.rankReason || story.rank_reason || 'Signal ranked by freshness and source diversity.';
  const extractNote   = story.extraction_note || '';
  const loc           = story.source_location || null;

  // Task 8: Signal strength label
  const strength = signalStrength(story.confidence || 0);

  // Rank reason segments
  const reasonSegs    = rankReason.split('·').map(s => s.trim()).filter(Boolean);
  const reasonHTML    = reasonSegs.map(seg => `<span class="rank-segment">${escapeHtml(seg)}</span>`).join('');

  // Tag chips
  const tagsHTML = tags.length
    ? tags.map(t => `<span class="tag-chip ${TAG_COLORS[t] || ''}">${escapeHtml(t)}</span>`).join('')
    : '<span style="color:var(--color-slate);font-size:12px;">Unclassified</span>';

  // Task 13: Corroborating sources
  const corr = story.corroborating_sources || [];
  const corrHTML = corr.length > 0
    ? corr.map(s => `<span class="corr-source">${escapeHtml(s)}</span>`).join('')
    : '<span style="color:var(--color-slate);font-size:12px;">No corroborating sources found</span>';

  // Task 14: Globe HTML
  const locCoords = loc
    ? `${Math.abs(loc.lat).toFixed(4)}°${loc.lat >= 0 ? 'N' : 'S'}\u00a0\u00a0${Math.abs(loc.lon).toFixed(4)}°${loc.lon >= 0 ? 'E' : 'W'}`
    : '';
  const globeHTML = loc ? `
    <div class="globe-container">
      <div class="briefing-label" style="margin-bottom:10px;">SIGNAL ORIGIN:</div>
      <div class="globe-wrap">
        <canvas id="briefing-globe" style="width:320px;height:320px;"></canvas>
      </div>
      <div class="globe-coords">${locCoords}</div>
      <div class="globe-address">${escapeHtml(loc.address)}</div>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="briefing-headline">${escapeHtml(headline)}</div>
    <div class="briefing-divider"></div>

    <div class="briefing-section">
      <div class="briefing-label">SIGNAL RANKING:</div>
      <div class="rank-reason-row">${reasonHTML}</div>
    </div>

    <div class="briefing-section">
      <div class="briefing-label">SOURCE:</div>
      <div class="briefing-value">${escapeHtml(sourceDisplay)} &nbsp;&middot;&nbsp; ${sourceCount} outlet${sourceCount === 1 ? '' : 's'} confirming</div>
    </div>

    <div class="briefing-section">
      <div class="briefing-label">SOURCES CORROBORATING:</div>
      <div class="corr-sources-row">${corrHTML}</div>
    </div>

    <div class="briefing-section">
      <div class="briefing-label">FIRST SIGNAL:</div>
      <div class="briefing-value">${firstSeen}</div>
    </div>

    <div class="briefing-section">
      <div class="briefing-label">TAGS:</div>
      <div class="tag-chip-row">${tagsHTML}</div>
    </div>

    <div class="briefing-divider"></div>

    <div class="briefing-section">
      <div class="briefing-label">SUMMARY:</div>
      <div class="briefing-summary">${renderSummary(summary)}</div>
      ${extractNote ? `<div class="extraction-note">&#9888; ${escapeHtml(extractNote)}</div>` : ''}
    </div>

    <div class="briefing-actions">
      <button class="btn btn-primary"    onclick="closeBriefing()">CLOSE</button>
      <button class="btn btn-ghost"      onclick="muteSource('${escapeHtml(sourceDisplay)}')">MUTE SOURCE</button>
      <button class="btn btn-ghost btn-export" onclick="exportReport('${escapeHtml(story.id || id)}')">EXPORT REPORT</button>
    </div>

    ${globeHTML}
  `;

  // Task 14: Boot the globe after DOM is ready
  // 200ms gives the browser time to compute layout so canvas.offsetWidth is non-zero
  if (loc) {
    setTimeout(() => initGlobe('briefing-globe', loc.lat, loc.lon, loc.address), 200);
  }
}

function renderSummary(raw) {
  if (!raw) return '<span style="color:var(--color-slate)">No summary available.</span>';

  // Strip attribution line
  const attrMatch  = raw.match(/\n\n(Source:.+)$/s);
  const attribution= attrMatch ? attrMatch[1] : '';
  const body       = attrMatch ? raw.slice(0, attrMatch.index) : raw;

  // Split lead from Key Points
  const kpSplit  = body.split(/\n\nKey Points:\n/);
  const lead     = kpSplit[0] || '';
  const kpSection= kpSplit[1] || '';

  const bullets = kpSection
    .split(/\n/)
    .map(s => s.replace(/^•\s*/, '').trim())
    .filter(Boolean);

  let html = `<p class="summary-lead">${escapeHtml(lead)}</p>`;
  if (bullets.length) {
    html += `<div class="key-points-box">
      <div class="kp-header">KEY POINTS</div>
      ${bullets.map(b => `
        <div class="kp-item">
          <span class="kp-dot">•</span>
          <span class="kp-text">${escapeHtml(b)}</span>
        </div>`).join('')}
    </div>`;
  }
  if (attribution) {
    html += `<p class="summary-attribution">${escapeHtml(attribution)}</p>`;
  }
  return html;
}

function closeBriefing() {
  document.getElementById('briefing-modal').style.display = 'none';
  stopGlobe();
  clearURLHash();
}

// ── Auto-Refresh Countdown (Task 16) ───────────────────

function startRefreshCountdown() {
  _lastRefreshAt = Date.now();
  let secs = REFRESH_INTERVAL_SECS;
  if (window._countdownTimer) clearInterval(window._countdownTimer);
  window._countdownTimer = setInterval(() => {
    secs--;
    if (secs < 0) secs = REFRESH_INTERVAL_SECS;
    const el = document.getElementById('refresh-countdown');
    if (el) el.textContent = secs + 's';
    const lr = document.getElementById('last-refresh');
    if (lr) lr.textContent = timeAgo(new Date(_lastRefreshAt).toISOString());
  }, 1000);
}

function flashStatusGreen() {
  const dot = document.getElementById('status-dot');
  if (!dot) return;
  dot.classList.add('flash-green');
  setTimeout(() => dot.classList.remove('flash-green'), 900);
}

// ── Main Refresh Cycle ──────────────────────────────────

function startRefreshCycle() {
  startRefreshCountdown();
  setInterval(async () => {
    await refresh();
  }, REFRESH_INTERVAL_SECS * 1000);
}

async function refresh() {
  await fetchSystemState();
  await fetchStories();
  renderHeader();
  renderFeed();
  renderFilterBar();
  renderSystemStatus();
  renderSourceHealth();
  renderCoverageTheater();
  _lastRefreshAt = Date.now();
  startRefreshCountdown();
  flashStatusGreen();
}

// ── Initialize ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved color theme before first render
  loadSavedTheme();

  // Set filter bar sticky offset to sit just below the header
  const setFilterTop = () => {
    const hdr = document.getElementById('site-header');
    const bar = document.getElementById('filter-bar');
    if (hdr && bar) bar.style.top = hdr.offsetHeight + 'px';
  };
  setFilterTop();
  window.addEventListener('resize', setFilterTop);

  await refresh();
  startRefreshCycle();

  // Task 19: Auto-open story from URL hash on page load
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('signal-')) {
    const match = stories.find(s => storyToHash(s) === hash);
    if (match) openBriefing(match.id);
  }
});
