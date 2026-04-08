// ── Dashboard State ─────────────────────────────────────

let stories = [];
let systemState = {};
let sources = [];

// ── API Endpoints ───────────────────────────────────────

const API_BASE = 'https://projectrollup.onrender.com'; // Backend API URL
const USE_MOCK = false; // Set to true to use mock data instead of API

async function fetchStories() {
  if (USE_MOCK) {
    stories = MOCK_STORIES;
    console.log('Using mock data:', stories.length, 'stories');
    return;
  }
  try {
    console.log('Fetching from:', `${API_BASE}/api/stories`);
    const res = await fetch(`${API_BASE}/api/stories`);
    console.log('Response status:', res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log('API response:', data);
    stories = data.stories || [];
    console.log('Loaded stories:', stories.length);
  } catch (err) {
    console.error('Failed to fetch stories, falling back to mock:', err);
    stories = MOCK_STORIES;
    console.log('Fallback to mock:', stories.length, 'stories');
  }
}

async function fetchSystemState() {
  if (USE_MOCK) {
    systemState = SYSTEM_STATE;
    sources = MOCK_SOURCES;
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    systemState = {
      missionStatus: data.status || 'green',
      lastRefresh: data.last_update || new Date().toISOString(),
      sourcesPolled: data.sources_polled || 0,
      healthySources: data.healthy_sources || 0,
      failedSources: data.failed_sources || 0,
      ingestion: data.ingestion || 'green',
      clustering: data.clustering || 'green',
      ranking: data.ranking || 'green',
      apiStatus: 'green',
    };
    sources = data.sources || MOCK_SOURCES;
  } catch (err) {
    console.error('Failed to fetch system state, falling back to mock:', err);
    systemState = SYSTEM_STATE;
    sources = MOCK_SOURCES;
  }
}

async function fetchStoryDetail(id) {
  if (USE_MOCK) {
    return MOCK_STORIES.find(s => s.id === id);
  }
  const localStory = stories.find(s => s.id === id);
  const headline = localStory?.headline || localStory?.title;
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

// ── Render Functions ────────────────────────────────────

function renderHeader() {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('mission-status-text');
  const lastRefresh = document.getElementById('last-refresh');
  const sourceCount = document.getElementById('source-count');
  const healthyCount = document.getElementById('healthy-count');
  const failedCount = document.getElementById('failed-count');

  const status = systemState.missionStatus || 'green';
  statusDot.className = 'live-dot';
  if (status === 'amber' || status === 'degraded') statusDot.classList.add('amber');
  if (status === 'red' || status === 'failed') statusDot.classList.add('red');

  statusText.textContent = `MISSION STATUS: ${status.toUpperCase()}`;
  lastRefresh.textContent = timeAgo(systemState.lastRefresh || new Date().toISOString());
  sourceCount.textContent = systemState.sourcesPolled || '—';
  healthyCount.textContent = systemState.healthySources || '—';
  failedCount.textContent = systemState.failedSources || '—';
}

function renderFeed() {
  const feed = document.getElementById('feed');
  if (!feed) {
    console.error('Feed container #feed not found in DOM');
    return;
  }
  
  const filtered = filterStories(stories);
  console.log('Rendering feed with', filtered.length, 'filtered stories');

  if (filtered.length === 0) {
    console.warn('No stories to display');
    feed.innerHTML = '<p style="color: var(--color-slate); text-align: center; padding: 24px;">No signals match current filters.</p>';
    return;
  }

  feed.innerHTML = filtered.map(story => {
    const cardClass = ['signal-card', 'fade-in'];
    if (story.featured) cardClass.push('featured');
    if (story.rank === 1) cardClass.push('top-signal');

    const sourceDisplay = story.repSource?.name || story.source || 'Unknown';
    const confPercent = Math.round((story.confidence || 0) * 100);
    const confBarColor = confColor(story.confidence || 0);

    return `
      <div class="${cardClass.join(' ')}" data-id="${escapeHtml(story.id)}" onclick="openBriefing('${escapeHtml(story.id)}')">
        <div class="card-header">
          <div class="card-rank">#${story.rank}</div>
          <div class="card-headline">${escapeHtml(story.headline || story.title)}</div>
          <div class="card-time">${timeAgo(story.firstSeenAt || story.published_at)}</div>
        </div>
        <div class="card-meta">
          <span class="card-source">${escapeHtml(sourceDisplay)}</span>
          <span class="source-count">${story.sourceCount || story.source_count || 1} SOURCES</span>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width: ${confPercent}%; background: ${confBarColor};"></div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openBriefing('${escapeHtml(story.id)}')">OPEN BRIEFING</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); pinSignal('${escapeHtml(story.id)}')">PIN SIGNAL</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderSystemStatus() {
  const container = document.getElementById('system-status');
  const systems = [
    { label: 'Ingestion', value: systemState.ingestion || 'unknown' },
    { label: 'Clustering', value: systemState.clustering || 'unknown' },
    { label: 'Ranking', value: systemState.ranking || 'unknown' },
    { label: 'API', value: systemState.apiStatus || 'unknown' },
  ];

  container.innerHTML = systems.map(sys => {
    const badgeClass = statusClass(sys.value);
    return `
      <div class="status-row">
        <span class="status-label">${sys.label}</span>
        <span class="badge ${badgeClass}">${sys.value.toUpperCase()}</span>
      </div>
    `;
  }).join('');
}

function renderSourceHealth() {
  const container = document.getElementById('source-health');
  const displaySources = sources.slice(0, 10); // Show top 10

  container.innerHTML = `
    <div class="source-list">
      ${displaySources.map(src => {
        const dotClass = statusClass(src.status);
        return `
          <div class="source-item">
            <span class="source-name">${escapeHtml(src.name)}</span>
            <span class="source-status">
              <span class="badge ${dotClass}" style="padding: 2px 6px;">${src.status.toUpperCase()}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderCoverageTheater() {
  const container = document.getElementById('coverage-theater');
  const allTags = new Set();
  stories.forEach(s => {
    (s.tags || []).forEach(tag => allTags.add(tag));
  });

  if (allTags.size === 0) {
    container.innerHTML = '<p style="color: var(--color-slate); font-size: 12px;">No tags available</p>';
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
  const modal = document.getElementById('briefing-modal');
  const content = document.getElementById('briefing-content');

  modal.style.display = 'flex';
  content.innerHTML = '<p style="color: var(--color-slate);">Loading briefing...</p>';

  const story = await fetchStoryDetail(id);
  if (!story) {
    content.innerHTML = '<p style="color: var(--color-warning);">Story not found.</p>';
    return;
  }

  const headline = story.headline || story.title;
  const summary = story.summary || story.body || 'No summary available.';
  const sourceDisplay = story.repSource?.name || story.source || 'Unknown';
  const sourceCount = story.sourceCount || story.source_count || 1;
  const confPercent = Math.round((story.confidence || 0) * 100);
  const firstSeen = timeAgo(story.firstSeenAt || story.published_at);
  const tags = (story.tags || []).join(', ') || 'None';
  const rankReason = story.rankReason || story.rank_reason || 'Not specified.';

  content.innerHTML = `
    <div class="briefing-headline">${escapeHtml(headline)}</div>
    <div class="briefing-divider"></div>
    <div class="briefing-section">
      <div class="briefing-label">WHY RANKED HERE:</div>
      <div class="briefing-value">${escapeHtml(rankReason)}</div>
    </div>
    <div class="briefing-section">
      <div class="briefing-label">REPRESENTATIVE SOURCE:</div>
      <div class="briefing-value">${escapeHtml(sourceDisplay)}</div>
    </div>
    <div class="briefing-section">
      <div class="briefing-label">SOURCE COUNT:</div>
      <div class="briefing-value">${sourceCount} outlets confirming</div>
    </div>
    <div class="briefing-section">
      <div class="briefing-label">CONFIDENCE:</div>
      <div class="briefing-value">${confPercent}%</div>
    </div>
    <div class="briefing-section">
      <div class="briefing-label">FIRST SIGNAL:</div>
      <div class="briefing-value">${firstSeen}</div>
    </div>
    <div class="briefing-section">
      <div class="briefing-label">TAGS:</div>
      <div class="briefing-value">${escapeHtml(tags)}</div>
    </div>
    <div class="briefing-divider"></div>
    <div class="briefing-section">
      <div class="briefing-label">SUMMARY:</div>
      <div class="briefing-value">${escapeHtml(summary)}</div>
    </div>
    <div class="briefing-actions">
      <button class="btn btn-primary" onclick="closeBriefing()">CLOSE</button>
      <button class="btn btn-ghost" onclick="muteSource('${escapeHtml(sourceDisplay)}')">MUTE SOURCE</button>
      <button class="btn btn-ghost" onclick="exportReport('${escapeHtml(story.id)}')">EXPORT REPORT</button>
    </div>
  `;
}

function closeBriefing() {
  document.getElementById('briefing-modal').style.display = 'none';
}

function pinSignal(id) {
  console.log('Pin signal:', id);
  alert(`Signal #${id} pinned (feature not yet implemented)`);
}

function muteSource(sourceName) {
  console.log('Mute source:', sourceName);
  alert(`Source "${sourceName}" muted (feature not yet implemented)`);
}

function exportReport(id) {
  console.log('Export report:', id);
  alert(`Export report for #${id} (feature not yet implemented)`);
}

// ── Refresh Cycle ───────────────────────────────────────

function startRefreshCycle() {
  setInterval(() => {
    renderHeader(); // Update timestamps
  }, 60000); // Every 60 seconds
}

async function refresh() {
  console.log('=== REFRESH START ===');
  await fetchSystemState();
  console.log('System state loaded:', systemState);
  await fetchStories();
  console.log('Stories loaded:', stories.length);
  renderHeader();
  console.log('Header rendered');
  renderFeed();
  console.log('Feed rendered');
  renderSystemStatus();
  console.log('System status rendered');
  renderSourceHealth();
  console.log('Source health rendered');
  renderCoverageTheater();
  console.log('Coverage theater rendered');
  console.log('=== REFRESH COMPLETE ===');
}

// ── Initialize ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await refresh();
  startRefreshCycle();
});
