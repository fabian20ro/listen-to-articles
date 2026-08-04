# Iteration Log

> Append-only journal of AI agent work sessions on this project.
> **Add an entry at the end of every iteration.**
> When patterns emerge (same issue 2+ times), promote to `LESSONS_LEARNED.md`.

## Format

Each entry should follow this structure:

---

### [YYYY-MM-DD] Brief Description of Work Done

**Context:** What was the goal / what triggered this work
**What happened:** Key actions taken, decisions made
**Outcome:** Result — success, partial, or failure
**Insight:** (optional) What would you tell the next agent about this?
**Promoted to Lessons Learned:** Yes/No

---

### [2026-02-22] Initial PWA implementation — full ArticleVoice app

**Context:** Greenfield implementation of ArticleVoice PWA from a detailed architecture plan. The project was an empty repo with just a LICENSE file.

**What happened:**
- Set up TypeScript project with `tsc` as sole build tool. Used `outDir: "."` with `rootDir: "src"` so compiled JS lands at the project root for direct GitHub Pages deployment.
- Created all core modules: `url-utils.ts` (URL validation + Share Target param parsing), `lang-detect.ts` (EN/RO heuristic detection), `extractor.ts` (CORS proxy fetch + Readability.js parsing), `tts-engine.ts` (Web Speech API wrapper with sentence-level chunking to avoid Android's 15-second cutoff bug).
- Built `app.ts` orchestrator wiring URL handling, extraction, TTS, install prompts, settings persistence, and all UI interactions.
- Created `index.html` with full player UI, `style.css` with dark theme, `manifest.json` with Share Target, `sw.js` for offline caching.
- Created `worker/cors-proxy.js` Cloudflare Worker with SSRF prevention.
- Vendored Mozilla Readability.js from GitHub.
- Generated placeholder PWA icons via Python script.

**Outcome:** Success. All files created, TypeScript compiles cleanly, app structure matches the plan.

**Insight:** The `outDir: "."` approach is clean for GitHub Pages but means root-level `.js` files are build artifacts — easy to accidentally edit the wrong file. Always edit `src/`, never the root `.js`.

**Promoted to Lessons Learned:** Yes — architecture decision about outDir overlap and import `.js` extension requirement.

---

### [2026-02-22] Add documentation (README, AGENTS.md, CLAUDE.md) and Vitest test suite

**Context:** Needed README for users, AGENTS.md for AI agents, CLAUDE.md as entry point, and tests for all implemented modules.

**What happened:**
- Created README.md with full usage guide (quick start, share target flow, player controls, development setup).
- Created AGENTS.md with codebase reference (layout, commands, 5 architecture rules, critical implementation details, testing notes).
- Created CLAUDE.md pointing to AGENTS.md.
- Chose Vitest over Jest — it handles TypeScript natively, supports ES modules, and needs minimal config. Added `jsdom` environment for DOM API testing.
- Wrote 75 tests across 4 files covering all library modules.
- Hit one test failure: the extractor test for "single-newline fallback" assumed the fallback path would trigger, but the double-newline split actually succeeds with one large paragraph. Fixed by correcting the assertion to match actual behavior.
- Had to exclude `src/__tests__/` from `tsconfig.json` to prevent `tsc` from compiling test files into the root output directory.

**Outcome:** Success. 75/75 tests passing. All documentation complete.

**Insight:** When testing text-splitting logic, trace through the actual regex behavior with your test data before writing assertions. The "obvious" split behavior is often wrong. Also, always add `src/__tests__` to tsconfig `exclude` when test files live inside the source tree.

**Promoted to Lessons Learned:** Yes — test data accuracy lesson, tsconfig exclude for tests, and mock SpeechSynthesis guidance.

---

### [2026-02-22] CI/CD, Cloudflare Worker automation, subdirectory path fixes

**Context:** Needed automated deployment via GitHub Actions for both GitHub Pages and the Cloudflare Worker. The worker needed to use secrets (not hardcoded config). Manifest and SW had absolute paths that would break on GitHub Pages subdirectory deployment.

**What happened:**
- Fixed `manifest.json`: changed `start_url`, `scope`, and `share_target.action` from `"/"` to `"."` (relative) so the PWA works when served from `/<repo>/`.
- Fixed `sw.js`: changed precache paths from `'/index.html'` to `'./index.html'` etc. Same subdirectory issue.
- Refactored `worker/cors-proxy.js` to read `ALLOWED_ORIGIN` and `PROXY_SECRET` from Cloudflare env bindings (`env` parameter) instead of hardcoded constants. Added `X-Proxy-Key` header validation when a secret is configured.
- Created `worker/wrangler.toml` with worker name `article-voice-proxy` and `ALLOWED_ORIGIN` var set to the GH Pages origin.
- Created `.github/workflows/deploy-pages.yml`: builds TS, runs tests, deploys a clean `_site/` artifact to Pages.
- Created `.github/workflows/deploy-worker.yml`: triggers on `worker/**` changes, uses `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `PROXY_SECRET` secrets.
- Updated `src/app.ts` and `src/lib/extractor.ts` to support optional `PROXY_SECRET` config — sent as `X-Proxy-Key` header on proxy requests.
- Updated README with live app link, detailed step-by-step Cloudflare setup, and CI/CD documentation.
- Updated AGENTS.md with new repo layout, CI/CD section, and updated architecture rules.

**Outcome:** Success. Build and tests pass (75/75). All workflows, configs, and path fixes in place.

**Insight:** When deploying a PWA to a subdirectory (GitHub Pages), every absolute path is a bug. Check manifest.json `start_url`/`scope`/`share_target.action`, SW precache paths, and any hardcoded `/` references. Use relative paths (`"."`, `"./"`) everywhere. Also, Cloudflare Worker env bindings are the right way to handle config/secrets — never hardcode origins or secrets in the worker source.

**Promoted to Lessons Learned:** Yes — subdirectory path gotcha, GH Actions artifact pattern, CF Worker env bindings pattern, required secrets documentation.

---

### [2026-02-22] Fix PWA share target and proxy error handling

**Context:** User reported two issues: (1) the PWA doesn't appear as a share target when sharing from articles, (2) entering a URL gives "Failed to fetch. Try pasting the article text directly."

**What happened:**
- Investigated the CORS proxy — confirmed it IS deployed but returns 403 because `PROXY_SECRET` is configured on the worker while the client has `CONFIG.PROXY_SECRET = ''`. The client sends no `X-Proxy-Key` header, worker rejects with 403. If the user isn't on the exact `ALLOWED_ORIGIN`, CORS blocks the 403 response, causing a raw "Failed to fetch" TypeError.
- Fixed `sw.js`: added `ignoreSearch: true` for navigation requests so share target URLs (`?url=...`) match the cached app shell instead of missing the cache and falling through to network. Bumped cache version to v2 to force SW update.
- Fixed `extractor.ts`: added specific error handling for `TypeError` (network unreachable → "Could not reach the article proxy"), for 403 responses (parses JSON error body from proxy, hints about PROXY_SECRET), and removed misleading "Try pasting the article text directly" from all error paths.
- Fixed `app.ts`: removed duplicate "Try pasting the article text directly" suffix appended to all errors in the `loadArticle` catch block.
- All 75 tests pass.

**Outcome:** Partial success. Error messages are now accurate and actionable. Share target caching is fixed. However, the root cause of "Failed to fetch" — the missing `PROXY_SECRET` in the client config — requires the user to set the secret value in `CONFIG.PROXY_SECRET` in `src/app.ts` and rebuild.

**Insight:** The "Failed to fetch" TypeError in browsers means the network request never completed — usually CORS blocking or DNS failure, NOT an HTTP error. When a CORS proxy returns an error (like 403) and the `Access-Control-Allow-Origin` doesn't match the caller's origin, the browser hides the HTTP status entirely and throws a generic TypeError. Always add specific TypeError handling for cross-origin fetch calls.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix share URL handling for text with title + URL

**Context:** User reported that sharing from Google News produces text like "Article Title https://share.google/xyz" and the app can't open it because "it's more than the url."

**What happened:**
- Investigated the full share flow. The `extractUrl()` function already handled extracting URLs from mixed text via regex, so the core logic was correct.
- Identified two UX/coverage issues: (1) the input field used `type="url"` which shows URL-only validation on mobile and makes pasting shared text harder, (2) `getUrlFromParams()` only checked `url` and `text` query params, missing the `title` param.
- Changed `<input type="url">` to `<input type="text">` with updated placeholder text.
- Added `title` to the candidate query params in `getUrlFromParams()`.
- Added 4 new test cases covering the exact Google News sharing format and the `title` param fallback.
- All 79 tests pass.

**Outcome:** Success. The app now properly handles shared text containing a title prefix before the URL, both via manual paste and Share Target API.

**Insight:** `type="url"` on input fields causes mobile browsers to show URL-specific keyboards (no space bar) and validation errors for non-URL text. Use `type="text"` when the input accepts more than bare URLs.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add sentence-level skip buttons to player controls

**Context:** User requested buttons to skip forward/backward one sentence, not just one paragraph.

**What happened:**
- Added `skipSentenceForward()` and `skipSentenceBackward()` methods to `TTSEngine` in `tts-engine.ts`. Forward advances one sentence within the current paragraph, or crosses to the first sentence of the next paragraph. Backward goes back one sentence, or to the last sentence of the previous paragraph.
- Added two new buttons to `index.html` player controls, positioned between the paragraph skip buttons and the play/pause button, using smaller double-chevron SVG icons.
- Wired buttons in `app.ts` to call the new TTS engine methods.
- Added `.sentence-btn` CSS class for slightly smaller sizing and reduced opacity to visually differentiate from paragraph buttons.
- Added 6 new tests covering: sentence advance within paragraph, cross-paragraph forward, boundary at last sentence, sentence backward within paragraph, cross-paragraph backward, and boundary at first sentence.
- All 91 tests pass.

**Outcome:** Success. Sentence skip buttons work alongside existing paragraph skip buttons.

**Insight:** The TTS engine already tracked sentence position (`sentIdx`) internally for the chunking logic, so adding sentence-level navigation was straightforward — just needed public methods that manipulate the same indices.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix translate button for shortened/redirect URLs

**Context:** User reported that the translate button doesn't work with shortened URLs like `https://share.google/RNxfVVbNyIhn3lvPa`. The `toTranslateUrl()` function was converting `share.google` → `share-google.translate.goog`, which is not a valid Google Translate proxy host.

**What happened:**
- Diagnosed the issue: the CORS proxy follows redirects (`redirect: 'follow'`) but the resolved URL was discarded. The app stored the original shortened URL as `currentArticleUrl`, which produced invalid translate URLs.
- Added `X-Final-URL` response header to the CORS proxy worker (`worker/cors-proxy.js`) that returns `response.url` (the final URL after all redirects). Added `Access-Control-Expose-Headers: X-Final-URL` to CORS headers so the browser can read it.
- Updated `fetchViaProxy()` in `extractor.ts` to return `{ html, finalUrl }` where `finalUrl` comes from the `X-Final-URL` header (with fallback to the original URL).
- Added `resolvedUrl: string` field to the `Article` interface.
- Updated `app.ts` to use `article.resolvedUrl` for `currentArticleUrl`, so the translate button uses the actual article domain.
- Added 2 new tests: one verifying `X-Final-URL` header is used, one verifying fallback to the original URL.
- All 90 tests pass (2 new + 88 existing after the test count shift from previous sessions).

**Outcome:** Success. Shortened URLs now resolve to their final destination before being used for translation.

**Insight:** When a CORS proxy follows redirects, the final URL information is lost unless explicitly forwarded back to the client. This affects any feature that operates on the domain/path of the URL (like Google Translate proxy URL construction). Always expose the resolved URL as a response header.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add rate limiting, codemaps, and documentation

**Context:** User requested: (1) create doc/codemaps files and link from AGENTS.md, (2) implement rate limiting at 20 req/min in the Cloudflare Worker, (3) make the UI show relevant errors when rate limits are hit, (4) document the limits.

**What happened:**
- Created `doc/codemaps/architecture.md` (data flow diagram, dependency graph, deployment targets) and `doc/codemaps/modules.md` (detailed API reference for every module).
- Added codemaps section with links to AGENTS.md.
- Implemented in-memory sliding window rate limiter in `worker/cors-proxy.js`: 20 requests per 60-second window per client IP (via `CF-Connecting-IP`). Returns 429 with `Retry-After` header. Includes periodic cleanup to prevent memory growth. All responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. Exposed new rate limit headers via CORS `Access-Control-Expose-Headers`.
- Updated `src/lib/extractor.ts` to handle HTTP 429 specifically: shows "Rate limit exceeded" with retry-after countdown from the response header.
- Added 2 new tests: one for 429 with error body, one for 429 with fallback message using `Retry-After` header.
- Documented rate limiting in AGENTS.md (new "CORS Proxy Rate Limiting" section).
- All 92 tests pass.

**Outcome:** Success. Rate limiting is enforced at the worker level, errors surface clearly in the UI, and all documentation is updated.

**Insight:** Cloudflare Workers' in-memory state (global `Map`) persists across requests within the same isolate but not across PoPs or cold starts. For a personal project this provides sufficient rate limiting; for production-grade global rate limiting, Durable Objects or KV would be needed.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add PWA force-update mechanism

**Context:** User installed a previous version of the PWA and the UI buttons weren't updating. Requested a way to force the app to update — either a button in settings or automatic update on load.

**What happened:**
- Added auto-reload on service worker update: listens for `controllerchange` on `navigator.serviceWorker` and reloads the page when a new SW takes control. Since the SW already calls `skipWaiting()` + `clients.claim()`, this ensures new versions activate and reload automatically.
- Added a "Check for Updates" button in the settings panel that: calls `registration.update()` to force the browser to check for a new SW, then clears all caches and reloads the page. This handles cases where the auto-update didn't trigger (e.g., the SW file didn't change but app assets did).
- Added status feedback text under the button.
- Styled the button to match the existing settings panel design.

