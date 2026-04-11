# Project RollUp — Prompt Queue

---

~~**1. Reassess Confidence**~~
~~In `app.py`, review the confidence score calculation (currently raw 0–1 score scaled to %). Reweight so freshness, source count, and source diversity each contribute meaningfully. Update display to reflect the new formula.~~

---

~~**2. Tag Color Coordination**~~
~~In `components.css` and any inline styles, unify tag chip colors so Geopolitics, Tech, Economic, Scientific Reports, Media, Celebrity News, and General use identical colors on both the homepage feed cards and the story briefing modal.~~

---

~~**3. Text Size — Increase One Size**~~
~~In `base.css`, increase the base font size by one step (e.g. 13px → 14px). Check that headings, labels, and monospace elements scale proportionally throughout the dashboard.~~

---

~~**4. Story Age Display — Fix Staleness**~~
~~In `app.py`, stop reading `age_minutes` from the database. Compute it dynamically on every API response using the stored `published` ISO timestamp relative to current UTC time.~~

---

~~**5. Welcome Popup — Show Once Per Session**~~
~~In the relevant JS file, use `localStorage` to show the welcome popup only on first visit. Add a small "?" button in the header to reopen it on demand.~~

---

~~**6. Unimplemented Buttons — Remove or Build**~~
~~In the frontend, either implement or remove "MUTE SOURCE", "EXPORT REPORT", and "PIN SIGNAL" — all currently call `alert()`. Priority: Mute Source (hide outlet's stories) → Pin Signal (bookmark to top of feed) → Export Report (copy briefing text to clipboard).~~

---

~~**7. Feed Health — Make It Real**~~
~~In `app.py`, replace the hardcoded `healthy_sources` and `failed_sources` values in `/api/health` with real per-feed success/failure tracking recorded during each refresh cycle.~~

---

**8. Score Display — Replace Raw Decimal** *(partial — label calculated in `utils.js` but not rendered in briefing modal HTML)*
In the briefing modal, replace or supplement the raw score decimal (e.g. `0.546`) with a human-readable label: STRONG / MODERATE / WEAK. Reserve the raw value for a debug view only. The `signalStrength()` function already exists in `utils.js` — wire it into the briefing modal template in `dashboard.js` (around line 612–656 where briefing HTML is built) so the label renders visibly next to or replacing the raw score.

---

~~**9. Paywall / Extraction Failure — Surface to User**~~
~~In `app.py`, when `extract_article_text` fails, append a visible label to the briefing — e.g. "Feed summary only — full article unavailable" — so the user knows the write-up is RSS-only.~~

---

~~**10. Digest / Roundup Feed Filtering**~~
~~In `app.py`, detect and skip or down-weight digest/roundup feed entries (e.g. "Morning briefing", "This week in...") at ingestion time to prevent low-quality multi-topic summaries from entering the feed.~~

---

~~**11. Mobile Responsiveness**~~
~~In the CSS files, define a mobile breakpoint that stacks the side panels (System Status, Source Health, Coverage Theater) vertically below the main feed and ensures feed cards and the briefing modal are usable on small screens.~~

---

~~**12. Coverage Theater — Wire Up Tag Filtering**~~
~~In `filters.js` and the feed rendering pipeline, connect tag pill clicks in the Coverage Theater panel to actually filter the main feed by the selected tag category.~~

---

~~**13. Summary Write-Up — Add SOURCES CORROBORATING Field**~~
~~In `app.py`, when building the briefing modal response, add a `SOURCES CORROBORATING:` field directly beneath `SOURCE:`. Populate it with other outlet names from the same story cluster (already tracked via deduplication). If only one source exists, omit the field or display "No corroborating sources found."~~

---

~~**14. Interactive Origin Globe — Story Briefing Modal**~~
~~Build a CRT-green styled interactive 3D globe that renders inside the story briefing modal when a headline is clicked. The globe must display a latitude/longitude GPS pin marking the exact origin of the story's source outlet.~~

~~Implementation steps:~~
~~- Create a `source_locations` table in `project_rollup.db` with columns: `outlet_name`, `address`, `lat`, `lon`. Pre-populate with the publicly listed headquarters address for every current primary and backup feed outlet (Reuters, BBC, Guardian, Al Jazeera, NPR, etc.).~~
~~- In `app.py`, when building the briefing response, look up the story's source outlet in `source_locations` and return `lat`, `lon`, and `address` in the API payload.~~
~~- In the frontend, render an interactive globe using a lightweight library (e.g. `globe.gl`, `three-globe`, or a canvas/WebGL fallback). Style it to match the existing CRT-green monospace aesthetic — dark background, green landmasses, green grid lines, no color fills.~~
~~- Overlay a pulsing GPS pin at the returned `lat`/`lon` coordinate. On hover/click, show a tooltip with the outlet name and address.~~
~~- The globe section should appear as a dedicated block inside the existing briefing modal, visible only after a story is opened. On mobile, hide the globe entirely (consistent with planned mobile layout from task 11).~~

---

~~**15. Headline Search & Keyword Filter**~~
~~In the frontend, add a search input to the dashboard header. On keystroke, filter the visible feed in real time to only show headlines and summaries containing the query string. Search should run client-side against already-loaded data — no new API call required. Clear button resets the feed to full view. Highlight matched keywords in the filtered results.~~

---

~~**16. Auto-Refresh Countdown & Last-Updated Indicator**~~
~~In the frontend, display a visible countdown timer showing seconds until the next background refresh (cycle is every 5 minutes). Alongside it, show a "LAST UPDATED: X min ago" timestamp that updates every second. On successful refresh, flash the indicator green briefly. On failed refresh, flag it in amber. Wire both to the existing `/api/health` refresh cycle in `app.py`.~~

---

~~**17. Read / Unread Story Tracking**~~
~~In the frontend, use `localStorage` to track which story IDs the user has already opened. Mark unread stories with a distinct visual indicator (e.g. a green dot or bold title). Once opened, the indicator clears. Add a "MARK ALL READ" control and a toggle to hide already-read stories from the feed entirely.~~

---

~~**18. Frontend Error State & API Fallback UI**~~
~~In the frontend JS, add a graceful error state for when the backend is unreachable or returns a non-200 response. Display a CRT-styled error panel in place of the feed (e.g. "SIGNAL LOST — RETRYING IN Xs") with an automatic retry countdown. Prevent the dashboard from silently rendering empty or broken states. Log the failure reason in a visible debug line for developer use.~~

---

~~**19. Story Permalink / Deep Link**~~
~~In `app.py` and the frontend, generate a stable unique ID (e.g. slug or hash of headline + source + date) for each story. When a briefing modal is opened, update the browser URL to include the story ID as a hash or query param (e.g. `?story=abc123`) without triggering a page reload. On page load, if a story ID is present in the URL, automatically open that briefing modal. Allows direct linking and browser back/forward navigation between stories.~~

---

~~**20. Trends — Trend Summary Panel**~~
~~In `public_html/js/dashboard.js` and `public_html/index.html`, add a click-to-expand summary panel to each trend card. When a trend card is clicked, fetch a brief AI-style summary from a new backend endpoint `GET /api/trend-summary?topic=...` in `app.py`. The backend should pull the top 3 matching HackerNews or Reddit post bodies for that topic, strip boilerplate, and return a 2–4 sentence plain-English summary of why this topic is trending, what people are saying, and how widespread it is. Display the summary inline below the trend card metadata, styled like the existing `.briefing-summary` layout used in the news briefing modal. Show a loading state while fetching. Cache results in memory so repeated clicks don't re-fetch. Add a "CLOSE SUMMARY" button to collapse it.~~

---

~~**21. Advertisement & Promotional Content Filter**~~
~~In `app.py`, add a pre-ingestion filter that detects and discards feed entries that are pseudo-advertisements, sponsored content, or promotional pieces before they enter the ranking pipeline. Build a scoring function that checks for signals including: presence of promotional language patterns (e.g. "sponsored", "partner content", "paid post", "presented by", "buy now", "limited time", "discount", "promo code", "affiliate"), excessively short summaries with external CTAs, URLs pointing to known ad-network domains, and headlines structured as product pitches rather than news events. If an entry scores above a defined ad-probability threshold, discard it silently at ingestion — do not let it reach `dedupe_and_rank`. Apply the same filter to the trends pipeline. Log the count of discarded entries per refresh cycle in the existing health tracking system.~~

---

~~**22. Trends — Expand Data Sources**~~
~~In `app.py`, significantly expand the trend data sources beyond HackerNews, Reddit, and Google Trends. Add the following new fetchers alongside the existing ones, all implemented as async functions following the pattern of `_fetch_hn` and `_fetch_reddit`:~~

~~- **YouTube Trending** — use the YouTube Data API v3 (`/videos?chart=mostPopular&regionCode=US&maxResults=20`). Requires a free API key stored as an environment variable `YOUTUBE_API_KEY`. If the key is absent, skip silently.~~
~~- **GitHub Trending** — scrape `https://github.com/trending` (HTML, no auth required) to extract repository names and descriptions. Parse with regex or basic HTML parsing — no external scraping library.~~
~~- **Wikipedia Current Events** — fetch `https://en.wikipedia.org/wiki/Portal:Current_events` and extract linked article titles from the current day's section.~~
~~- **NewsAPI Top Headlines** — use `https://newsapi.org/v2/top-headlines?country=us&pageSize=20` with a free API key stored as `NEWSAPI_KEY`. If absent, skip silently.~~

~~Integrate all new sources into `_aggregate_trends`, update the cross-platform deduplication to handle 6 sources, and update the `PLATFORM_SHORT` and `PLATFORM_CLASS` maps in `public_html/js/dashboard.js` to display the new platform badges correctly. Update the `sources` field in the `/api/trends` response to list only the sources that actually returned data in that cycle.~~

---

~~**23. Trends — Fix Backlinks & External Link Behaviour**~~
~~In `public_html/js/dashboard.js`, audit and fix all outbound links generated inside trend cards. Each trend card's "VIEW ON [PLATFORM] →" link must: (1) always open in a new tab with `target="_blank" rel="noopener noreferrer"`, (2) point to the correct canonical URL for that platform — for HackerNews items use `https://news.ycombinator.com/item?id=...` (not the external article URL), for Reddit use the full `https://reddit.com/r/.../comments/...` permalink, for Google Trends use `https://trends.google.com/trends/explore?q=...`, for YouTube use `https://youtube.com/watch?v=...`, for GitHub use `https://github.com/[owner]/[repo]`. (3) Validate that the URL is non-empty and well-formed before rendering; if invalid, hide the link entirely rather than showing a broken one. Also ensure the "X IN FEED →" button correctly pre-fills the news feed search and scrolls the user to the top of the feed after switching tabs.~~

---

~~**24. Limit Tags to 3 Maximum Per Headline and Trend**~~
~~In `app.py`, modify the `classify_tags` function to return at most 3 tags per story or trend. When more than 3 tags match, keep the 3 with highest priority using this fixed order: Geopolitics > Tech > Economic > Scientific Reports > Media > Celebrity News > General. Apply the same 3-tag cap inside `_aggregate_trends` where `classify_tags` is called for trend items. In `public_html/js/dashboard.js`, add a client-side guard in both `renderFeed` and `renderTrends` that slices the tags array to `slice(0, 3)` before rendering chips, so the cap is enforced even if older cached API responses contain more tags.~~

---

~~**25. Trends — Auto-Refresh Countdown**~~
~~In `public_html/js/dashboard.js`, add a visible auto-refresh countdown to the Trends tab toolbar, mirroring the existing `NEXT REFRESH:` countdown in the news header. Display it as a monospace label (e.g. `NEXT REFRESH: 18m 42s`) inside the `.trends-toolbar` element in `public_html/index.html`. The countdown should start from 1200 seconds (20 minutes) each time `loadTrends` completes successfully and tick down every second via `setInterval`. When it reaches zero, automatically call `loadTrends(true)` and restart the countdown. If a manual Refresh button press triggers a fetch, restart the countdown from 1200. Flash the trends panel header green briefly on successful refresh. On fetch failure, show an amber warning label in the toolbar instead of updating the timestamp.~~

---

~~**26. Trends — Track Velocity Over Time**~~
~~In `app.py`, modify the `trend_cache` database table to store a history of trend snapshots rather than a single overwritten row. Add a new `trend_history` table with columns: `topic TEXT`, `platform TEXT`, `composite_score REAL`, `velocity TEXT`, `signals INTEGER`, `recorded_at TEXT`. Each time `refresh_trends_async` runs, after saving the current snapshot, insert the top 30 trends into `trend_history` with the current UTC timestamp. Trim entries older than 48 hours on each write. Add a new endpoint `GET /api/trend-history?topic=...` that returns the score and signals history for a given topic as a time series array. In `public_html/js/dashboard.js`, when a trend card is expanded (see Task 20), fetch this history and render a minimal ASCII sparkline (e.g. `▁▂▄▆█▇▅`) below the summary showing how interest has changed over the last 24 hours.~~

---

~~**27. Trends & News — Mobile Layout**~~
~~In `public_html/css/components.css` and `public_html/css/layout.css`, ensure the Trends tab is fully usable on screens narrower than 768px. The `.trends-grid` should collapse to a single column. The `.trends-toolbar` dropdowns and buttons should stack into two rows. Trend card text should remain legible at 14px minimum. The `.vel-badge` and `.platform-badge` elements should not overflow their containers. Also verify that switching between the NEWS FEED and TRENDS tabs works correctly on touch devices (no hover-only states blocking interaction). Test at 375px and 768px breakpoints and fix any overflow, truncation, or layout issues found.~~

---

~~**28. Remove Duplicate Root-Level Frontend Files**~~
~~The project has two sets of frontend files: the live dashboard in `public_html/` and an older, simpler version at the root level (`index.html`, `styles.css`, `script.js`). The root-level files are not served in production and are causing confusion about which files to edit. Archive the root-level frontend files by moving them into a new `_archive/` subdirectory, then delete them from the project root. Update `FUTURE_AGENT_CONTEXT` to clearly state that `public_html/` is the sole live frontend, `app.py` is the backend, and `_archive/` contains the deprecated simple version for reference only. Do not delete `app.py`, `requirements.txt`, `project_rollup.db`, or any file in `public_html/`.~~

---

~~**29. Trends — In-Tab Search & Keyword Filter**~~
~~In `public_html/index.html`, add a text search input to the `.trends-toolbar` in the Trends view, styled identically to the existing `.search-input` in the news header. In `public_html/js/dashboard.js`, wire it to a client-side filter that runs on every keystroke against `trendsData`, matching the query string against each trend's `topic`, `categories`, `platforms`, and `subreddit` fields (case-insensitive). Call `renderTrends()` after each filter update. Add a clear button that resets the search. Highlight matched substrings in the trend topic text using the existing `.search-highlight` CSS class. The search should compose with the category and velocity dropdown filters — all three filters apply simultaneously.~~

---

~~**30. Prevent `project_rollup.db` from Being Deployed**~~
~~The SQLite database file `project_rollup.db` contains locally cached news and trend data that should never be committed or deployed — Render regenerates it from scratch on each startup. Add a `.gitignore` file to the project root (if one does not exist) that excludes `project_rollup.db`, `__pycache__/`, `*.pyc`, and `_preview_server.py`. Also add a startup check in `app.py`'s `_startup()` function: if the `trend_cache` table exists but contains entries with a `fetched_at` timestamp older than 24 hours (indicating stale data from a previous environment), automatically clear it so a fresh fetch is triggered on the next `/api/trends` request. Document this behaviour in `FUTURE_AGENT_CONTEXT`.~~

---

~~**31. Trends — Add TikTok Creative Center as a Trend Source**~~
~~In `app.py`, add a new async trend fetcher `_fetch_tiktok()` that queries the TikTok Creative Center trending hashtags endpoint (currently unauthenticated read access — no API key required). Parse the response to extract trending topic names, view counts, and post counts. Integrate the results into `_aggregate_trends()` alongside the existing HackerNews, Reddit, and Google Trends sources. Add `"tiktok"` to the `PLATFORM_SHORT` and `PLATFORM_CLASS` maps in `public_html/js/dashboard.js` so trend cards correctly display a TikTok platform badge. Update the cross-platform deduplication in `_aggregate_trends` to handle the new source. If the TikTok endpoint is unreachable or returns an unexpected format, skip silently and exclude it from the `sources` field in the `/api/trends` response. Note: this endpoint is unauthenticated and may change — build defensively with a try/except around the entire fetch.~~

---

~~**32. Trends — Add Mastodon Trending Hashtags as a Trend Source**~~
~~In `app.py`, add a new async trend fetcher `_fetch_mastodon()` that calls the public Mastodon trending hashtags API at `https://mastodon.social/api/v1/trends/tags?limit=20`. No authentication is required. Parse the response to extract hashtag names and `uses` (usage count in the past week) and `accounts` (number of accounts posting). Normalize hashtag names by stripping the leading `#` and replacing underscores with spaces before passing to `_normalize_topic()`. Integrate results into `_aggregate_trends()`. Add `"mastodon"` to the `PLATFORM_SHORT` and `PLATFORM_CLASS` maps in `public_html/js/dashboard.js`. If the endpoint is unreachable, skip silently. Include `"mastodon"` in the `sources` field of the `/api/trends` response only when it returns data.~~

---

~~**33. Trends — Add Bluesky Trending as a Trend Source**~~
~~In `app.py`, add a new async trend fetcher `_fetch_bluesky()` that queries the Bluesky AT Protocol public trending feed. Use the public AppView endpoint `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot&limit=20` — no authentication required. Parse the returned posts to extract subject text and extract recurring keywords/phrases as trend signals. Alternatively, if Bluesky exposes a dedicated trending topics endpoint by the time this task is implemented, prefer that. Normalize extracted topics through `_normalize_topic()` and pass into `_aggregate_trends()`. Add `"bluesky"` to the `PLATFORM_SHORT` and `PLATFORM_CLASS` maps in `public_html/js/dashboard.js`. Handle all fetch and parse errors silently and exclude from `sources` if unavailable.~~

---

~~**34. Trends — Add YouTube Trending as a Standalone Source (Extends Task 22)**~~
~~Note: Task 22 already includes YouTube as part of a broader multi-source expansion. This task covers YouTube as a standalone addition if Task 22 has not yet been implemented. In `app.py`, add a new async trend fetcher `_fetch_youtube()` that calls the YouTube Data API v3 endpoint `GET /videos?chart=mostPopular&regionCode=US&maxResults=20&part=snippet`. Requires a free API key stored as environment variable `YOUTUBE_API_KEY`. If the key is absent, skip the fetcher silently. Extract video titles and channel names as trend signals, normalize through `_normalize_topic()`, and pass into `_aggregate_trends()`. Add `"youtube"` to the `PLATFORM_SHORT` and `PLATFORM_CLASS` maps in `public_html/js/dashboard.js` with an appropriate badge style. Include `"youtube"` in the `sources` field of the `/api/trends` response only when data is returned successfully. If Task 22 has already been implemented, verify YouTube is included and mark this task complete without duplication.~~

---

~~**35. New Project — Real-Time Serious Threat Map (OSINT Dashboard)**~~
~~Build a standalone open-source intelligence dashboard that visualizes confirmed, reportable serious threat events on an interactive world map in real time. This is a separate project from Project RollUp — scaffold it in a new directory (e.g. `threat-map/`).

**Scope — include only:**
- Acts of mass violence (attacks, bombings, shootings with 3+ casualties)
- Terrorism (claimed or attributed attacks, credible threats from designated groups)
- Sedition and anti-government insurgency (armed uprisings, coup attempts, militant seizures of infrastructure)
- Sabotage (deliberate destruction of critical national infrastructure — power grids, pipelines, telecoms, transport)
- Organized crime operations (cartel activity, human trafficking networks, major drug interdictions reported by law enforcement)

**Exclude:** protests, civil unrest, sanctions, cybercrime, election disputes, natural disasters, and any incident below the threshold of a serious reportable criminal act.

**Tech stack:**
- Frontend: React + TypeScript
- Map: `react-globe.gl` (WebGL globe, preferred) or Leaflet with a dark tile layer as fallback
- Backend: Node.js feed aggregator with Express or Fastify
- Storage: SQLite for development, PostgreSQL for production — used for event deduplication and history
- Real-time delivery: Socket.io WebSocket pushing new events to all connected clients

~~**Implementation steps:**~~
~~1. Scaffold the project: `threat-map/` with `client/` (Vite + React + TS) and `server/` (Node.js).~~
~~2. Build the backend feed aggregator: ingest from at least 3 open OSINT sources (e.g. GDELT Project event stream, ACLED API, ReliefWeb API, or RSS feeds from Reuters/AP filtered by the above categories). Run a fetch cycle every 5 minutes.~~
~~3. Build an NLP classification layer that scores each ingested item against the 5 allowed categories using keyword matching and/or a lightweight classifier. Discard anything that scores below threshold.~~
~~4. Geocode each event to a `lat`/`lon` coordinate (use the location field from the source, or fall back to country centroid). Store in SQLite/PostgreSQL with deduplication by source URL or event ID.~~
~~5. Expose a REST endpoint `GET /api/events?since=<ISO timestamp>` returning recent confirmed events as GeoJSON, and a Socket.io channel that pushes new events in real time.~~
~~6. Build the React frontend: render the globe using `react-globe.gl` with a dark base (`#0a0a0a` background, dim land polygons). Plot each event as a pulsing point marker colored by category (e.g. red = violence, orange = terrorism, yellow = sabotage). On marker click, show a side panel with: headline, source outlet, category badge, timestamp, location name, and a link to the original article.~~
~~7. Add a filter toolbar: toggle visibility by category, time range selector (last 24h / 7d / 30d), and a live event counter.~~
~~8. Style to match a dark intelligence aesthetic (monospace font, muted palette, subtle scan-line or vignette effect) consistent with Project RollUp's design language.~~
~~9. Document all external API keys required (ACLED, GDELT, etc.) in a `.env.example` file. The app must degrade gracefully if any individual source is unavailable.~~
