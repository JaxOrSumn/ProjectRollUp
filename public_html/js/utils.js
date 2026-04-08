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

function confColor(conf) {
  if (conf >= 0.85) return 'var(--color-green)';
  if (conf >= 0.65) return 'var(--color-deep-green)';
  return 'var(--color-slate)';
}

function statusClass(status) {
  if (status === 'green') return 'badge-green';
  if (status === 'amber' || status === 'degraded') return 'badge-amber';
  if (status === 'red' || status === 'failed') return 'badge-red';
  return 'badge-slate';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
