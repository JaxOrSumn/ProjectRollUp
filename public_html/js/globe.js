// ── High-Resolution Globe Renderer ─────────────────────────────────────────
// Powered by D3-geo (orthographic projection) + world-atlas 50m GeoJSON data
// Loaded via CDN — d3-geo and topojson-client must be in index.html before this file
// CRT-green aesthetic, Retina/HiDPI aware

let _globeInstance = null;
let _worldCache    = null; // Cached after first fetch — no repeated network calls

// ── World data loader ───────────────────────────────────────────────────────

async function loadWorldData() {
  if (_worldCache) return _worldCache;

  try {
    const res  = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const topo = await res.json();
    _worldCache = {
      land:      topojson.feature(topo, topo.objects.land),
      countries: topojson.feature(topo, topo.objects.countries),
      borders:   topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b),
    };
  } catch (err) {
    console.warn('[Globe] Could not load world-atlas data:', err);
    _worldCache = { land: null, countries: null, borders: null };
  }
  return _worldCache;
}

// ── Renderer class ──────────────────────────────────────────────────────────

class GlobeRenderer {
  constructor(canvas, lat, lon, address, world) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.targetLat  = lat;
    this.targetLon  = lon;
    this.address    = address || '';
    this.world      = world;
    this.frame      = 0;
    this.animId     = null;
    this.spinAngle  = 0;

    const dpr = window.devicePixelRatio || 1;
    this.W = canvas.width  / dpr;
    this.H = canvas.height / dpr;

    const radius = Math.min(this.W, this.H) / 2 - 16;
    const cx     = this.W / 2;
    const cy     = this.H / 2;

    this.projection = d3.geoOrthographic()
      .scale(radius)
      .translate([cx, cy])
      .clipAngle(88)       // 88° avoids self-intersecting closure paths at the exact horizon
      .precision(0.3);

    this.projection.rotate([-lon, -lat]);

    this.path = d3.geoPath(this.projection, this.ctx);

    this.graticule = d3.geoGraticule().step([30, 30])(); // 30° steps — far less pole convergence

