// ── Utility Functions ───────────────────────────────────

function timeAgo(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return 'Unknown';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// Task 8: Map confidence score to STRONG / MODERATE / WEAK
function signalStrength(confidence) {
  if (confidence >= 0.75) return { label: 'STRONG',   cls: 'strength-strong'   };
  if (confidence >= 0.5)  return { label: 'MODERATE', cls: 'strength-moderate' };
  return                         { label: 'WEAK',     cls: 'strength-weak'     };
}

// Task 8: Updated confidence bar colour to match strength tiers
function confColor(conf) {
  if (conf >= 0.75) return 'var(--color-green)';
  if (conf >= 0.5)  return 'var(--color-gold)';
  return 'var(--color-warning)';
}

function statusClass(status) {
  if (status === 'green')                        return 'badge-green';
  if (status === 'amber' || status === 'degraded') return 'badge-amber';
  if (status === 'red'   || status === 'failed')   return 'badge-red';
  return 'badge-slate';
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}
