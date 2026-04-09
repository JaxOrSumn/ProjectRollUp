# Project RollUp — Prompt Queue

---

**1. Reassess Confidence**
In `app.py`, review the confidence score calculation (currently raw 0–1 score scaled to %). Reweight so freshness, source count, and source diversity each contribute meaningfully. Update display to reflect the new formula.

---

**2. Tag Color Coordination**
In `components.css` and any inline styles, unify tag chip colors so Geopolitics, Tech, Economic, Scientific Reports, Media, Celebrity News, and General use identical colors on both the homepage feed cards and the story briefing modal.

---

**3. Text Size — Increase One Size**
In `base.css`, increase the base font size by one step (e.g. 13px → 14px). Check that headings, labels, and monospace elements scale proportionally throughout the dashboard.

---

**4. Story Age Display — Fix Staleness**
In `app.py`, stop reading `age_minutes` from the database. Compute it dynamically on every API response using the stored `published` ISO timestamp relative to current UTC time.

---

**5. Welcome Popup — Show Once Per Session**
In the relevant JS file, use `localStorage` to show the welcome popup only on first visit. Add a small "?" button in the header to reopen it on demand.

---

**6. Unimplemented Buttons — Remove or Build**
In the frontend, either implement or remove "MUTE SOURCE", "EXPORT REPORT", and "PIN SIGNAL" — all currently call `alert()`. Priority: Mute Source (hide outlet's stories) → Pin Signal (bookmark to top of feed) → Export Report (copy briefing text to clipboard).

---

**7. Feed Health — Make It Real**
In `app.py`, replace the hardcoded `healthy_sources` and `failed_sources` values in `/api/health` with real per-feed success/failure tracking recorded during each refresh cycle.

---

**8. Score Display — Replace Raw Decimal**
In the briefing modal, replace or supplement the raw score decimal (e.g. `0.546`) with a human-readable label: STRONG / MODERATE / WEAK. Reserve the raw value for a debug view only.

---

**9. Paywall / Extraction Failure — Surface to User**
In `app.py`, when `extract_article_text` fails, append a visible label to the briefing — e.g. "Feed summary only — full article unavailable" — so the user knows the write-up is RSS-only.

---

**10. Digest / Roundup Feed Filtering**
In `app.py`, detect and skip or down-weight digest/roundup feed entries (e.g. "Morning briefing", "This week in...") at ingestion time to prevent low-quality multi-topic summaries from entering the feed.

---

**11. Mobile Responsiveness**
In the CSS files, define a mobile breakpoint that stacks the side panels (System Status, Source Health, Coverage Theater) vertically below the main feed and ensures feed cards and the briefing modal are usable on small screens.

---

**12. Coverage Theater — Wire Up Tag Filtering**
In `filters.js` and the feed rendering pipeline, connect tag pill clicks in the Coverage Theater panel to actually filter the main feed by the selected tag category.

---

**13. Summary Write-Up — Add SOURCES CORROBORATING Field**
In `app.py`, when building the briefing modal response, add a `SOURCES CORROBORATING:` field directly beneath `SOURCE:`. Populate it with other outlet names from the same story cluster (already tracked via deduplication). If only one source exists, omit the field or display "No corroborating sources found."

---

**14. Interactive Origin Globe — Story Briefing Modal**
Build a CRT-green styled interactive 3D globe that renders inside the story briefing modal when a headline is clicked. The globe must display a latitude/longitude GPS pin marking the exact origin of the story's source outlet.

Implementation steps:
- Create a `source_locations` table in `project_rollup.db` with columns: `outlet_name`, `address`, `lat`, `lon`. Pre-populate with the publicly listed headquarters address for every current primary and backup feed outlet (Reuters, BBC, Guardian, Al Jazeera, NPR, etc.).
- In `app.py`, when building the briefing response, look up the story's source outlet in `source_locations` and return `lat`, `lon`, and `address` in the API payload.
- In the frontend, render an interactive globe using a lightweight library (e.g. `globe.gl`, `three-globe`, or a canvas/WebGL fallback). Style it to match the existing CRT-green monospace aesthetic — dark background, green landmasses, green grid lines, no color fills.
- Overlay a pulsing GPS pin at the returned `lat`/`lon` coordinate. On hover/click, show a tooltip with the outlet name and address.
- The globe section should appear as a dedicated block inside the existing briefing modal, visible only after a story is opened. On mobile, hide the globe entirely (consistent with planned mobile layout from task 11).

---

**15. Headline Search & Keyword Filter**
In the frontend, add a search input to the dashboard header. On keystroke, filter the visible feed in real time to only show headlines and summaries containing the query string. Search should run client-side against already-loaded data — no new API call required. Clear button resets the feed to full view. Highlight matched keywords in the filtered results.

---

**16. Auto-Refresh Countdown & Last-Updated Indicator**
In the frontend, display a visible countdown timer showing seconds until the next background refresh (cycle is every 5 minutes). Alongside it, show a "LAST UPDATED: X min ago" timestamp that updates every second. On successful refresh, flash the indicator green briefly. On failed refresh, flag it in amber. Wire both to the existing `/api/health` refresh cycle in `app.py`.

---

**17. Read / Unread Story Tracking**
In the frontend, use `localStorage` to track which story IDs the user has already opened. Mark unread stories with a distinct visual indicator (e.g. a green dot or bold title). Once opened, the indicator clears. Add a "MARK ALL READ" control and a toggle to hide already-read stories from the feed entirely.

---

**18. Frontend Error State & API Fallback UI**
In the frontend JS, add a graceful error state for when the backend is unreachable or returns a non-200 response. Display a CRT-styled error panel in place of the feed (e.g. "SIGNAL LOST — RETRYING IN Xs") with an automatic retry countdown. Prevent the dashboard from silently rendering empty or broken states. Log the failure reason in a visible debug line for developer use.

---

**19. Story Permalink / Deep Link**
In `app.py` and the frontend, generate a stable unique ID (e.g. slug or hash of headline + source + date) for each story. When a briefing modal is opened, update the browser URL to include the story ID as a hash or query param (e.g. `?story=abc123`) without triggering a page reload. On page load, if a story ID is present in the URL, automatically open that briefing modal. Allows direct linking and browser back/forward navigation between stories.

---
