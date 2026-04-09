// ── Globe Renderer — Pure Canvas Orthographic Projection ──────────────────
// CRT-green aesthetic. Zero external dependencies.

// Simplified continent outlines as [lat, lon] arrays
const GLOBE_LAND = [
  // North America
  [[72,-140],[70,-130],[68,-136],[66,-140],[65,-168],[60,-165],[55,-163],[54,-130],
   [52,-131],[50,-127],[48,-124],[46,-124],[40,-124],[36,-122],[32,-117],[28,-110],
   [25,-110],[22,-106],[20,-105],[18,-103],[16,-97],[14,-93],[14,-87],[15,-83],
   [17,-83],[20,-87],[22,-90],[22,-97],[24,-105],[28,-110],[32,-117],[38,-76],
   [40,-74],[42,-70],[44,-66],[46,-60],[50,-56],[52,-56],[55,-60],[58,-62],
   [60,-64],[62,-68],[64,-72],[66,-75],[68,-78],[70,-80],[72,-80],[74,-82],
   [76,-85],[78,-90],[76,-96],[74,-100],[72,-106],[70,-110],[68,-120],[66,-128],
   [66,-140],[70,-130],[72,-140]],
  // Greenland
  [[60,-44],[63,-50],[65,-52],[68,-54],[70,-55],[72,-54],[74,-52],[76,-46],
   [78,-40],[80,-36],[82,-30],[83,-22],[82,-16],[80,-14],[78,-18],[76,-22],
   [74,-22],[72,-24],[70,-26],[68,-30],[66,-36],[64,-40],[62,-42],[60,-44]],
  // South America
  [[-5,-77],[-5,-72],[-10,-69],[-15,-69],[-18,-70],[-22,-70],[-25,-70],
   [-30,-71],[-35,-71],[-40,-72],[-45,-73],[-50,-74],[-55,-70],[-57,-65],
   [-55,-64],[-50,-68],[-45,-65],[-40,-62],[-35,-56],[-30,-50],[-25,-48],
   [-20,-40],[-15,-39],[-10,-37],[-5,-35],[-3,-41],[-2,-45],[0,-50],[2,-52],
   [3,-51],[5,-52],[7,-58],[5,-60],[3,-60],[2,-58],[0,-50],[0,-65],[0,-75],
   [-5,-77]],
  // Europe
  [[70,25],[68,20],[65,15],[60,5],[57,8],[53,5],[50,3],[48,5],[46,7],[44,10],
   [42,13],[40,15],[38,16],[37,15],[36,14],[36,5],[38,0],[40,-4],[43,-9],
   [44,-9],[47,-2],[48,2],[50,3],[53,5],[55,8],[57,8],[58,12],[60,5],[62,6],
   [65,15],[68,20],[70,25]],
  // Scandinavia
  [[57,8],[58,5],[60,5],[62,5],[65,14],[68,16],[70,20],[71,26],[70,28],
   [68,28],[65,24],[62,22],[60,22],[58,18],[57,12],[57,8]],
  // UK + Ireland
  [[50,-5],[51,0],[52,2],[54,0],[56,-3],[58,-4],[58,-6],[56,-6],[54,-6],
   [52,-4],[50,-5]],
  // Africa
  [[37,10],[36,5],[35,2],[32,-5],[28,-13],[23,-17],[18,-17],[14,-17],[10,-15],
   [5,-3],[0,10],[0,30],[5,36],[10,43],[15,41],[20,37],[25,33],[30,32],
   [35,37],[37,10]],
  // Madagascar
  [[-14,44],[-16,44],[-18,44],[-20,44],[-22,44],[-24,44],[-25,44],[-24,46],
   [-22,48],[-20,48],[-18,48],[-16,50],[-14,50],[-14,48],[-14,44]],
  // Main Asia
  [[70,30],[72,50],[72,70],[70,100],[68,120],[65,140],[60,142],[55,135],
   [50,140],[45,138],[40,130],[35,125],[30,120],[25,115],[20,110],[15,108],
   [10,105],[5,103],[1,104],[1,114],[5,115],[10,108],[15,80],[15,73],
   [20,66],[25,56],[25,50],[28,48],[25,55],[25,70],[20,85],[15,73],
   [10,77],[8,77],[10,80],[15,80],[20,87],[25,87],[28,85],[30,80],
   [32,76],[35,72],[38,70],[40,68],[42,70],[44,72],[46,74],[50,80],
   [55,70],[60,60],[65,60],[68,58],[70,50],[72,50],[70,30]],
  // Japan
  [[31,131],[33,131],[35,133],[37,136],[38,140],[40,141],[42,142],[44,142],
   [43,141],[41,140],[39,140],[37,137],[35,136],[33,131],[31,131]],
  // Southeast Asia peninsulas
  [[5,100],[8,98],[12,100],[14,102],[15,104],[14,108],[12,109],[10,109],
   [8,104],[5,102],[5,100]],
  // Australia
  [[-15,130],[-20,120],[-25,114],[-30,115],[-35,118],[-38,125],[-38,140],
   [-37,150],[-32,153],[-28,154],[-23,152],[-20,149],[-17,146],[-15,130]],
  // New Zealand
  [[-36,174],[-38,175],[-40,176],[-42,172],[-44,170],[-46,168],[-44,170],
   [-42,172],[-40,175],[-38,178],[-36,174]],
];

