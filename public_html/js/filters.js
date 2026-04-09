// ── Filter State and Logic ──────────────────────────────

let activeFilters = {
  tags:          [],
  minSources:    0,
  minConfidence: 0,
};

function filterStories(stories) {
  return stories.filter(s => {
    // Task 6: Respect muted sources
    if (typeof mutedSources !== 'undefined' && mutedSources.includes(s.source)) return false;

    // Tag filter
    if (activeFilters.tags.length > 0 &&
        !activeFilters.tags.some(t => (s.tags || []).includes(t))) {
      return false;
    }

    // Handle both sourceCount and source_count field names
    const sc = s.sourceCount || s.source_count || 1;
    if (sc < activeFilters.minSources) return false;

    if ((s.confidence || 0) < activeFilters.minConfidence) return false;

    return true;
  });
}

// Task 12: Fix — re-render Coverage Theater so pill active state updates reliably
function toggleTagFilter(tag) {
  const idx = activeFilters.tags.indexOf(tag);
  if (idx > -1) {
    activeFilters.tags.splice(idx, 1);
  } else {
    activeFilters.tags.push(tag);
  }
  renderFeed();
  renderCoverageTheater(); // Re-render pills so active class is applied correctly
}

function clearFilters() {
  activeFilters = { tags: [], minSources: 0, minConfidence: 0 };
  renderFeed();
  renderCoverageTheater();
}

function updateTagPillsUI() {
  document.querySelectorAll('.tag-pill').forEach(pill => {
    const tag = pill.dataset.tag;
    if (activeFilters.tags.includes(tag)) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}