    this.equator = {
      type: 'LineString',
      coordinates: Array.from({ length: 361 }, (_, i) => [i - 180, 0]),
    };
  }

  draw() {
    const { ctx, projection, path, W, H, world } = this;
    const cx  = W / 2;
    const cy  = H / 2;
    const rad = Math.min(W, H) / 2 - 16;

    ctx.clearRect(0, 0, W, H);

    // ── Clip all geo drawing to the sphere circle ─────────────────────────────
    // This hides any D3 clipping-boundary artifacts at the horizon edge
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.clip();

    // 1. Ocean — dark near-black fill inside the sphere
    ctx.fillStyle = '#050e05';
    ctx.fillRect(0, 0, W, H);

    // 2. Land fill — very translucent green tint; evenodd handles interior rings
    if (world?.land) {
      path(world.land);
      ctx.fillStyle = 'rgba(53,255,122,0.12)';
      ctx.fill('evenodd');
    }

    // 3. Coastlines — opaque, dominant stroke that defines continent shapes
    if (world?.land) {
      path(world.land);
      ctx.strokeStyle = 'rgba(53,255,122,0.90)';
      ctx.lineWidth   = 0.8;
      ctx.stroke();
    }

    ctx.restore(); // ── End sphere clip ───────────────────────────────────────

    // 4. Globe border ring — sits on top of the clipped area
    path({ type: 'Sphere' });
    ctx.strokeStyle = 'rgba(53,255,122,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // 5. Atmospheric glow
    const grd = ctx.createRadialGradient(cx, cy, rad, cx, cy, rad + 10);
    grd.addColorStop(0, 'rgba(53,255,122,0.12)');
    grd.addColorStop(1, 'rgba(53,255,122,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, rad + 9, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // 6. GPS pin
    this._drawPin();

    // Advance state
    this.frame++;
    this.spinAngle += 0.035;
    projection.rotate([-this.targetLon + this.spinAngle, -this.targetLat]);
  }

  _drawPin() {
    const { ctx, projection } = this;

    const pt = projection([this.targetLon, this.targetLat]);
    if (!pt) return;

    const [px, py] = pt;

    // Outer pulse ring
    const pulse = (this.frame % 90) / 90;
    const pr    = 8 + pulse * 24;
    const pa    = 0.55 * (1 - pulse);
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(53,255,122,${pa.toFixed(3)})`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Middle ring
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(53,255,122,0.70)';
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    // Core dot
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle   = '#35ff7a';
    ctx.shadowColor = 'rgba(53,255,122,1)';
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Crosshair arms
    ctx.strokeStyle = 'rgba(53,255,122,0.60)';
    ctx.lineWidth   = 1;
    const arm = 18, gap = 8;
    ctx.beginPath();
    ctx.moveTo(px - arm, py); ctx.lineTo(px - gap, py);
    ctx.moveTo(px + gap, py); ctx.lineTo(px + arm, py);
    ctx.moveTo(px, py - arm); ctx.lineTo(px, py - gap);
    ctx.moveTo(px, py + gap); ctx.lineTo(px, py + arm);
    ctx.stroke();
  }

  animate() {
    this.draw();
    this.animId = requestAnimationFrame(() => this.animate());
  }

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
}

// ── Loading placeholder ─────────────────────────────────────────────────────

function _drawLoadingGlobe(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width  / dpr;
  const H    = canvas.height / dpr;
  const cx   = W / 2;
  const cy   = H / 2;
  const r    = Math.min(W, H) / 2 - 16;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#030a03';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(53,255,122,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.font      = '11px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = 'rgba(53,255,122,0.50)';
  ctx.textAlign = 'center';
  ctx.fillText('LOADING MAP DATA...', cx, cy - 8);
  ctx.font      = '10px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = 'rgba(53,255,122,0.30)';
  ctx.fillText('world-atlas 50m', cx, cy + 10);
}

// ── Error fallback drawn directly onto the canvas ───────────────────────────

function _drawErrorGlobe(canvas, message) {
  const dpr = window.devicePixelRatio || 1;
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width  / dpr;
  const H    = canvas.height / dpr;
  const cx   = W / 2;
  const cy   = H / 2;
  const r    = Math.min(W, H) / 2 - 16;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#030a03';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,90,90,0.45)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.font      = '11px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = 'rgba(255,90,90,0.70)';
  ctx.textAlign = 'center';
  ctx.fillText('GLOBE UNAVAILABLE', cx, cy - 8);
  ctx.font      = '9px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = 'rgba(255,90,90,0.40)';
  ctx.fillText(message || 'renderer error', cx, cy + 10);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise and animate the globe on the given canvas.
 * @param {string} canvasId  ID of the <canvas> element
 * @param {number} lat       Target latitude  (decimal degrees)
 * @param {number} lon       Target longitude (decimal degrees)
 * @param {string} address   Address label shown beneath the globe
 */
async function initGlobe(canvasId, lat, lon, address) {
  stopGlobe();

  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn('[Globe] Canvas not found:', canvasId);
    return;
  }

  // ── Retina / HiDPI setup ────────────────────────────
  const dpr  = window.devicePixelRatio || 1;
  // canvas.offsetWidth may be 0 during layout; fall back to inline style then 320
  const rawW = canvas.offsetWidth;
  const size = (rawW > 0 ? rawW : null)
             || parseInt(canvas.getAttribute('width') || '', 10)
             || parseInt((canvas.style.width || '').replace('px', ''), 10)
             || 320;

  canvas.width        = size * dpr;
  canvas.height       = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset any accumulated transforms
  ctx.scale(dpr, dpr);

  // ── Guard: D3 and TopoJSON must be available ─────────
  const d3Missing = typeof d3 === 'undefined'
    || typeof d3.geoOrthographic !== 'function'
    || typeof d3.geoPath         !== 'function'
    || typeof d3.geoGraticule    !== 'function';

  if (d3Missing) {
    console.error('[Globe] D3 v7 UMD bundle is not loaded. Ensure index.html loads https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js BEFORE globe.js.');
    _drawErrorGlobe(canvas, 'd3 v7 not loaded');
    return;
  }
  if (typeof topojson === 'undefined' || typeof topojson.feature !== 'function') {
    console.error('[Globe] topojson-client is not loaded. Check CDN script tags in index.html.');
    _drawErrorGlobe(canvas, 'topojson not loaded');
    return;
  }

  // Show loading state immediately while map data fetches
  _drawLoadingGlobe(canvas);

  // Fetch high-res world data (cached after first load)
  let world;
  try {
    world = await loadWorldData();
  } catch (err) {
    console.error('[Globe] loadWorldData failed:', err);
    world = { land: null, countries: null, borders: null };
  }

  // Abort if globe was stopped or modal closed while loading
  if (!document.getElementById(canvasId)) return;

  // ── Boot renderer ─────────────────────────────────────
  try {
    _globeInstance = new GlobeRenderer(canvas, lat, lon, address, world);
    _globeInstance.animate();
  } catch (err) {
    console.error('[Globe] GlobeRenderer failed to start:', err);
    _drawErrorGlobe(canvas, err.message || 'renderer error');
  }
}

/** Stop any active globe animation and release the instance. */
function stopGlobe() {
  if (_globeInstance) {
    _globeInstance.stop();
    _globeInstance = null;
  }
}