**Outcome:** Success. Both auto-update on load and manual force-update from settings are implemented. All 92 tests pass.

**Insight:** PWAs installed on Android can get stuck on stale caches even when the SW uses `skipWaiting()` + `clients.claim()` because the page doesn't reload after the new SW activates. Listening for `controllerchange` and auto-reloading solves the most common case. For manual recovery, clearing all caches via `caches.keys()` + `caches.delete()` and reloading is the nuclear option that always works.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-05-11] Heal corrupted settings storage on load

**Context:** Small local quality improvement in `pixel-article-reader`.
**What happened:** Updated `src/lib/settings-store.ts` so sanitized settings are written back to `localStorage` during load, and added a regression test covering the self-healing path.
**Outcome:** Success. Targeted Vitest and full test suite passed; typecheck passed.
**Insight:** If a loader already normalizes corrupt browser storage, persist the cleaned value immediately so the app doesn't keep re-reading the same bad blob.
**Promoted to Lessons Learned:** Yes

---

### [2026-05-11] Self-heal invalid last-session storage on load

**Context:** Small follow-up quality improvement in `pixel-article-reader`.
**What happened:** Updated `src/lib/session-store.ts` so malformed or invalid last-article blobs are removed from `localStorage` during load, and added regression coverage for valid, malformed, and invalid-shape cases.
**Outcome:** Success. Focused Vitest passed; TypeScript typecheck passed.
**Insight:** Session restore should clean up invalid persisted blobs on read, not just ignore them, so startup doesn't keep paying the same validation cost.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-22] Fix URL detection, translate button, sentence skip, and docs

**Context:** User reported multiple issues: (1) pasting a full article that contains embedded URLs incorrectly extracts a URL and tries to fetch it, (2) translate button is invisible/hard to find, (3) sentence skip buttons don't work reliably, (4) console warnings about deprecated meta tags and manifest. Also requested AGENTS.md simplification and library updates.

**What happened:**
- Changed `extractUrl()` to only extract URLs at/near the end of text (share-text format). Previously it grabbed the first URL anywhere. Now if a URL is embedded mid-text, it returns null, allowing the app to treat the input as pasted article content.
- Added `createArticleFromText()` to `extractor.ts` — creates an Article directly from pasted plain text without fetching. Extracts title from first line, splits paragraphs, detects language, counts words.
- Updated `handleUrlSubmit()` in `app.ts` to handle pasted text when `extractUrl` returns null.
- Added `originalArticleUrl` variable to prevent double-wrapping translate.goog URLs. The translate button now always uses the original URL, and is hidden for pasted text articles.
- Made translate button visually prominent with a bordered style (was previously unstyled text, easily missed).
- Fixed sentence skip race condition in `tts-engine.ts`: `speechSynthesis.cancel()` fires `onend` on the old utterance, which was double-advancing the position. Added `_speakGen` generation counter — each utterance captures the generation at creation and bails out if stale.
- Fixed console warnings: replaced deprecated `apple-mobile-web-app-capable` with `mobile-web-app-capable`, added `enctype` to manifest share_target.
- Simplified AGENTS.md by replacing duplicated sections (Repository Layout, Build Commands, CI/CD) with links to README.md.
- Updated codemaps, README, and all documentation.
- All dependencies already at latest versions. 102 tests pass.

**Outcome:** Success. All issues fixed, tests pass, documentation updated.

**Insight:** `speechSynthesis.cancel()` fires `onend` on the current utterance (sometimes synchronously, sometimes async depending on browser). Any skip operation that calls cancel() and then advances the position must guard against the old `onend` handler also advancing. A generation counter is the cleanest fix — increment before cancel, capture in the onend closure, and bail if stale.

**Promoted to Lessons Learned:** Yes — TTS cancel() race condition pattern.

---

### [2026-02-22] Fix CodeQL security issues (#1, #2, #3)

**Goal:** Fix three CodeQL-detected security vulnerabilities — two in vendored Readability.js (High severity) and one in the deploy-worker workflow (Medium severity).

**What happened:**
- **Issue #1 — Incomplete hostname regex** (`vendor/Readability.js:155`): Video allowlist regex lacked a boundary after TLD, so `youtube.com.evil.com` could match. Added lookahead `(?=[/\?#:]|$)` and escaped unescaped dot in `live.bilibili`.
- **Issue #2 — Incomplete URL scheme check** (`vendor/Readability.js:481`): Only checked lowercase `javascript:` scheme. Replaced `indexOf` with regex `/^\s*(javascript|data):/i` to also block `data:` URIs, case variations, and whitespace prefixes.
- **Issue #3 — Missing workflow permissions** (`.github/workflows/deploy-worker.yml`): Added `permissions: contents: read` to follow principle of least privilege, matching the pattern already used in `deploy-pages.yml`.

**Outcome:** Success. All 102 tests pass, build succeeds, three security fixes applied.

**Insight:** Vendored libraries accumulate CodeQL findings over time since they don't receive upstream updates automatically. Hostname regexes in URL allowlists need boundary anchoring (lookahead for `/`, `?`, `#`, `:`, or end-of-string) to prevent subdomain spoofing.

---

### [2026-02-22] Fix translate button — replace broken Google Translate proxy with API-based translation

**Context:** User reported that clicking the translate button on a German article (web.de) left the text in German. The root cause: the translate button was constructing a `translate.goog` proxy URL and re-fetching through the CORS proxy, but `translate.goog` relies on client-side JavaScript to translate text. Since the proxy returns raw HTML and `DOMParser` doesn't execute JavaScript, the text stayed in the original language.

**What happened:**
- Replaced the broken `translate.goog` proxy approach entirely.
- Added a `POST /?action=translate` endpoint to the Cloudflare Worker that calls Google Translate's `translate.googleapis.com` API server-side and returns translated text as JSON.
- Created new `translator.ts` module that batches paragraphs into ~3000-char chunks, sends them to the worker in parallel (max 3 concurrent), and reassembles translated paragraphs.
- Improved `lang-detect.ts` with `detectLangFromHtml()` (normalizes `<html lang="de-DE">` to `"de"`), `detectLangFromUrl()` (maps TLDs like `.de` → German), `needsTranslation()` (decides if translation needed), and `getSourceLang()`.
- Added `htmlLang` field to the `Article` interface in `extractor.ts` — extracted from the parsed HTML's `<html lang="...">` attribute.
- Updated `app.ts`: removed `toTranslateUrl()` and `originalArticleUrl`, translate button now calls `translateParagraphs()` directly on the extracted text.
- The translate button now shows for both URL-based and pasted text articles when the detected language is not English or Romanian.
- Per user requirement: if language can't be determined from URL/metadata, assume it's NOT English → show translate button.
- Error handling propagates root cause at every level (worker → client → UI).
- Updated AGENTS.md, codemaps, iteration log.
- All 150 tests pass (48 new tests for lang-detect, translator, and extractor htmlLang).

**Outcome:** Success. Translate button now works via API-based translation instead of the broken proxy approach.

**Insight:** `translate.goog` URLs rely on client-side JavaScript to perform translation. Any server-side HTML fetching (CORS proxy, headless fetch) will return untranslated content. The correct approach for a proxy-based app is to translate the already-extracted text via a translation API, not to re-fetch a translated page.

**Promoted to Lessons Learned:** Yes — the translate.goog JS execution insight.

---

### [2026-02-22] Refactor to modular app architecture + markdown reading pipeline + Jina fallback

**Context:** Implemented the reliability-first refactor plan, then added markdown-rendered reading mode and Jina Reader retry flow on top of the refactored structure.

**What happened:**
- Introduced modular app architecture:
  - `src/lib/settings-store.ts` for settings persistence/validation
  - `src/lib/dom-refs.ts` for typed DOM references
  - `src/lib/pwa-update-manager.ts` for SW registration/update/reload policy
  - `src/lib/article-controller.ts` for extraction/rendering/translation UI flow
  - `src/lib/release.ts` for build metadata display
- Updated SW update behavior and release metadata wiring:
  - startup + visibility update checks
  - deferred reload when playback is active
  - manual force refresh kept as break-glass path
- Added markdown content pipeline:
  - `Article` now includes `markdown`
  - Readability output is converted to markdown (Turndown-compatible global)
  - markdown is rendered into formatted HTML (marked-compatible global) with sanitization
  - rendered top-level blocks are mapped to TTS paragraph indices for click/highlight parity
- Added user actions:
  - **Try with Jina Reader** (`extractArticleWithJina`) with fallback to default extraction
  - **Copy as Markdown** button (clipboard export)
- Extended Cloudflare Worker:
  - `GET /?url=...&mode=markdown` path that fetches `https://r.jina.ai/<url>`
  - optional server-side `JINA_KEY` authorization header
  - keeps existing SSRF/rate-limit/CORS constraints
- Added/updated tests:
  - new `settings-store` test suite
  - new `pwa-update-manager` test suite
  - expanded extractor tests for markdown + Jina + fallback behavior
- Fixed local toolchain blocker:
  - removed accidental npm dependency `tsc` (which shadowed TypeScript compiler binary)

**Outcome:** Success. Build passes and all tests pass (`7 files, 164 tests`).

**Insight:** A package named `tsc` can silently replace the expected compiler command in npm scripts. For TypeScript projects, keep only `typescript` and avoid adding `tsc` as a dependency.

**Promoted to Lessons Learned:** Yes — `tsc` package shadowing and markdown-to-TTS alignment guidance.

---

### [2026-02-22] Stop tracking generated JS outputs

**Context:** Repo policy changed: generated build outputs should not be committed. Only source files stay tracked; CI build produces runtime JS before deploy.

**What happened:**
- Updated `.gitignore` to ignore generated outputs:
  - `app.js`
  - `lib/*.js`
- Kept source/runtime JS files tracked:
  - `sw.js`
  - `worker/cors-proxy.js`
  - `vendor/*.js`
- Updated docs (`README.md`, `AGENTS.md`, codemaps, lessons) to reflect that root JS build outputs are generated and gitignored.
- Confirmed build and tests still pass with generated output policy.

**Outcome:** Success. Repo now tracks source, not generated app bundle outputs.

**Insight:** Ignoring only generated runtime outputs (`app.js`, `lib/*.js`) keeps commits cleaner while preserving tracked JS files that are true source (SW, worker, vendor).

