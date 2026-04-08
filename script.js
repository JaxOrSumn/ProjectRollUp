const API_BASE = 'https://projectrollup.onrender.com';

const rowsEl = document.getElementById('rows');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');
const summaryModal = document.getElementById('summaryModal');
const summaryTitle = document.getElementById('summaryTitle');
const summaryBody = document.getElementById('summaryBody');
const summaryMeta = document.getElementById('summaryMeta');
const summaryClose = document.getElementById('summaryClose');

let items = [];
let selected = 0;
let dense = true;
let selectedStory = null;
let lastFocusedEl = null;
const locationCache = new Map();

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

function htmlesc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s,.-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function readStory(r) {
  return [r.headline, r.summary, r.snippet, r.source, r.body, r.location, r.city, r.region, r.country, r.tags].filter(Boolean).join(' ');
}
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
function renderGlobeMarker(loc) {
  const globe = document.getElementById('globeWidget');
  const status = document.getElementById('globeStatus');
  const label = document.getElementById('globeLabel');
  const marker = document.getElementById('markerDot');
  const orbit = document.getElementById('orbitPath');
  if (!globe) return;
  globe.classList.add('visible');
  status.textContent = loc.display;
  label.textContent = loc.label || 'LOCATION UNKNOWN';
  if (loc.status === 'locked' && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    const x = 80 + (loc.lon / 180) * 58;
    const y = 80 - (loc.lat / 90) * 58;
    marker.setAttribute('cx', String(x));
    marker.setAttribute('cy', String(y));
    marker.style.opacity = '1';
    orbit.style.opacity = '.55';
  } else {
    marker.style.opacity = '0';
    orbit.style.opacity = '.9';
  }
}
async function openSummary(article) {
  const title = article.headline || 'Selected headline';
  summaryTitle.textContent = title;
  summaryMeta.textContent = 'Generating fact-based summary…';
  summaryBody.textContent = 'Loading…';
  summaryModal.classList.add('open');
  summaryModal.setAttribute('aria-hidden', 'false');
  try {
    const res = await fetch(`${API_BASE}/api/story?headline=${encodeURIComponent(title)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    summaryMeta.textContent = `${data.source || article.source || 'Project RollUp'} • ${data.age_minutes ?? article.age_minutes ?? 0}m • score ${Number(data.score || 0).toFixed(3)}`;
    summaryBody.textContent = data.summary || article.summary || 'No summary available.';
  } catch (err) {
    summaryMeta.textContent = 'Summary unavailable';
    summaryBody.textContent = `Could not load summary: ${err.message}`;
  }
}
function closeSummary() {
  summaryModal.classList.remove('open');
  summaryModal.setAttribute('aria-hidden', 'true');
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
}
function render() {
  const visible = items.slice(0, dense ? 24 : 16);
  rowsEl.innerHTML = `<div class='cell muted'>#</div><div class='cell muted'>Headline</div><div class='cell muted src'>Source</div><div class='cell muted age'>Age</div><div class='cell muted count'>Src</div><div class='cell muted score'>Score</div>` + visible.map((r, i) => `
      <div class='row ${i === selected ? 'selected' : ''} story' data-i='${i}' tabindex='0' role='button' aria-label='Open headline ${htmlesc(r.headline)}'>
        <div class='cell'>${i + 1}</div>
        <div class='cell headline'>${htmlesc(r.headline)}</div>
        <div class='cell src'>${htmlesc(r.source)}</div>
        <div class='cell age'>${r.age}</div>
        <div class='cell count'>${r.source_count}</div>
        <div class='cell score'>${Number(r.score).toFixed(3)}</div>
      </div>`).join('');
  document.querySelectorAll('.row').forEach((el) => {
    el.addEventListener('click', () => {
      selected = Number(el.dataset.i);
      showDetail();
      render();
      openSummary(items[selected]);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selected = Number(el.dataset.i);
        showDetail();
        render();
        openSummary(items[selected]);
      }
    });
  });
  showDetail();
}
function showDetail() {
  const r = items[selected];
  if (!r) {
    detailEl.textContent = 'No stories loaded yet.';
    const globe = document.getElementById('globeWidget');
    if (globe) globe.classList.remove('visible');
    return;
  }
  selectedStory = r;
  const loc = inferLocation(r);
  renderGlobeMarker(loc);
  detailEl.textContent = `Headline: ${r.headline}\nSource: ${r.source}\nAge: ${r.age}\nSource count: ${r.source_count}\nScore: ${Number(r.score).toFixed(3)}\n\nWhy ranked here:\n${r.reason}\n\nOther sources:\n${(r.sources || []).join(', ')}\n\nLocation guess:\n${loc.display}`;
}
async function refresh() {
  statusEl.textContent = 'Refreshing…';
  try {
    const res = await fetch(`${API_BASE}/api/stories`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = data.items || [];
    selected = 0;
    statusEl.textContent = `${items.length} stories loaded • ${data.as_of || new Date().toISOString()}`;
    render();
  } catch (err) {
    statusEl.textContent = `Error loading stories: ${err.message}`;
    detailEl.textContent = `Could not load stories from the backend.\n\nCheck:\n- backend is running\n- API URL is correct\n- CORS is enabled if needed\n- /api/stories returns JSON`;
  }
}
window.addEventListener('wheel', (e) => {
  if (!items.length) return;
  e.preventDefault();
  selected = Math.max(0, Math.min((dense ? 24 : 16) - 1, selected + (e.deltaY > 0 ? 1 : -1)));
  render();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (summaryModal.classList.contains('open')) {
    if (e.key === 'Escape') closeSummary();
    return;
  }
  if (e.key === 'r' || e.key === 'R') refresh();
  if (e.key === 'd' || e.key === 'D') { dense = !dense; render(); }
  if (e.key === 'ArrowDown') { selected = Math.min((dense ? 24 : 16) - 1, selected + 1); render(); }
  if (e.key === 'ArrowUp') { selected = Math.max(0, selected - 1); render(); }
  if (e.key === 'Enter' && selectedStory) { lastFocusedEl = document.activeElement; openSummary(selectedStory); }
});
summaryClose?.addEventListener('click', closeSummary);
summaryModal?.addEventListener('click', (e) => {
  if (e.target === summaryModal) closeSummary();
});
document.addEventListener('click', (e) => {
  const row = e.target.closest?.('.story');
  if (!row) return;
});
refresh();
setInterval(refresh, 300000);