let _globeInstance = null;

class GlobeRenderer {
  constructor(canvas, lat, lon, address) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.targetLat = lat * Math.PI / 180;
    this.targetLon = lon * Math.PI / 180;
    this.viewLat   = lat * Math.PI / 180;
    this.viewLon   = lon * Math.PI / 180;
    this.address   = address || '';
    // Use logical pixel size (CSS pixels, before DPR scaling)
    const logicalW = canvas.width  / (window.devicePixelRatio || 1);
    const logicalH = canvas.height / (window.devicePixelRatio || 1);
    this.radius = Math.min(logicalW, logicalH) / 2 - 14;
    this.cx     = logicalW / 2;
    this.cy     = logicalH / 2;
    this.frame  = 0;
    this.animId = null;
    this.spinOffset = 0;
  }

  project(latRad, lonRad) {
    const vLat = this.viewLat;
    const vLon = this.viewLon + this.spinOffset;
    const cosLat = Math.cos(latRad), sinLat = Math.sin(latRad);
    const cosVLat = Math.cos(vLat),  sinVLat = Math.sin(vLat);
    const dLon = lonRad - vLon;
    const dot = sinVLat * sinLat + cosVLat * cosLat * Math.cos(dLon);
    if (dot < 0) return null;
    const x = this.cx + this.radius * cosLat * Math.sin(dLon);
    const y = this.cy - this.radius * (cosVLat * sinLat - sinVLat * cosLat * Math.cos(dLon));
    return { x, y };
  }

  drawGrid() {
    const ctx = this.ctx;
    // Latitude parallels
    ctx.strokeStyle = 'rgba(53,255,122,0.12)';
    ctx.lineWidth   = 0.5;
    for (let deg = -80; deg <= 80; deg += 20) {
      const lat = deg * Math.PI / 180;
      ctx.beginPath();
      let moved = false;
      for (let d = -180; d <= 180; d += 3) {
        const p = this.project(lat, d * Math.PI / 180);
        if (!p) { moved = false; continue; }
        if (!moved) { ctx.moveTo(p.x, p.y); moved = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // Longitude meridians
    for (let deg = -180; deg < 180; deg += 20) {
      const lon = deg * Math.PI / 180;
      ctx.beginPath();
      let moved = false;
      for (let d = -90; d <= 90; d += 3) {
        const p = this.project(d * Math.PI / 180, lon);
        if (!p) { moved = false; continue; }
        if (!moved) { ctx.moveTo(p.x, p.y); moved = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // Equator — brighter
    ctx.strokeStyle = 'rgba(53,255,122,0.28)';
    ctx.lineWidth   = 0.9;
    ctx.beginPath();
    let moved = false;
    for (let d = -180; d <= 180; d += 3) {
      const p = this.project(0, d * Math.PI / 180);
      if (!p) { moved = false; continue; }
      if (!moved) { ctx.moveTo(p.x, p.y); moved = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  drawLand() {
    const ctx = this.ctx;
    for (const polygon of GLOBE_LAND) {
      ctx.beginPath();
      let moved = false;
      for (const [lat, lon] of polygon) {
        const p = this.project(lat * Math.PI / 180, lon * Math.PI / 180);
        if (!p) { moved = false; continue; }
        if (!moved) { ctx.moveTo(p.x, p.y); moved = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle   = 'rgba(53,255,122,0.07)';
      ctx.strokeStyle = 'rgba(53,255,122,0.26)';
      ctx.lineWidth   = 0.7;
      ctx.fill();
      ctx.stroke();
    }
  }

  drawPin() {
    const ctx = this.ctx;
    const p = this.project(this.targetLat, this.targetLon);
    if (!p) return;

    // Pulse ring animation
    const pulse = (this.frame % 80) / 80;
    const pr    = 7 + pulse * 20;
    const pa    = 0.6 * (1 - pulse);
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(53,255,122,${pa})`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Second ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(53,255,122,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Core dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#35ff7a';
    ctx.shadowColor = 'rgba(53,255,122,0.9)';
    ctx.shadowBlur  = 8;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Crosshair arms
    ctx.strokeStyle = 'rgba(53,255,122,0.65)';
    ctx.lineWidth   = 1;
    const cl = 15;
    ctx.beginPath();
    ctx.moveTo(p.x - cl, p.y); ctx.lineTo(p.x - 7,  p.y);
    ctx.moveTo(p.x + 7,  p.y); ctx.lineTo(p.x + cl, p.y);
    ctx.moveTo(p.x, p.y - cl); ctx.lineTo(p.x, p.y - 7);
    ctx.moveTo(p.x, p.y + 7);  ctx.lineTo(p.x, p.y + cl);
    ctx.stroke();
  }

  draw() {
    const ctx = this.ctx;
    const { canvas, cx, cy, radius } = this;
    const W = canvas.width  / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);

    // Globe sphere fill
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#050d05';
    ctx.fill();

    this.drawGrid();
    this.drawLand();
    this.drawPin();

    // Outer atmospheric glow
    const grd = ctx.createRadialGradient(cx, cy, radius - 2, cx, cy, radius + 8);
    grd.addColorStop(0, 'rgba(53,255,122,0.14)');
    grd.addColorStop(1, 'rgba(53,255,122,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Globe border ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(53,255,122,0.45)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Coordinate label at bottom
    const latDeg = (this.targetLat * 180 / Math.PI).toFixed(3);
    const lonAbs = Math.abs(this.targetLon * 180 / Math.PI).toFixed(3);
    const lonDir = this.targetLon >= 0 ? 'E' : 'W';
    ctx.font      = '10px "JetBrains Mono", "Courier New", monospace';
    ctx.fillStyle = 'rgba(53,255,122,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText(`${latDeg >= 0 ? latDeg + '°N' : Math.abs(latDeg) + '°S'}  ${lonAbs}°${lonDir}`, cx, H - 6);

    this.frame++;
    this.spinOffset += 0.004;
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

/**
 * Initialize and start a globe on the given canvas element.
 * @param {string} canvasId - ID of the <canvas> element
 * @param {number} lat      - Latitude of the target pin
 * @param {number} lon      - Longitude of the target pin
 * @param {string} address  - Address label (displayed as subtitle)
 */
function initGlobe(canvasId, lat, lon, address) {
  stopGlobe();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Hi-DPI / Retina support
  const dpr  = window.devicePixelRatio || 1;
  const size = parseInt(canvas.style.width) || canvas.offsetWidth || 260;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  _globeInstance = new GlobeRenderer(canvas, lat, lon, address);
  _globeInstance.animate();
}

/** Stop any running globe animation and free the instance. */
function stopGlobe() {
  if (_globeInstance) {
    _globeInstance.stop();
    _globeInstance = null;
  }
}
