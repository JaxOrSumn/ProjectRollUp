// ── Filter State and Logic ──────────────────────────────

let activeFilters = {
  tags: [],
  minSources: 0,
  minConfidence: 0,
};

function filterStories(stories) {
  return stories.filter(s => {
    if (activeFilters.tags.length > 0 &&
        !activeFilters.tags.some(t => (s.tags || []).includes(t))) {
      return false;
    }
    if (s.sourceCount < activeFilters.minSources) return false;
    if (s.confidence < activeFilters.minConfidence) return false;
    return true;
  });
}

function toggleTagFilter(tag) {
  const idx = activeFilters.tags.indexOf(tag);
  if (idx > -1) {
    activeFilters.tags.splice(idx, 1);
  } else {
    activeFilters.tags.push(tag);
  }
  renderFeed();
  updateTagPillsUI();
}

function clearFilters() {
  activeFilters = { tags: [], minSources: 0, minConfidence: 0 };
  renderFeed();
  updateTagPillsUI();
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
