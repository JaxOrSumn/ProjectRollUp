// ── Filter State and Logic ──────────────────────────────

let activeFilters = {
  tags:       [],
  timeRange:  0,    // max age in minutes; 0 = all
  minSources: 0,
};

function filterStories(stories) {
  return stories.filter(s => {
    // Respect muted sources
    if (typeof mutedSources !== 'undefined' && mutedSources.includes(s.source)) return false;

    // Tag filter
    if (activeFilters.tags.length > 0 &&
        !activeFilters.tags.some(t => (s.tags || []).includes(t))) return false;

    // Source count filter
    const sc = s.sourceCount || s.source_count || 1;
    if (sc < activeFilters.minSources) return false;

    // Time range filter
    if (activeFilters.timeRange > 0) {
      const age = s.age_minutes ?? s.ageMinutes ?? 0;
      if (age > activeFilters.timeRange) return false;
    }

    return true;
  });
}

function toggleTagFilter(tag) {
  const idx = activeFilters.tags.indexOf(tag);
  if (idx > -1) activeFilters.tags.splice(idx, 1);
  else activeFilters.tags.push(tag);
  renderFeed();
  renderFilterBar();
  renderCoverageTheater();
}

function setTimeFilter(minutes) {
  activeFilters.timeRange = minutes;
  renderFeed();
  renderFilterBar();
}

function setSourceFilter(min) {
  activeFilters.minSources = min;
  renderFeed();
  renderFilterBar();
}

function clearFilters() {
  activeFilters = { tags: [], timeRange: 0, minSources: 0 };
  renderFeed();
  renderFilterBar();
  renderCoverageTheater();
}

function updateTagPillsUI() {
  document.querySelectorAll('.tag-pill').forEach(pill => {
    const tag = pill.dataset.tag;
    pill.classList.toggle('active', activeFilters.tags.includes(tag));
  });
}