**Promoted to Lessons Learned:** Yes — generated output tracking policy.

---

### [2026-02-22] Remove redundant GitHub Worker deploy workflow (Cloudflare Git is source of truth)

**Context:** Cloudflare already redeploys the Worker from Git commits on `main` for `worker/**`. The repo intentionally does not store Cloudflare credentials in GitHub secrets.

**What happened:**
- Deleted `.github/workflows/deploy-worker.yml` to stop guaranteed-failing duplicate deploy attempts.
- Updated docs to reflect the real deployment ownership:
  - `README.md` now documents Cloudflare Git integration + Worker bindings in Cloudflare.
  - `AGENTS.md` and `doc/codemaps/architecture.md` now describe Pages-via-GitHub-Actions and Worker-via-Cloudflare split.
  - `worker/cors-proxy.js` header comments now reference Cloudflare Git/Wrangler deploy paths.
- Kept `PROXY_SECRET` injection in `deploy-pages.yml` (conditional on secret presence) so authenticated Worker setups continue working.

**Outcome:** Success. CI scope is cleaner and aligned with operational reality without breaking authenticated proxy requests.

**Insight:** When deployment ownership is external (Cloudflare Git), redundant in-repo deploy workflows create noise and failures; remove them and document one deploy authority.

**Promoted to Lessons Learned:** Yes — single-source deployment ownership.

---

### [2026-02-22] Fix translation failures on GET-only proxy paths

**Context:** User reported translation failures with `405 Only GET requests are allowed` (`batch 1/2`). That indicates a deployed or routed proxy path rejecting POST requests.

**What happened:**
- Added client fallback in `src/lib/translator.ts`:
  - primary request stays `POST /?action=translate`
  - on HTTP 405, retry once via `GET /?action=translate&text=...&from=...&to=...`
- Extended Worker compatibility in `worker/cors-proxy.js`:
  - `?action=translate` now supports both POST and GET
  - kept existing validation, limits, and response shape
- Added coverage in `src/__tests__/translator.test.ts`:
  - new test verifies POST-405 then GET fallback succeeds
- Updated `AGENTS.md` and `LESSONS_LEARNED.md` to document POST/GET translation compatibility.

**Outcome:** Success. Local build and tests are green (`165 tests passed`), and the app now handles POST-hostile translation paths more robustly.

**Insight:** For public edge proxies, transport-method compatibility matters as much as endpoint semantics; a GET fallback on 405 can recover real user paths without changing UI behavior.

**Promoted to Lessons Learned:** Yes — translation GET fallback pattern.

---

### [2026-02-22] Add iOS & Samsung voice support — language-code-based voice filtering

**Context:** The voice dropdown only showed voices matching hardcoded names `['Ioana', 'Samantha']`, which may not exist on iOS Safari or Samsung Internet. User requested cross-platform support with only English and Romanian voices selectable.

**What happened:**
- Added 6 Claude agent definitions (architect, planner, refactor-cleaner, doc-updater, security-reviewer, code-reviewer) to `.claude/agents/` from `fabian20ro/everything-claude-code`.
- Replaced `ALLOWED_VOICES = ['Ioana', 'Samantha']` (name-based whitelist) with `ALLOWED_LANG_PREFIXES = ['en', 'ro']` (language-code-based whitelist) in `src/app.ts`.
- Updated `populateVoices()` to filter by `voice.lang.startsWith(prefix)` and sort voices by language group then name.
- Broadened `selectVoice()` in `src/lib/tts-engine.ts` to prefer enhanced/premium voices across platforms (regex `/google|enhanced|premium/i` instead of `/google/i`).
- Added 5 cross-platform voice selection tests: iOS Enhanced, Samsung Premium, iOS fallback, mixed platforms, multi-region lang variants.
- Ran security review (all clear) and code review via agent definitions.
- Build succeeds, all 170 tests pass.

**Outcome:** Success. Voice dropdown now shows all English and Romanian voices available on any platform (Pixel, iOS, Samsung).

**Insight:** Filtering Web Speech API voices by `voice.name` is inherently non-portable — voice names vary across platforms. Filtering by `voice.lang` prefix (BCP-47 language tag) is standardized and works everywhere. The language-code approach is still a whitelist (only allowed languages appear), maintaining the same security posture.

**Promoted to Lessons Learned:** Yes — cross-platform voice filtering pattern.

---

### 2026-02-22 — Add 3 themes + segment control UI for theme/language

**Task:** Add three selectable themes (Dark, Light, Khaki), replace radio buttons with horizontal segment controls for theme and language selection, use flag emojis for language options.

**Changes:**
- `settings-store.ts`: Added `Theme` type via `THEMES` const array for easy extensibility, added `theme` field to `AppSettings`
- `style.css`: Replaced `@media (prefers-color-scheme: light)` with `[data-theme]` attribute selectors for 3 themes (Dark=light blue accent, Light=dark green accent, Khaki=warm accent). Added `.segment-control` component. Added `--hover-overlay` variable for theme-aware hover states
- `index.html`: Added `data-theme="dark"` to `<html>`, added theme selector segment control in settings, replaced language radio groups with segment controls using flag emojis (🌐/🇬🇧/🇷🇴)
- `dom-refs.ts`: Replaced `settingsLangRadios`/`playerLangRadios` with `themeBtns`/`settingsLangBtns`/`playerLangBtns`
- `app.ts`: Added `applyTheme()` and `updateSegmentButtons()` helpers, wired up theme buttons and new language segment buttons
- `article-controller.ts`: Updated `syncLanguageControls()` to use segment buttons instead of radio inputs
- Updated test to include `theme` field in `AppSettings`

**Outcome:** Success. Build clean, all 170 tests pass.

**Insight:** Using a `THEMES` const array with `as const` and deriving the type via `typeof THEMES[number]` makes adding new themes a one-line change in the array + a CSS block. The `[data-theme]` attribute approach on `<html>` is cleaner than media queries for user-selectable themes.

**Promoted to Lessons Learned:** No

---

### [2026-02-22] Fix TTS pauses on names and abbreviations

**Context:** User reported that names like "Ilene S. Cohen, Ph.D." are read with unnatural pauses because the sentence splitter breaks on every period, producing tiny fragments like "Ilene S.", "Cohen, Ph.", "D." — each spoken as a separate `SpeechSynthesisUtterance`.

**What happened:**
- Added `mergeShortSentences()` post-processing step to `splitSentences()` in `tts-engine.ts`. After the regex splits text on punctuation, fragments shorter than 40 characters are merged with the next fragment, up to a 200-character cap (to stay safely under Android's ~15-second utterance cutoff).
- Exported `splitSentences()` for direct unit testing.
- Added 9 new `splitSentences` tests: normal splitting, name abbreviations, "Dr." prefix, multiple abbreviations in running text, long sentences staying separate, MAX_UTTERANCE_LENGTH cap, single sentence, no punctuation, empty string.
- Updated 4 existing TTSEngine tests that used short test strings (now merged by the new logic) to use sentences longer than 40 characters.
- All 179 tests pass, build clean.

**Outcome:** Success. Names and abbreviations are now spoken as part of a natural utterance instead of as isolated fragments with pauses.

**Insight:** Post-processing (merge short fragments) is more robust than trying to make the splitting regex abbreviation-aware. The 40-char minimum catches virtually all abbreviation fragments while still allowing real sentences to stand alone. The 200-char max cap preserves the Android chunking safety.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Merge short TTS paragraphs to eliminate pauses on bylines

**Context:** The sentence-merging fix alone didn't resolve TTS pauses on names. The real issue: short blocks like author bylines ("Ilene S. Cohen, Ph.D.") became their own TTS paragraphs with pause boundaries before and after. The sentence fix only helped within a paragraph.

**What happened:**
- Added `MIN_TTS_PARAGRAPH = 80` constant in `article-controller.ts`.
- Rewrote `renderArticleBody()` markdown path to accumulate short blocks (< 80 chars) and merge them into the next block's TTS paragraph. All merged visual blocks share the same `data-index`, so click-to-seek and highlighting still work.
- The fallback (non-markdown) path is unaffected — those paragraphs are already filtered by `MIN_PARAGRAPH_LENGTH = 20` in extractor.ts and tend to be full-length.
- All 179 tests pass, build clean.

**Outcome:** Success. Short bylines, credits, and headings are now spoken together with the following content instead of as isolated pause-bounded utterances.

**Insight:** TTS quality has two pause levels: inter-sentence pauses (within an utterance, controlled by punctuation) and inter-paragraph pauses (between separate `SpeechSynthesisUtterance` chains). Fixing only sentence splitting wasn't enough — the paragraph-level grouping also needed short-item merging. A threshold of 80 chars catches bylines/credits while keeping real paragraphs separate.

**Promoted to Lessons Learned:** No — second occurrence of TTS pause issue, but different root cause (paragraph level vs sentence level). If it recurs, promote the two-level pause insight.

---

### [2026-02-22] Filter non-speakable paragraphs from TTS (images, data URIs, HTML tags, code blocks)

**Context:** User reported that TTS reads non-article content aloud — raw HTML `<img>` tags, data URIs, long image URLs, and other non-text artifacts that survive the extraction pipeline as paragraphs.

**What happened:**
- Extracted common content-stripping logic into `stripNonTextContent()` in `extractor.ts` — strips raw HTML tags, data URIs, and very long URLs (80+ chars).
- Applied `stripNonTextContent()` in both `stripMarkdownSyntax()` (markdown path) and `splitPlainTextParagraphs()` (plain text fallback path), ensuring consistent filtering regardless of which extraction path is used.
- Added `isSpeakableText()` filter to both `markdownToParagraphs()` and `splitPlainTextParagraphs()` — requires at least 3 word-like tokens (2+ letter sequences) to pass, filtering out paragraphs that are mostly URLs, base64 data, or non-text artifacts.
- Updated `renderArticleBody()` in `article-controller.ts` to skip `<pre>` blocks (code isn't meaningful when spoken) and handle `<figure>` blocks by only extracting figcaption text (skip image-only figures).
- Added 5 new tests: HTML tag stripping, data URI filtering, image-markdown filtering, Romanian diacritics preservation, and Jina image-only paragraph filtering.
- All 185 tests pass, build clean.

**Outcome:** Success. Non-speakable content (images, code blocks, data URIs, raw HTML) is now filtered from TTS paragraphs at both the extraction and rendering layers.

**Insight:** Content filtering must be applied in ALL paragraph extraction paths, not just the primary one. The markdown path (`markdownToParagraphs`) and the plain-text fallback path (`splitPlainTextParagraphs`) both need the same stripping and filtering, since articles can take either path depending on Readability/TurndownService success.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix autoscroll highlight desync (ordinal position vs data-index)

**Context:** User reported that TTS autoscrolling sometimes lags behind — highlighting/scrolling to the wrong paragraph after recent commits that filter non-speakable content (images, code blocks, PRE elements).

**What happened:**
- Investigated the full TTS → highlight → scroll pipeline across `tts-engine.ts`, `article-controller.ts`, and `app.ts`.
- Root cause: `highlightParagraph()` in `app.ts` used ordinal position (`querySelectorAll('.paragraph')[i]`) to match against TTS paragraph index. Since commit `5a03552` introduced short-block merging (bylines/headings < 80 chars merged with next block), multiple DOM elements share the same `data-index` but have different ordinal positions. Ordinal position ≠ TTS index when merging occurs.
- The filtering commit (`74ea693`) made it worse by changing which blocks participate in merging, increasing the frequency of the mismatch.
- Fix: rewrote `highlightParagraph()` to use `data-index` attribute (already set by `renderArticleBody`) instead of ordinal position. All merged blocks with the same TTS index now highlight together, and `scrollIntoView` targets the first block of the correct TTS paragraph.
- Added inline documentation in `article-controller.ts` at the `flush()` function and skip logic to document the `data-index` contract.
- All tests pass, build clean.

**Outcome:** Success. Autoscroll now correctly tracks TTS position regardless of block merging or filtering.

**Insight:** When DOM elements have a many-to-one relationship with logical indices (via merging), ordinal position in query results is unreliable. Always use the explicit `data-index` attribute for lookup. The `data-index` was already being set correctly — only the consumer was wrong.

**Promoted to Lessons Learned:** Yes — 2nd occurrence of TTS-DOM index mismatch. Added lesson about never using ordinal DOM position for TTS paragraph lookup.

---

### [2026-02-23] Fix PWA background audio and wake lock re-acquisition

**Context:** User reported two issues: (1) audio stops when the PWA goes to background on Android, (2) screen doesn't stay awake during playback.

**What happened:**
- **Background audio fix:** Chrome on Android suspends JavaScript when a PWA goes to background, killing the `speechSynthesis` callback chain. The existing `visibilitychange` handler only resumes TTS when returning to foreground — it can't prevent the suspension. Added `src/lib/media-session.ts` which plays a silent `<audio>` track (1-second WAV generated programmatically) and registers `navigator.mediaSession` handlers. The active media session prevents Chrome from suspending the page, and adds lock screen playback controls (play/pause/skip).
- **Wake Lock fix:** The Screen Wake Lock API was already implemented and enabled by default, but per W3C spec the lock is automatically released when the page becomes hidden. The `visibilitychange` handler never re-acquired it. Added `this.acquireWakeLock()` to the visibility handler so the lock is re-acquired on return to foreground.
- Integrated `MediaSessionController` into `TTSEngine`: activated on play, paused/resumed in sync, deactivated on stop/end.
- Added article title pass-through from `ArticleController.displayArticle()` to `tts.loadArticle()` for lock screen metadata.
- Updated `sw.js` precache list to include `lib/media-session.js`, bumped SW version.
- Wrapped `audio.play()` return in `Promise.resolve()` to handle jsdom's non-spec-compliant `undefined` return.
- All 185 tests pass, build clean.

**Outcome:** Success. Both background audio persistence and wake lock re-acquisition are fixed.

**Insight:** The Web Speech API (`speechSynthesis`) is not treated as "media playback" by Android Chrome — it doesn't create a media session and gets suspended with the page. Playing a silent `<audio>` track creates a proper media session that Android keeps alive. The `navigator.mediaSession` API adds lock screen controls as a bonus. For wake lock: it's released on visibility change per W3C spec, so re-acquiring on `visibilitychange` → `visible` is mandatory.

**Promoted to Lessons Learned:** Yes — background audio via silent track + MediaSession, and wake lock re-acquisition pattern.

---

### [2026-02-23] Fix image links appearing in rendered article view (root cause)

**Context:** User reported that image links (e.g., `[Image: ...]`) still appear in the rendered article view despite multiple previous fix attempts. The issue had been reported and "fixed" multiple times, but the root cause was never addressed. Supersedes the earlier partial fix (PR #20) which only stripped raw `<img>` tags and added `img` to the sanitizer selector.

**What happened:**
- Root cause analysis revealed two independent layers of the problem:
  1. **Visual rendering layer**: `sanitizeRenderedHtml()` removed scripts/styles/iframes but never removed `<img>`, `<picture>`, `<svg>` elements. Markdown image syntax (`![alt](url)`) rendered by `marked.parse()` produced `<img>` tags that survived sanitization. Image-format links (`[Image: desc](url)`) rendered as clickable `<a>` tags. Raw HTML `<img>` tags in markdown were escaped by marked to literal `&lt;img&gt;` text.
  2. **TTS extraction layer**: `stripMarkdownSyntax()` converted `![alt](url)` → `alt` (kept alt text), so image descriptions became speakable text. `stripNonTextContent()` lacked patterns for image markdown, image URLs with common extensions, and `[Image: ...]` references.
- Previous fixes only patched individual symptoms at the TTS layer but never touched the rendering layer.
- Applied defense-in-depth fix across both layers:
  - `renderMarkdownHtml()`: Strip raw `<img>` HTML tags, image markdown (`![...](...)`) and `[Image...](...)` before passing to `marked.parse()`.
  - `sanitizeRenderedHtml()`: Remove `<img>`, `<picture>`, `<source>`, `<svg>` elements. Remove empty or image-text-only `<a>` tags.
  - `stripMarkdownSyntax()`: Remove `![...](...)` entirely (not keep alt text). Add `[Image...](...)` pattern before general link extraction.
  - `stripNonTextContent()`: Add `![...](...)`, `[Image...](...)`, standalone `[Image...]`, and image URL extension (`.jpg`, `.png`, etc.) patterns.
- Added 4 new tests: `[Image: ...](url)` link removal, short image URL removal, image-alt-text removal, false-positive preservation.
- All 189 tests pass, build clean.

**Outcome:** Success. Image content is now filtered at both the visual rendering and TTS extraction layers.

**Insight:** Content filtering bugs recur when fixes only address one layer of a multi-layer pipeline. The markdown rendering path (markdown → marked.parse → HTML → DOM) and the TTS extraction path (markdown → stripMarkdownSyntax → stripNonTextContent → isSpeakableText) are independent — fixing one doesn't fix the other. Image filtering must be applied at: (1) the markdown source before rendering, (2) the HTML sanitizer as safety net, and (3) the text extraction functions.

**Promoted to Lessons Learned:** Yes — multi-layer content filtering insight (3rd occurrence of image filtering issue).

---

### 2026-02-23 — Add document support: pasted text, PDF, TXT files

**Task:** Add support for pasted multi-paragraph text (via textarea), local PDF documents, local TXT files, and 3-sentence paragraph fallback when paragraph boundaries are undetectable.

**Changes:**
- **Sentence-based paragraph splitting** (`extractor.ts`): Added `splitTextBySentences()` and `splitSentences()` functions. Modified `splitPlainTextParagraphs()` to fall back to 3-sentence grouping when newline-based splitting yields ≤1 paragraph. Handles abbreviations (Mr., Dr., St., etc.), decimal numbers, and question/exclamation marks.
- **Textarea replacement** (`index.html`, `style.css`, `dom-refs.ts`): Replaced `<input type="text">` with `<textarea>` for URL/text input. Added auto-grow CSS (`field-sizing: content`, `max-height: 200px`). Updated `urlInput` type from `HTMLInputElement` to `HTMLTextAreaElement`. Updated Enter key handling in `article-controller.ts`: plain Enter submits for single-line input (URLs), Ctrl/Cmd+Enter always submits, bare Enter in multi-line content inserts newline.
- **File upload UI** (`index.html`, `style.css`, `dom-refs.ts`): Added hidden `<input type="file" accept=".pdf,.txt,.text">` and styled "Open PDF or Text File" button with document icon SVG. Added `fileInput` and `fileBtn` to `AppDomRefs`.
- **Text file support** (`extractor.ts`): Added `createArticleFromTextFile(file: File)` — reads via `file.text()`, uses `splitPlainTextParagraphs()` (with 3-sentence fallback), title from filename sans extension.
- **PDF support** (`extractor.ts`): Added `createArticleFromPdf(file: File)` with lazy loading of pdf.js from CDN via dynamic `import()`. Added `extractParagraphsFromTextItems()` for paragraph detection from vertical position gaps in PDF text items. Falls back to sentence splitting when structural detection yields ≤1 paragraph.
- **Controller wiring** (`article-controller.ts`): Added `handleFileUpload()` method, wired file button/input events in `init()`.
- **Tests**: Added 24 new tests covering sentence splitting, 3-sentence fallback, text file extraction, PDF text item parsing, and PDF article creation (with mocked pdfjsLib).

**Key decisions:**
1. pdf.js loaded via dynamic `import()` from jsDelivr CDN (lazy, no page-load cost). Falls back to global `pdfjsLib` if available (for tests/manual loading).
2. Changed `splitPlainTextParagraphs` threshold from `> 0` to `> 1` — single-paragraph results now trigger further splitting attempts. Updated one existing test accordingly.
3. `createArticleFromTextFile` does NOT delegate to `createArticleFromText` (which strips first line as title). Instead builds Article directly with filename as title and all content as body.

**Outcome:** All 213 tests pass (189 existing + 24 new), build clean.

**Insight:** When composing functions (`createArticleFromTextFile` → `createArticleFromText`), the inner function's assumptions (first line = title) may not match the outer context (title = filename). Direct construction is safer than post-hoc overriding when the inner function mutates the input.

**Promoted to Lessons Learned:** No

---

### [2026-02-23] Periodic maintenance — audit and clean all config files

**Context:** Ran the periodic maintenance protocol per `SETUP_AI_AGENT_CONFIG.md`. First maintenance pass on this project.

**What happened:**
- **AGENTS.md audit:** Stripped from 114 lines to ~42 lines. Removed all discoverable content (project overview, tech stack, codemaps links, repository layout, CI/CD, testing notes) and all content duplicated in LESSONS_LEARNED.md (9 items: .js extensions, outDir overlap, SW plain JS, globals, Worker env bindings, extractUrl behavior, TTS _speakGen, POST-hostile paths, npm tsc). Restructured to spec template: Constraints (2 non-discoverable items), Legacy (empty), Learning System, Sub-Agents table.
- **LESSONS_LEARNED.md audit:** All 24 lessons verified current and relevant. Zero stale, zero duplicated. No changes needed.
- **ITERATION_LOG.md audit:** 25 entries reviewed. All 3 repeated patterns already promoted. Added missing "Promoted to Lessons Learned" fields to 2 entries (themes, document support).
- **Sub-agents audit:** Trimmed 5 agents from over 100 lines to under 100 each — removed generic content irrelevant to this browser-only PWA (React/Next.js patterns, SQL injection, CQRS/Event Sourcing, Stripe example, Redis ADR). Created 2 missing agents (agent-creator.md, ux-expert.md).
- **Cross-file check:** Eliminated all AGENTS.md ↔ LESSONS_LEARNED overlap. Updated sub-agents table to match 8 agents in .claude/agents/.

**Outcome:** Success. All files pass the maintenance spec verification checklist.

**Insight:** AGENTS.md had grown to 114 lines mostly through discoverable content and duplicated lessons — exactly what the research (Evaluating AGENTS.md) warns against. Stripping to bootstrap-only content reduced it by 63%. The sub-agents inherited from a template repo contained generic patterns (React, SQL, Redis) irrelevant to this project.

**Promoted to Lessons Learned:** No — first maintenance pass, no reusable lesson yet.

---

### [2026-02-24] Fix PWA background playback — audio element must be in DOM

**Context:** User reported that PWA still stops playback when the screen is closed or the app is minimized, despite the silent audio + MediaSession implementation from 2026-02-23.

**What happened:**
- Root cause: the `<audio>` element created by `MediaSessionController` was never appended to `document.body`. Android Chrome ignores detached audio elements when deciding whether to suspend a page — the silent track was playing but the browser didn't "see" it as a real media session.
- Three fixes applied to `media-session.ts`:
  1. **Append audio to DOM** — `ensureAudio()` now calls `document.body.appendChild(this.audio)` with `playsinline` attribute. This is the critical fix.
  2. **Visibility change handler** — Added `visibilitychange` listener in the controller that restarts the silent audio if the browser paused it while backgrounded.
  3. **Keep-alive watchdog** — 5-second interval timer that checks if the audio is still playing and restarts it if not. Belt-and-suspenders defense.
- Increased silent WAV duration from 1 second to 10 seconds. Reduces loop restarts and is more reliably treated as "real" media by some Android Chrome versions.
- Fixed `tts-engine.ts` visibility change handler to call `mediaSession.notifyResume()` when returning from background, ensuring the silent audio gets restarted alongside TTS recovery.
- Bumped SW_VERSION to `2026.02.24.1`.
- All 214 tests pass, build clean.

**Outcome:** Success. The silent audio element is now in the DOM and has multiple recovery mechanisms.

**Insight:** Creating an `<audio>` element with `document.createElement()` and calling `.play()` on it is not sufficient for Android Chrome media session recognition. The element MUST be in the DOM (`document.body.appendChild(audio)`) for the browser to treat it as real media that prevents page suspension. Additionally, the browser may pause the audio when the page goes to background — a periodic keep-alive and `visibilitychange` handler provide defense-in-depth.

**Promoted to Lessons Learned:** Yes — updated existing background audio lesson with DOM requirement.

---

### [2026-02-24] YouTube Music-style media notification playbar + background TTS watchdog

**Context:** User reported that audio stops after the current sentence when minimizing (only works the first time). Requested YouTube Music-style notification playbar with artwork, progress bar, and seek controls.

**What happened:**
- **Bug fix — TTS watchdog timer:** Added a 3-second interval watchdog in `tts-engine.ts` that detects when `speechSynthesis` has silently stalled (Chrome Android may drop `speak()` calls from backgrounded pages) and restarts the utterance chain from the current position. Wired into play/pause/resume/stop lifecycle. This complements the existing `visibilitychange` handler (which only fires on return to foreground) by providing continuous background recovery.
- **Artwork in notification:** Added `artwork` field to `MediaMetadata` in `media-session.ts` using the existing app icons (`icon-192.png`, `icon-512.png`). Static icons chosen over dynamic canvas/og:image for simplicity and offline reliability.
- **Notification seekbar via `setPositionState()`:** Added character-count-based timeline estimation (`computeTimeline()` pure function) that maps discrete paragraph/sentence positions to continuous seconds. Called on every sentence completion via `emitProgress()`. Enables the OS to show a progress bar with estimated time in the notification.
- **Seek action handlers:** Added `seekforward` (maps to `skipSentenceForward`), `seekbackward` (maps to `skipSentenceBackward`), and `seekto` (reverse-maps time position to paragraph/sentence via character count) action handlers. Extends `MediaSessionActions` interface with optional seek methods.
- **`seekToTime()` method on TTSEngine:** Reverse-maps seconds to paragraph/sentence position using the same character-count model, enabling notification seekbar dragging.
- Added 4 new tests: `seekToTime` paragraph jump, `computeTimeline` at start/advancing/rate scaling/end.
- All 219 tests pass, build clean.

**Outcome:** Success. Full media notification with artwork, title, progress bar, and all playback + seek controls. Background TTS stalling fixed by watchdog.

**Insight:** `navigator.mediaSession.setPositionState()` is what unlocks the progress bar and time display in Android's media notification. Without it, you get buttons only. The character-count estimation (~14 chars/sec at 1x rate) is a good-enough approximation for TTS timeline; exact accuracy is impossible since TTS rate varies per word. A TTS-specific watchdog (separate from the audio keep-alive) is needed because `speechSynthesis.speak()` can silently fail in background even when the page stays alive via silent audio.

**Promoted to Lessons Learned:** Yes — TTS background watchdog pattern and setPositionState for notification seekbar.

---

### [2026-02-24] Audio-based TTS for background playback + resource leak fixes

**Context:** Audio stopped when the installed PWA went to background (lock screen, switch apps). User saw the media notification with progress bar but heard nothing. Previous watchdog-based fixes (retrying `speechSynthesis.speak()` every 3s) created an infinite battery-draining loop without producing any audio.

**What happened:**
- **Root cause identified:** `speechSynthesis` is fundamentally blocked by Chrome on Android when the renderer is hidden. The silent `<audio>` track keeps the page alive (JS runs), but Chrome's speech synthesis bridge is suspended. No amount of retrying fixes this — it's a platform limitation.
- **Solution: Audio-based TTS.** Added `?action=tts&text=...&lang=...` endpoint to the Cloudflare Worker, proxying to Google Translate TTS (`translate.googleapis.com/translate_tts?client=gtx`). Returns MP3 audio. Client fetches per-sentence audio and plays through an `<audio>` element — which is proven to work in background.
- **New module `src/lib/tts-audio-fetcher.ts`:** Stateless fetcher: `fetchTtsAudio(text, lang, config) → blobUrl | null`. 10s timeout, includes proxy secret.
- **Rewrote `src/lib/tts-engine.ts`:** Primary path fetches audio via worker and plays through `<audio>` element. Falls back to `speechSynthesis` when audio fetch fails (offline, rate limited). Pre-fetches next 2 sentences while current plays. Uses `audio.playbackRate` for speed control.
- **Removed infinite TTS watchdog loop** — the main battery drain culprit. Replaced with dead-man's switch: auto-stops after 30s of no audible progress.
- **Resource leak fixes (from security audit):**
  - Named `visibilitychange` listeners in both `TTSEngine` and `MediaSessionController` for proper removal in `dispose()`.
  - Added `TTSEngine.dispose()` method: removes listeners, clears audio cache, removes audio element.
  - Blob URL cleanup: revoked on audio end, cache cleared on stop/loadArticle.
  - Wake lock race condition fix: releases sentinel if stopped while awaiting request.
  - Added `clearResumeTimer()` call in `handleEnd()`.
  - Added `pagehide` cleanup in `app.ts` calling `tts.dispose()` and `updateManager.dispose()`.
- Updated test helper to pass new `TTSConfig` constructor shape. All 219 tests pass.

**Outcome:** Success. Audio-based TTS uses the `<audio>` element which survives Android backgrounding. Dead-man's switch prevents battery drain. Resource leaks fixed.

**Insight:** On Android Chrome, `speechSynthesis` will NEVER work in background — the browser explicitly suspends the speech synthesis bridge for backgrounded pages, regardless of silent audio tricks or watchdog retries. The only path to background TTS is to play actual audio data through an `<audio>` element. Google Translate's undocumented TTS endpoint (`translate.googleapis.com/translate_tts?client=gtx`) works well for this: returns MP3, supports ~200 char text, works through a Cloudflare Worker proxy.

**Promoted to Lessons Learned:** Yes — audio-based TTS as the only viable approach for background speech on Android Chrome.

---

### [2026-02-24] Fix 6 logic bugs in queue system (PR review feedback)

**Context:** devloai bot code review identified 6 logic bugs in the queue system (queue-controller, queue-store, app.ts).

**What happened:**
- **Fix 1 — Inverted dedup predicate** (`queue-store.ts:83`): `i.url !== item.url || !item.url` kept all items when URL was empty. Fixed to `!item.url || i.url !== item.url` — skip dedup for empty URLs.
- **Fix 2 — Dead secondsLeft** (`queue-controller.ts:187-200`): `secondsLeft` computed once, never decremented. Since `AUTO_ADVANCE_DELAY_MS` is only 2s, removed the parameter entirely from the callback signature.
- **Fix 3 — UUID-as-URL fallback** (`app.ts:91`): `syncCurrentByUrl(article.resolvedUrl || item.id)` passed UUID when URL absent. Added `syncCurrentById(id)` method and used it as fallback.
- **Fix 4 — Accumulating transitionend listeners** (`app.ts:199-206, 129-137`): `hideSnackbar` and `closeQueueSheet` registered new listeners on every call. Added early return guards when already hiding/hidden.
- **Fix 5 — Optimistic index mutation** (`queue-controller.ts:144-167`): `playNext`/`playPrevious` incremented index before async load. Refactored to commit index only on success, with error callback on failure.
- **Fix 6 — File/paste articles dropped on reload** (`queue-store.ts:34`): `isValidQueueItem` required `isValidArticleUrl(url)`, rejecting empty URLs. Changed to `i.url === '' || isValidArticleUrl(i.url)`.

**Outcome:** Success. All 235 tests pass, build clean.

**Insight:** When persisting items that may or may not have a URL (file/paste vs fetched articles), URL validation must explicitly allow the empty case. Similarly, async operations that mutate shared state (like `currentIndex`) should follow a "compute → attempt → commit" pattern, not "commit → attempt → hope".

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-25] Fixed background playback, EPUB chapters, and internet requirement question

**Context:** 3 user-reported issues: background audio stopping mid-article, EPUB files not showing chapter list, confusion about internet requirement for playback.

**What happened:**
- **Background playback fix:** Modified `_onVisibilityChange()` handler in `tts-engine.ts` to restart TTS audio playback when returning from background. If audio-based TTS was playing, the audio element resumes; if speechSynthesis was active, a new sentence fetch is triggered. This ensures playback continues naturally after minimizing the app.
- **EPUB chapter detection fix:** Updated `extractTextFromXhtml()` in `extractor.ts` to preserve heading markup as markdown (e.g., `## Heading Text`) instead of stripping it. The chapter list builder detects markdown headings to populate chapters. Also exempted heading paragraphs from the minimum-length and speakable-content filters that normally apply to extracted text, allowing short chapter titles to be properly handled.
- **Internet requirement clarification:** Confirmed that internet is required for the primary TTS path (audio fetched from Cloudflare Worker proxying Google Translate TTS). However, when offline, the app falls back to `speechSynthesis` (built-in browser voices) — but this fallback only works in the foreground (browser limitation on Android). Users can load articles while online, then read them offline using device voices if needed.
- All 244 tests pass, build succeeds.

**Outcome:** Success. Background playback now continuous, EPUB files show their chapter structure, and user expectations around internet vs offline are clarified.

**Insight:** When the EPUB XHTML parser extracts headings (h1–h6), they must be emitted as markdown headings to be detected by the chapter list builder — this mirrors the existing PDF approach where outline entries become markdown headings. The filter pipeline needs to exempt these short heading strings from length validation. For background audio on Android: the visibility change handler is the natural restore point (returns from background, restarts playback). This is the 4th background audio fix (initial DOM requirement, keep-alive watchdog, audio-based approach, now the visibility handler) — the lesson about `speechSynthesis` not working in background is already in `LESSONS_LEARNED.md`. No new lesson to promote.

**Promoted to Lessons Learned:** No — refinement of existing patterns.

---

### 2026-02-25 — Deep TTS prefetch + device voice only setting

**Task:** User reported two issues: (1) voice switching between online (Google Translate TTS) and offline (speechSynthesis) is jarring when internet drops for ~90 seconds in the subway, and (2) they wanted an option to use the device voice consistently.

**Changes:**
- Increased TTS prefetch window from 2 to 20 sentences ahead (sliding window, refilled after each sentence completes) to buffer ~2 minutes of audio, covering subway station gaps
- Bumped Cloudflare Worker rate limit from 20 to 60 requests/minute to accommodate the burst of prefetch requests
- Added `setDeviceVoiceOnly()` method to TTSEngine — stores/restores `audioConfig` to cleanly switch between audio-based TTS and speechSynthesis-only mode
- Added `deviceVoiceOnly` boolean to settings store with localStorage persistence
- Added "Use device voice only (no background playback)" checkbox to settings drawer
- Wired setting through app.ts with standard checkbox pattern

**Outcome:** Success. The deeper prefetch buffer should survive 90-second internet gaps without voice switching. Users who prefer consistent device voice can enable the toggle, trading background playback for voice consistency.

**Insight:** The `audioConfig` null-check pattern already gates all audio-vs-speechSynthesis paths in TTSEngine, so toggling device voice only required just saving/restoring the config object — no control flow changes needed. The rate limit increase from 20→60 req/min gives headroom for the initial 20-sentence burst plus ~12 sentences/min during normal playback. Note: this was ported to the new AudioTTSBackend architecture during the merge conflict resolution.

**Promoted to Lessons Learned:** No — straightforward feature addition using existing patterns.

---

### [2026-02-25] Fix 7 playback state machine bugs — queue transitions, resume, visibility, chapter sync

**Context:** Production bugs: resume fails after queue transitions, screen sleeps during playback, chapter clicks don't sync audio position, auto-advance timer stalls playback. Also added version number in settings drawer.

**What happened:**

**Playback state machine bugs:**
- **Bug 1 — `_stopped` not reset after `loadArticle()`** (`tts-engine.ts:263`): `stop()` sets `_stopped = true` to block `speakCurrent()`. When loading new content, the flag stays true, blocking playback on the next play request. Added `this._stopped = false` after the stop/load sequence. Root cause of resume failing after queue transitions.
- **Bug 2 — Resume watchdog missing `_speakGen++`** (`tts-engine.ts:329`): The speechSynthesis resume fallback timer (3s of no audio detected) calls `cancel()` + `speakCurrent()` to recover. Without incrementing the generation counter first, the stale `onend` callback from the cancelled utterance could fire and double-advance position. Added `this._speakGen++` before `cancel()`.
- **Bug 3 — Wake lock not re-acquired on `resume()`** (`tts-engine.ts:317`): The W3C Screen Wake Lock API auto-releases when the page goes hidden (backgrounded). `resume()` re-starts playback but didn't re-acquire the lock, so the screen sleeps on timeout. Added `this.acquireWakeLock()` call to `resume()`.
- **Bug 4 — Wake lock guard incomplete** (`tts-engine.ts:759`): The async `acquireWakeLock()` method didn't handle the race where the user pauses while the lock request is pending. Added a guard to release immediately if `_isPaused` is true.
- **Bug 5 — Visibility change handler incomplete** (`tts-engine.ts:231-248`): On `hidden`, didn't clear the resume watchdog timer (would fire while JS suspended in background, causing false triggers on resume). On `visible`, didn't reset `_lastProgressTime` (dead-man's switch would count suspended duration as "no progress"). Fixed: clear resume timer on `hidden`, reset progress timer and acquire wake lock on `visible`.
- **Bug 6 — Auto-advance not cancelled** (`queue-controller.ts:190`, `app.ts:709`): The queue auto-advance timer (2s delay between articles) wasn't cancelled when the user seeks within an article or calls `playItem()`. The stale timer could fire mid-seek and cause unintended queue transitions. Added cancellation in `playItem()` and progress bar seek handler.
- **Bug 7 — Chapter click doesn't sync TTS** (`app.ts:541-568`): Chapter list click scrolled to the heading but didn't sync audio position. Added DOM walk from heading to find the corresponding `.paragraph` element and call `tts.jumpToParagraph()`. Falls back to jumping to the last paragraph if heading is at the end.

**Feature — Version number in settings:**
- Added `<p id="app-version">` element to `index.html` settings drawer.
- Wired through `dom-refs.ts`.
- Populated in `app.ts` with `Version ${shortRelease(APP_RELEASE)}`.

**Outcome:** Success. All 235 tests pass, build clean. Queue transitions now preserve playback state, screen stays on during playback, chapter clicks sync audio, and auto-advance no longer interferes with seeks.

**Insight:** The TTS state machine has many interdependent flags (`_stopped`, `_isPaused`, `_speakGen`, resume timer, progress timer, wake lock, auto-advance timer). Changing one state (e.g., loading new article after `stop()`) requires cascading updates to related state (reset `_stopped`, cancel timers, acquire wake lock). Visibility changes are especially tricky: JS suspension in background breaks timer accuracy, so timers should be cleared when backgrounded and metrics reset when returning to foreground. Generation counters must be incremented in ALL code paths that call `cancel()`+`speakCurrent()`, not just the main skip paths. Chapter/section navigation (DOM-based UX) must explicitly sync the TTS position via `jumpToParagraph()` or similar — DOM scroll alone doesn't update audio state.

**Promoted to Lessons Learned:** Yes — five new lessons added to "TTS State Management & UI Sync" section covering: `_stopped` reset, `_speakGen` in all cancel paths, wake lock re-acquisition, visibility handler edge cases, auto-advance timer cancellation, and chapter sync requirements.

---

### [2026-02-25] Full codebase structural and maintainability analysis

**Context:** Comprehensive code analysis using four parallel specialized agents (Architect, Security Reviewer, Code Reviewer, Refactor Cleaner) to identify structural, security, quality, and dead code issues across the entire codebase.

**What happened:**
- Launched all four agents in parallel to analyze the ~7100-line codebase
- Architect identified: `app.ts` as a 850-line god function, Article object mutation as hidden side effect, near-duplicate `Article`/`StoredArticleContent` types, tight coupling between QueueController and ArticleController
- Security reviewer found 12 issues: SSRF via redirect-following in worker, XSS sanitizer missing `data:` URI checks, no Content Security Policy, CDN scripts without SRI, CORS wildcard fallback
- Refactor cleaner found 9 safely removable dead code items (~80 lines), 3 careful items (unused feature scaffolding), and 5 consolidation opportunities (duplicate `splitSentences`, repeated image-stripping regexes, triplicated drawer open/close logic)
- Code reviewer confirmed architectural issues and added: `parsePdfFromArrayBuffer` as 102-line function, `filterParagraphs` pattern duplicated 4x in extractor.ts, inline import type cast in queue-controller.ts
- All findings compiled into `docs/code-analysis-2026-02-25.md` with prioritized remediation matrix

**Outcome:** Success. Complete analysis report produced with 18 prioritized improvement items across three tiers (Must Fix, Should Fix, Nice to Have). No critical security issues, but several HIGH-severity items identified.

**Insight:** The codebase has a solid foundation — zero `any` types, clean dependency graph, good error handling, 0 npm vulnerabilities. The main structural risks are: (1) `app.ts` accumulating too much responsibility, (2) shared mutable `Article` objects creating hidden coupling, and (3) the HTML sanitizer having gaps that are unprotected due to missing CSP. The dead code (~80 lines) is modest and safe to remove. The most impactful single refactor would be extracting QueueRenderer from `app.ts`.

**Promoted to Lessons Learned:** No — findings are analysis observations, not reusable patterns. Report is in `docs/code-analysis-2026-02-25.md`.

---

### [2026-02-25] Architecture refactoring — 4 items implemented

**Context:** Prior investigation identified 5 architectural improvements. Validated, prioritized, and implemented 4 of them (deferred DOM decoupling as poor cost/benefit).

**What happened:**
- Phase 1: Created `src/lib/language-config.ts` as single source of truth for Language type, supported languages, TTS codes, and translation target. Updated 6 consumer files. Zero behavioral change.
- Phase 2: Split `extractor.ts` (1240 lines) into `src/lib/extractors/` subdirectory with 6 focused modules (types, utils, extract-html, extract-pdf, extract-epub, extract-text). Original file becomes a barrel re-exporting everything — zero consumer changes needed. Moved `sanitizeRenderedHtml` from article-controller to extract-html.
- Phase 3: Vendored pdf.js (pdfjs-dist@4.9.155) and JSZip (3.10.1) from npm into `vendor/`. Updated extractors to load from local paths instead of CDN URLs. Enables offline PDF/EPUB support.
- Phase 4: Extracted TTSBackend interface with AudioTTSBackend and SpeechTTSBackend implementations. TTSEngine delegates speak/pause/resume/cancel to backends while keeping all orchestration. Added `activeBackend` tracker for correct pause/resume routing.
- Deferred item 5 (Decouple ArticleController from DOM): 545-line file is manageable, no component framework, no existing tests, poor cost/benefit.

**Outcome:** Success. All 244 tests pass after each phase. 4 commits, clean build. CDN blocked by proxy so used npm to download vendor files.

**Insight:** The barrel re-export pattern for extractor split was key — zero consumer changes. For TTS strategy: the `activeBackend` tracker was the missing piece that made pause/resume routing clean. The generation counter pattern (stale callback protection) must stay in the engine, not the backends.

**Promoted to Lessons Learned:** No — these are one-time refactoring decisions.

---

### 2026-02-26 — EPUB URL support + extract-url refactor + chapters drawer fix

**Task:** User reported two issues: (1) pasting a Gutenberg EPUB URL gave "URL does not point to an HTML page or PDF" error, (2) chapters drawer on desktop had text positioned outside the viewport.

**What happened:**
- Diagnosed EPUB URL issue: worker's `fetchArticleHtml()` only accepted PDF and HTML content-types, rejecting `application/epub+zip`. Client's `extractArticle()` also lacked EPUB format detection.
- Diagnosed chapters drawer CSS: desktop media query used `left: 50%; margin-left: -360px` without overriding `right: 0`, causing incorrect width calculation. Source order issue: media query came before base `.chapters-sheet.open`, so base transform always won.
- Created `src/lib/extractors/extract-url.ts` — extracted URL fetch orchestration from `extract-html.ts` (SRP: HTML parsing vs URL format detection). Added `isEpubUrl()` (handles `.epub` and `.epub.noimages` patterns), `extractArticleFromEpubUrl()`, content-type detection, and magic bytes fallback (`PK` for ZIP/EPUB).
- Refactored `extract-epub.ts`: shared core logic via `parseEpubCore()`, exposed `parseEpubFromArrayBuffer()` for URL-fetched EPUBs.
- Worker: added EPUB content-type handling, generalized `fetchPdfResponse()` → `fetchBinaryResponse()` (parameterized label, contentType, magicPrefix).
- Fixed desktop chapters CSS: used `transform: translateX(-50%)` (matching player-controls), `right: auto`, placed media query after base styles for correct cascade.
- Added 5 tests for EPUB URL detection. Key challenge: `loadJSZip()` hangs in jsdom (script tag never fires onload), solved by mocking `globalThis.JSZip` directly.

**Outcome:** Success. 249 tests pass (5 new), clean build. Pushed to `claude/add-epub-support-g3C4h`.

**Insight:** When adding format support to a URL-fetching pipeline, changes are needed at 3 layers: (1) proxy/worker must accept the content-type and return binary, (2) client URL orchestrator must detect format by URL/content-type/magic-bytes, (3) format-specific parser must accept ArrayBuffer (not just File). The `fetchBinaryViaProxy()` helper consolidates the shared binary fetch logic for both PDF and EPUB.

**Insight:** CSS centering with `left: 50%; margin-left: -Npx` is fragile — it hardcodes element width and doesn't work when `right: 0` isn't overridden. `transform: translateX(-50%)` is responsive to actual element width. When combining with Y transforms for show/hide animation, both transforms must be in the same `transform` property.

**Promoted to Lessons Learned:** Pending — both insights may be reusable.

---

### [2026-02-28] Fix play/pause voice sync bug — two simultaneous voices

**Context:** User reported pressing play/pause produced two voices reading different parts of the article simultaneously. Had to press play/pause ~8 times to stop both voices.

**What happened:**
- Root cause was a race condition between the audio backend's async fetch pipeline and the engine's pause/resume state machine.
- Four interconnected bugs: (1) `pause()` can't stop in-flight audio fetches (`audioBackend.pause()` guards on `this.audio.src` — no-op if fetch still in-flight), (2) `speakCurrent()` and `onEnd` didn't check `_isPaused` — phantom chains continued while "paused", (3) `resume()` fell through to wrong backend when phantom audio was playing, (4) audio fetch `.then()` had no generation/pause check.
- Fix: Added `_isPaused` guards to `speakCurrent()`, `onEnd`, and `onError` callbacks. Added `isValid` callback to `AudioTTSBackend.speak()` to abort stale fetches. Rewrote `resume()` else-branch for explicit backend routing (audio paused → seamless resume, speech paused → seamless resume, nothing paused → immediate cancel+respeak).
- Updated mock to track `speaking`/`paused` state. Added 4 new tests.
- All 258 tests pass.

**Outcome:** Success. Phantom playback chains eliminated. Happy-path seamless resume preserved.

**Insight:** The `_speakGen` counter only protects against stale `onEnd`/`onError` callbacks — it does NOT prevent the async `.then()` inside `AudioTTSBackend.speak()` from calling `playAudio()`. When audio fetch completes after a pause, the audio starts even though the engine thinks it's paused. Need BOTH gen checks in callbacks AND validity checks before starting new audio.

**Promoted to Lessons Learned:** Yes — extends the existing `_speakGen` lesson.

---

### [2026-04-10] Native YouTube Support + REST API + Modern Bundling

**Context:** User wants to support YouTube transcripts and expose a `/parse` endpoint for AI agents.
**Happened:**
- Removed Jina Reader fallback (UI, proxy, tests).
- Refactored extractors to be environment-agnostic (Shared Library architecture).
- Implemented native YouTube support (title, description, transcripts).
- Migrated to Vite/Wrangler bundling for both Frontend and Worker.
- Exposed `POST /parse` and `GET /parse` in Cloudflare Worker.
- Updated all mocks to use modular `vi.mock` instead of global globals.
**Outcome:** Success. All 224 tests passing. App now natively supports YouTube and exposes an AI-friendly Markdown API.
**Promoted to Lessons Learned:** Yes (Modular mocking and Bundling transitions).

---

### [2026-04-10] Periodic maintenance — audit and clean all config files

**Context:** Periodic hygiene task to keep agent context focused and lean.
**What happened:** Audited `AGENTS.md`, `LESSONS_LEARNED.md`, and sub-agents. Condensed `AGENTS.md` and consolidated visibility lessons.
**Outcome:** Success. Files are leaner and more focused.
**Promoted to Lessons Learned:** No

---

### [2026-03-01] Fix vendor.js loading failure + auto-generate PRECACHE

**Context:** PDF loading was completely broken — users reported "Could not load PDF support. The vendor file may be missing." when opening any PDF (e.g. arxiv URLs like `https://arxiv.org/pdf/2602.22010`). Previous fix attempt (PR #45) addressed reading from `globalThis` after import but didn't fix the underlying path resolution bug.

**What happened:**
- Root cause: `extract-pdf.ts` used `import('./vendor/pdfjs/pdf.min.mjs')`. Dynamic `import()` resolves paths relative to the *module* (`lib/extractors/extract-pdf.js`), not the page root. Browser tried `lib/extractors/vendor/pdfjs/pdf.min.mjs` → 404.
- Contrast: EPUB's JSZip loading used `document.createElement('script')` with `script.src = path`, which resolves relative to the page URL. That worked correctly.
- Secondary issue: `sw.js` PRECACHE array was manually maintained and had drifted — 10 of 35 lib/ files were missing, breaking offline PWA support.
- Fix 1: Resolve vendor paths via `new URL(path, document.baseURI).href` before passing to `import()`. Same fix applied to `workerSrc`.
- Fix 2: Added `scripts/update-precache.mjs` that auto-generates the PRECACHE array and bumps `SW_VERSION` at build time. Integrated into `npm run build`.
- All 258 tests pass, build is idempotent.

**Outcome:** Success — PDF loading fixed, PRECACHE always in sync with actual files.

**Insight:** Dynamic `import()` resolves relative paths from the *calling module's URL*, not the page URL. This is different from `<script src="...">` which resolves from the page. When loading vendored files from deeply nested modules, use `new URL(relativePath, document.baseURI).href` to get page-relative resolution. The EPUB extractor happened to avoid this bug by using a script tag approach.

**Promoted to Lessons Learned:** Yes

---

### [2026-04-11] Fix PDF version mismatch and YouTube 429 error handling

**Context:** User reported a PDF version mismatch (5.6.205 vs 4.9.155) and 500 errors when YouTube rate-limited the worker.

**Changes:**
- Synced vendored PDF.js worker/assets in `vendor/pdfjs/` from `node_modules/pdfjs-dist/legacy/build/` to match version `5.6.205`.
- Introduced `UpstreamResponseError` in `src/lib/extractors/types.ts` to propagate status codes from extractors to the worker.
- Updated `worker/index.ts` to return the correct status code (e.g., 429) when `UpstreamResponseError` is caught.
- Implemented "Stealth Headers" for YouTube:
    - Added `ANDROID` client context with `X-Goog-Api-Format-Version: 2` and matching `User-Agent`.
    - Switched to the more robust `json3` transcript format (replacing XML parsing).
    - Moved metadata extraction (title/description) to use the direct API instead of HTML parsing.
- Updated unit tests (`youtube.test.ts`, `worker.test.ts`) to match the new JSON-based implementation.
- Removed unused `youtube-transcript-plus` dependency from `package.json`.
- Bumped `SW_VERSION` to `2026.04.11.02` to trigger cache refresh.

**Outcome:** PDF extraction restored; YouTube rate limits correctly reported as 429 instead of 500; YouTube extraction is much more robust against bot detection; codebase cleaned up.

**Context:** PR review found four merge blockers: broken Vite build output handling, extractor API misuse in the browser caller, browser-owned YouTube transcript fetching, and worker SSRF hardening regressions.

**What happened:**
- Reworked `extractArticle()` to take an options object for `domParserCtor`, `onProgress`, and `fetcher`, then updated the browser caller and regression coverage.
- Moved YouTube transcript extraction to a worker-first path: browser YouTube URLs now call `POST /parse` with `format: "article"`, while the worker performs watch-page fetch, Innertube player lookup, and transcript XML fetch server-side.
- Replaced the old precache generator with a Vite-aware `dist/sw.js` emitter that derives PRECACHE entries from actual `dist/` assets while leaving repo-root `sw.js` as the manual `SW_VERSION` source.
- Hardened `worker/index.ts`: restored initial URL validation, timeout-backed fetches, body-size enforcement, binary magic-byte checks, rate-limit cleanup, and response headers.
- Added CI/build gates (`typecheck`, `test`, `build`) plus targeted tests for browser load-call regression, worker SSRF rejection, worker YouTube parse flow, and precache generation.
- Updated README and codemap docs for Vite output, `worker/index.ts`, and the generated service-worker flow.

**Outcome:** Success. `npm run typecheck`, `npm test`, and `npm run build` all pass; `dist/sw.js` is emitted from built assets and YouTube extraction no longer depends on browser-side direct YouTube fetches.

**Insight:** When a shared API grows environment-specific optional parameters, positional arguments become a footgun fast. An options object prevents browser/worker call-site drift and makes test coverage target the behavior instead of placeholder argument ordering.

**Promoted to Lessons Learned:** No

---

### [2026-04-11] Fix stale Worker drift, stable PWA assets, and PDF CSP/runtime issues

**Context:** Production had multiple regressions at once: GitHub Pages served a manifest/icon path combo that produced `assets/icons/...` 404s, the meta CSP blocked pdf.js worker loading and logged an ignored `frame-ancestors` directive, and the live Cloudflare Worker was still an old deployment that rejected `POST /parse` with `Only GET requests are allowed.` for YouTube extraction.

**What happened:**
- Confirmed the repo and production had diverged: local `worker/index.ts` supported `POST /parse`, but the live `pixel-article-reader` Worker in Cloudflare still served an older `cors-proxy.js` bundle with proxy-key auth and no `/parse` route. Root cause: `.github/workflows/deploy-worker.yml` had been removed, so Worker deploys drifted from the repo.
- Removed the client/Worker `PROXY_SECRET` flow end-to-end from runtime code, app wiring, worker auth checks, Wrangler config comments, and deploy-pages CI injection. Kept a backward-compatible `extractArticle()` shim only for older call sites/tests that still pass a third positional argument.
- Restored repo-owned Worker deploy automation with a dedicated `.github/workflows/deploy-worker.yml` that runs after `CI` succeeds on `main`, deploying via `wrangler` with `worker/wrangler.toml`. Also fixed `npm run worker:deploy` to use that explicit config.
- Tightened the app CSP in `index.html`: removed the ineffective `frame-ancestors` meta directive, dropped unused CDN allowances, added explicit `worker-src`, and allowed same-origin/Worker media and image sources needed by the PWA.
- Switched pdf.js worker loading from `cdnjs` to a same-origin file resolved from `document.baseURI` (`vendor/pdfjs/pdf.worker.min.mjs`). Updated Media Session artwork URLs the same way so icon resolution is stable under the app subpath.
- Extended `scripts/update-precache.mjs` to post-process `dist/`: rewrite `index.html` to use a stable root manifest/icon path, emit `dist/manifest.webmanifest`, copy stable icons and the pdf.js worker into `dist/`, prune Vite’s hashed manifest/icon artifacts, and then regenerate `dist/sw.js` precache from the final emitted files. Bumped `SW_VERSION` to `2026.04.11.01`.
- Updated README, AGENTS.md, and codemap docs to match the new deploy ownership and CSP/PWA behavior.
- Verification: `npm run typecheck`, `npm test`, and `npm run build` all passed. Built output now contains only stable PWA runtime assets (`dist/manifest.webmanifest`, `dist/icons/*`, `dist/vendor/pdfjs/pdf.worker.min.mjs`) and `dist/index.html` references them directly.

**Outcome:** Partial success. Repo/runtime code and build output are fixed locally, and the restored workflow will keep future Worker deploys in sync. Production is still serving the old GitHub Pages build and stale Worker until a push or authenticated deploy happens. A direct shell deploy was blocked because `wrangler` has no `CLOUDFLARE_API_TOKEN` in this non-interactive environment, even though local dry-run bundling worked.

**Insight:** For split-hosted PWAs, “build fixed locally” is not enough if deploy ownership is ambiguous. When the frontend and Worker ship through different mechanisms, drift becomes a product bug. Keep both deploy paths repo-owned and continuously exercised, and post-process Vite output when stable PWA asset URLs matter more than hashed asset defaults.

**Promoted to Lessons Learned:** No

---

### [2026-04-11] Fix `DOMMatrix` ReferenceError in Cloudflare Worker

**Context:** The Worker was failing to deploy with `ReferenceError: DOMMatrix is not defined`. This occurred because `pdfjs-dist` (statically imported by the extractor) references browser-only APIs at top-level.

**What happened:**
- Converted the static import of `pdfjs-dist` in `src/lib/extractors/extract-pdf.ts` to a dynamic import wrapped in a lazy-loader.
- This defers the evaluation of the heavy/browser-only PDF library until it's actually needed, allowing the Worker to pass Cloudflare's script validation during deployment.
- Verified that the Worker's `POST /parse` path for standard HTML/YouTube URLs remains lightweight and unaffected.

**Outcome:** Success. Worker deployment validation passed.

**Insight:** In shared library architectures, statically importing browser-only libraries at the top level is a "deployment footgun" for non-browser environments like Cloudflare Workers. Always use dynamic imports for platform-specific heavy lifting to ensure your entry points stay lightweight and environment-agnostic.

**Promoted to Lessons Learned:** No

---

### [2026-04-11] Fix `Deploy Worker` CI failure and upgrade GitHub Actions

**Context:** The `Deploy Worker` workflow was failing due to environment drift and a lack of dependency installation. The `cloudflare/wrangler-action@v3` was using its own Wrangler version and hiding useful error output.

**What happened:**
- Removed `cloudflare/wrangler-action@v3` from `.github/workflows/deploy-worker.yml`.
- Replaced it with a standard `actions/setup-node` + `npm ci` + `npm run worker:deploy` flow to use the repository-locked `wrangler` version.
- Upgraded `actions/checkout` to `@v5` and `actions/setup-node` to `@v6` across all workflows (`ci.yml`, `deploy-pages.yml`, `deploy-worker.yml`) to use more secure and efficient versions.
- Updated `README.md` to reflect the new Worker deployment path and clarify that it uses the repo-locked `wrangler`.
- Verified the fix locally with `npm run worker:deploy -- --dry-run` and checked `npx wrangler --version` (matched lockfile `4.81.1`).

**Outcome:** Success. The workflows are now more robust, consistent with the local environment, and easier to debug.

**Insight:** Using official "wrapper" actions like `wrangler-action` can lead to version drift between your local environment (lockfile) and CI. For critical deployment tools, it's often safer to use the project-locked version via `npm ci` and direct CLI calls. This also ensures that any shared code or dependencies imported by the Worker are correctly resolved.

**Promoted to Lessons Learned:** No

---

---

### [2026-04-13] Fix YouTube extraction 429s and metadata (description)

**Context:** User reported 429 errors on YouTube and missing full descriptions. Cloudflare Worker IPs are frequently blocked for the initial YouTube watch page fetch.
**What happened:**
- Implemented **Direct Player API Call**: Now uses a static Android InnerTube API key (`AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`) to call `v1/player` directly, bypassing the initial blocked watch page fetch.
- Added **Extraction Fallback**: Keeps the original watch page extraction flow as a fallback if the direct API call fails (e.g., due to key changes).
- Updated YouTube stealth headers: moved to modern Android client version `21.14.48` (April 2026) and SDK 34.
- Fixed typo in `Referer` headers (removed trailing space).
- Improved description extraction: now prioritizes the full description from `playerJson.microformat.playerMicroformatRenderer.description` (both `simpleText` and `runs`) over the truncated `shortDescription`.
- Enhanced 429 error reporting: now explicitly mentions "upstream" blocking to distinguish between Worker limits and YouTube blocks.
- Bumped `SW_VERSION` to `2026.04.13.01` for PWA update.
- Updated unit tests to verify the direct API flow and fallback logic. All 11 YouTube tests pass.
**Outcome:** Success. YouTube extraction is much more robust against 429s, has better metadata, and clean error reporting.
**Insight:** Bypassing the initial watch page fetch via a static API key is a highly effective way to avoid IP-based bot detection on Cloudflare Workers.
**Promoted to Lessons Learned:** Yes (YouTube direct API bypass).

---

### [2026-05-05] Reliability + offline-first hardening pass (small changes)

**Context:** Requested ordered implementation focused on small changes, offline priority, reliability first, maintainability second.

**What happened:**
- Added stale async result protection in `ArticleController` using a monotonic `loadToken` guard for URL load, file upload, and translate flows.
- Added offline preflight in URL extraction path (`navigator.onLine === false`) with immediate actionable error and fallback restore.
- Added last-session restore/persist via new `session-store.ts` (stores last successfully rendered article snapshot in `localStorage`).
- Hooked startup behavior to restore last article when opening offline without share URL params.
- Added regression test ensuring stale first request cannot overwrite a newer article load.
- Externalized proxy base config to `VITE_PROXY_BASE` with existing production URL fallback.
- Updated README + architecture codemap with explicit offline behavior notes.

**Outcome:** Reliability improved for race-prone async flows; offline user path improved without architecture churn.

**Insight:** For async UI flows, a tiny request-token guard gives disproportionate reliability gains and composes cleanly with offline fallback logic.

**Promoted to Lessons Learned:** No

---

### [2026-05-08] Queue-load normalization for corrupt or oversized storage

**Context:** Hourly maintenance pass on the article reader queue persistence path.
**What happened:**
- Updated `loadQueue()` to normalize stored queue data on read: invalid entries are dropped, and loaded queues are capped to the most recent 50 items.
- Persisted the cleaned queue back to `localStorage` so old corrupt or oversized snapshots get repaired instead of being reprocessed on every startup.
- Added regression coverage for two cases: mixed valid/invalid storage and oversized stored queues.
- Ran focused queue-store tests, then the full Vitest suite, then TypeScript typecheck.

**Outcome:** Success. Queue restoration is a little more self-healing, with no behavior change for normal queues.

**Insight:** Loading code is a good place to repair old client-side state when the fix is deterministic and low risk.

**Promoted to Lessons Learned:** No


### [2026-05-12] Document worker response headers for resolved URLs

**Context:** Small maintenance pass on the article reader docs.
**What happened:** Updated `README.md` and `doc/codemaps/modules.md` to distinguish the worker's `X-Final-URL` header on raw fetches from the `X-Resolved-Url` header exposed by `/parse`.
**Outcome:** Success. Docs now match the current worker contract more precisely.
**Insight:** When a backend exposes closely related response headers on different routes, name both explicitly in the docs so future readers don't have to infer the split.
**Promoted to Lessons Learned:** No

---

### [2026-05-13] Self-heal duplicate queue entries on load

**Context:** Small maintenance pass on the article queue persistence path.
**What happened:** Updated `loadQueue()` so stored queue snapshots are deduplicated by URL on read, keeping the most recent entry for each URL while still preserving local-file items without URLs. Added regression coverage for the duplicate-URL repair path, then ran the queue-store test file and the full Vitest suite.
**Outcome:** Success. Old queue snapshots now self-heal duplicate URL entries instead of reloading them forever.
**Insight:** When a store already repairs invalid or oversized snapshots, duplicate cleanup belongs in the same read-time normalization pass.
**Promoted to Lessons Learned:** No

---

### [2026-05-13] Document queue duplicate handling in README

**Context:** Small docs maintenance pass after queue-store normalization work.
**What happened:** Updated `README.md` so the Article Queue section now says duplicate URLs collapse to the most recent entry when the same article is reloaded.
**Outcome:** Success. User-facing docs now match the queue's current self-deduping behavior.
**Insight:** When storage normalizes itself on load, surface the user-visible effect in the docs so the behavior is discoverable.
**Promoted to Lessons Learned:** No

---

### [2026-05-13] Document queue load-time cleanup in README

**Context:** Small docs maintenance pass after queue-store normalization work.
**What happened:** Updated `README.md` so the Article Queue section now mentions that invalid stored entries are dropped on load, metadata is sanitized, and oversized snapshots are trimmed automatically.
**Outcome:** Success. User-facing docs now describe the queue's current self-healing load behavior.
**Insight:** When a store already normalizes itself on load, surface the cleanup contract in the README so the behavior is discoverable.
**Promoted to Lessons Learned:** No

---

### [2026-05-13] Harden last-article restore timestamps

**Context:** Small correctness pass on the last-session restore path.
**What happened:** Changed `loadLastArticle()` to reject non-finite `savedAt` values and added a regression test for `NaN` timestamps. Also updated the lessons log with the finite-timestamp restore rule.
**Outcome:** Success. Corrupted last-article blobs now self-heal only when the restore metadata is truly valid.
**Insight:** `typeof number` is not enough for persisted timestamps; finite validation closes the restore hole.
**Promoted to Lessons Learned:** Yes

---

### [2026-05-14] Queue metadata fallback on load

**Context:** Small maintenance pass on the article queue persistence path.
**What happened:** Updated `src/lib/queue-store.ts` so blank stored titles/site names normalize to readable defaults on load and when creating fresh queue items. Added focused regression coverage for blank metadata in both load and create paths, and synced the README queue-cleanup bullet to match.
**Outcome:** Success. Queue labels now recover more gracefully from empty persisted metadata.
**Insight:** Sanitizing persisted labels is better when blank results also get a predictable fallback; otherwise a self-heal pass can still leave empty UI text behind.
**Promoted to Lessons Learned:** No

---

### [2026-05-14] Queue language fallback on load

**Context:** Small maintenance pass on the article queue persistence path.
**What happened:** Updated `src/lib/queue-store.ts` so restored queue items normalize invalid stored language values back to English on load, and added a regression test proving the cleaned queue is written back.
**Outcome:** Success. Stale queue snapshots now recover a supported playback language instead of carrying arbitrary strings forward.
**Insight:** Persistent queue repair should normalize the playback language field too; otherwise a self-healed item can still hold an unusable state.
**Promoted to Lessons Learned:** Yes

---

---

### [2026-05-14] Validate nested paragraph data on session restore

**Context:** Small maintenance pass on the last-article persistence path.
**What happened:** Updated `src/lib/session-store.ts` to reject restored articles whose `paragraphs` array contains non-string entries, and added regression coverage for the malformed nested-array case.
**Outcome:** Success. Corrupt saved sessions now fail closed before malformed paragraph data reaches render/TTS paths.
**Insight:** Top-level shape checks are not enough for persisted article blobs; nested arrays need element-level validation too.
**Promoted to Lessons Learned:** Yes

---

### [2026-05-15] Self-heal malformed settings JSON on load

**Context:** Small maintenance pass on the app settings persistence path.
**What happened:** Updated `src/lib/settings-store.ts` so malformed persisted settings now fall back to defaults and write the cleaned defaults back to `localStorage` during load. Added regression coverage for the malformed-JSON case.
**Outcome:** Success. Settings restore now repairs unreadable storage instead of just ignoring it.
**Insight:** If a persistence loader already has a safe fallback, malformed JSON should be replaced with that fallback immediately so the same parse error does not repeat on every boot.
**Promoted to Lessons Learned:** No

---

### [2026-05-15] Document settings self-heal in README

**Context:** Small docs sync after the settings persistence hardening pass.
**What happened:** Updated the README persistence note to say settings self-heal on load when a saved snapshot is malformed.
**Outcome:** Success. User-facing docs now match the restore behavior.
**Insight:** When load-time repair exists, surface it in the README so users know the app can recover from stale local storage.
**Promoted to Lessons Learned:** No

---

### [2026-05-15] Document theme and queue badge affordances in README

**Context:** Small docs discoverability sync for visible UI affordances already present in the app.
**What happened:** Updated the README queue section to mention the queue-count badge on the menu icon and updated the settings theme list to include the khaki theme option.
**Outcome:** Success. README now matches the visible queue and theme controls in the current UI.
**Insight:** When a control is visible in the app but omitted from the top-level docs, add it to the user-facing usage section so the affordance is easier to find later.
**Promoted to Lessons Learned:** No

---

### [2026-05-15] Document Android background playback affordance in README

**Context:** Small docs discoverability sync for the media-session background playback behavior.
**What happened:** Updated the README How It Works and Player Controls sections to say Android keeps a silent media session alive for background playback and that the media notification also covers background playback.
**Outcome:** Success. User-facing docs now match the current Android background playback contract more clearly.
**Insight:** When a background-only recovery mechanism is user-visible, name the actual affordance in the README so troubleshooting starts from the right model.
**Promoted to Lessons Learned:** No

---

### [2026-05-16] Document Check for Updates button in README

**Context:** Small docs discoverability sync for a visible settings affordance that already exists in the app.
**What happened:** Updated the README settings section to list the **Check for Updates** button and clarified the stale-install recovery flow to try that button before the full cache-clearing steps.
**Outcome:** Success. README now matches the current manual update affordance and recovery guidance.
**Insight:** When the app already exposes a recovery button in settings, document it where users expect to look first instead of hiding the path only in the recovery section.
**Promoted to Lessons Learned:** No
---

### [2026-05-16] Sync README queue affordances with shipped labels

**Context:** Small docs-only maintenance pass for `pixel-article-reader`.
**What happened:** Updated `README.md` so the queue drawer docs use the exact shipped `Queue` label and `Clear queue` action instead of the older generic icon/menu wording.
**Outcome:** Success. Documentation now mirrors the live control labels more closely.
**Insight:** When a README mirrors visible UI chrome, use the exact shipped label or accessible name — generic icon wording ages into drift quickly.
**Promoted to Lessons Learned:** No
### [2026-05-16] Fix `session-store` type narrowing after latest pull

**Context:** CI typecheck failed on `src/lib/session-store.ts` because `parsed.savedAt` remained `number | undefined` after validation.

**What happened:**
- Pulled latest `main` with a fast-forward update.
- Returned the already-validated local `savedAt` value instead of re-reading the optional `parsed.savedAt` property.
- Verified with `npm run typecheck`.

**Outcome:** Success. Typecheck passes.

**Insight:** No reusable pattern promoted; this was a local TypeScript narrowing fix.

**Promoted to Lessons Learned:** No

---

### [2026-05-17] Guard missing YouTube transcript track URLs

**Context:** Small correctness pass on the YouTube transcript extraction path.
**What happened:** Fixed `src/lib/extractors/extract-youtube.ts` so transcript tracks without `baseUrl`/`url` fail before appending `&fmt=json3` and accidentally fetching a malformed relative URL. Added regression coverage in `src/__tests__/youtube.test.ts`.
**Outcome:** Success. Missing transcript URLs now produce the intended explicit error without an extra fetch.
**Insight:** Validate raw upstream URL fields before decorating them with query parameters; otherwise an empty string can become a syntactically non-empty but wrong URL.
**Promoted to Lessons Learned:** No

## 2026-07-13 — Quiet deterministic media-session tests

**What happened:** Added a Vitest baseline for jsdom's unimplemented media `play()`/`pause()` methods and kept call assertions in the media-session tests with local spies.

**Verification:** Container Compound local-green — lint/build and 585/585 tests passed without jsdom media-method errors.

---

### [2026-08-04] Migrate repository and product brand to Listen to Articles

**Context:** Git transport for `pixel-article-reader` was disabled, so the repository was recovered into `listen-to-articles` from a verified full-ref bundle.
**What happened:** Updated the Pages and workflow links, package/PWA/product names, media-session fallback metadata, and cache version. Retained the existing `pixel-article-reader` Cloudflare Worker name and URL for installed-client compatibility. Added the `WORKER_DEPLOY_ENABLED` repository-variable gate so CI cannot attempt a deploy until the new repository receives its Cloudflare secrets.
**Outcome:** Success. Typecheck, 829 tests, production build, and Worker dry-run all pass from the replacement repository.
**Insight:** Repository renames must preserve stable external service endpoints while moving repository- and Pages-scoped identities together.
**Promoted to Lessons Learned:** No
