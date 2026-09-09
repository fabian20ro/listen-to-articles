# Lessons Learned

> This file is maintained by AI agents working on this project.
> It captures validated, reusable insights discovered during development.
> **Read this file at the start of every task. Update it at the end of every iteration.**

## How to Use This File

### Reading (Start of Every Task)
Before starting any work, read this file to avoid repeating known mistakes and to leverage proven approaches.

### Writing (End of Every Iteration)
After completing a task or iteration, evaluate whether any new insight was gained that would be valuable for future sessions. If yes, add it to the appropriate category below.

### Promotion from Iteration Log
Patterns that appear 2+ times in `ITERATION_LOG.md` should be promoted here as a validated lesson.

### Pruning
If a lesson becomes obsolete (e.g., a dependency was removed, an API changed), move it to the Archive section at the bottom with a date and reason.

---

## Architecture & Design Decisions

**[2026-04-10] Shared Extractor Architecture** — Decouple extraction/parsing logic from the environment (Browser vs Edge Worker). Pass environment-specific dependencies (e.g., `DOMParser`, `fetch`, `pdfjsLib`) into shared parser functions to ensure the same logic can run locally in the browser and on the edge.

**[2026-04-10] Use modular imports over globals for PWA** — Transitioning from legacy vendor scripts (`vendor/*.js`) to NPM-managed modular imports improves dependency management, type safety, and code sharing with backend components. Introduce a bundler (Vite) to manage the browser build.

**[2026-02-22]** Service Worker must stay plain JS — `sw.js` runs in a ServiceWorker scope (no DOM, different globals). Keeping it as plain JS avoids needing a separate `tsconfig` for the SW context and keeps the file directly deployable without compilation.

## Code Patterns & Pitfalls

**[2026-09-09] Validate resolved fallbacks, not preferred wrappers** — When metadata may come from a nested or top-level renderer, validate the selected renderer after applying precedence. Requiring the nested wrapper afterward silently makes the valid top-level fallback unreachable. Pin absent-wrapper fallback, nested precedence, and missing-data errors separately.

**[2026-04-10] Modular mocking in Vitest** — When using ES module imports, global `globalThis.MockedClass` overrides in `beforeEach` will NOT affect the imported module. Use `vi.mock('module-name')` at the top level and `vi.mocked(ImportedClass).mockImplementation(...)` in tests to correctly intercept calls. Note: use regular `function` instead of arrow functions for mocking constructors (`new Mock()`).

**[2026-04-13] Bypass YouTube 429s via direct InnerTube API call** — Cloudflare Worker IPs are frequently rate-limited for the initial YouTube `/watch` page. To bypass this, use a static Android InnerTube API key (`AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`) to call `youtubei/v1/player` directly with recent Android stealth headers (`clientVersion`, `User-Agent`, `Referer`). Implement a fallback to the watch page extraction flow in case the static key changes.

**[2026-04-13] Extract full YouTube description from microformat path** — The `videoDetails.shortDescription` field in the InnerTube Player API response is often truncated. To get the full description, prioritize the `microformat.playerMicroformatRenderer.description` path (both `simpleText` and `runs`).

**[2026-02-22, updated 2026-02-28]** Guard TTS skip operations with a generation counter — `speechSynthesis.cancel()` fires `onend` on the current utterance (sync in some browsers, async in others). Any skip that calls `cancel()` and advances position must prevent the old `onend` from also advancing. Add a `_speakGen` counter: increment before `cancel()`, capture in each utterance's `onend` closure, bail if stale. **CRITICAL: ALL paths that call `cancel()`+`speakCurrent()` must increment `_speakGen` first**, including the resume watchdog's fallback timer — a stale `onend` from the cancelled utterance can double-advance position even after the new utterance starts speaking. **ALSO CRITICAL: The gen counter only protects callbacks (`onEnd`/`onError`), NOT the async `.then()` inside audio fetch pipelines.** When `AudioTTSBackend.speak()` fetches audio asynchronously, if pause/cancel happens during the fetch, the `.then()` still fires and calls `playAudio()`. Use an `isValid` callback to abort stale fetches before they start audio. Additionally, `speakCurrent()` and `onEnd` must check `_isPaused` — without this, a phantom chain can continue advancing while the engine thinks it's paused.

**[2026-02-22]** `extractUrl()` should only extract URLs at/near the end of text — Pasted article content often contains embedded URLs. Extracting the first URL from any position causes false matches. Only extract when the URL is at the end and the prefix is short (≤ 150 chars, typical of share text like "Article Title\nhttps://...").

**[2026-02-25]** Reset `_stopped` flag after `loadArticle()` — When `stop()` is called, it sets `_stopped = true` to prevent any remaining async fetch/speak callbacks from triggering further action. This flag must be reset to `false` when a new article is loaded via `loadArticle()`, otherwise the engine will remain permanently stuck in "stopped" mode and refuse to speak the new content. (Promoted from iteration log: 2nd occurrence of TTS-DOM index mismatch.)

**[2026-05-11]** When a localStorage loader sanitizes corrupt persisted state, write the cleaned value back during load — otherwise the app keeps re-reading the same bad blob and never heals the stale data.

**[2026-05-13]** If a queue or list store already self-heals invalid/oversized snapshots on load, fold duplicate cleanup into the same normalization pass so stale state repairs in one read instead of one read per bug class.

**[2026-05-14]** Queue items restored from localStorage should normalize their language field back to a supported code (`en`/`ro`) instead of trusting arbitrary strings — otherwise stale queue entries can carry unsupported playback state forward.

**[2026-05-14]** Restored Article blobs should validate nested paragraph entries as strings, not just the top-level array shape — otherwise corrupt localStorage can sneak malformed paragraph data into render/TTS paths.

**[2026-05-13]** Persisted session timestamps should be finite, not just numeric, during restore — otherwise corrupted `NaN`/Infinity metadata can slip through the self-heal path.

**[2026-05-11]** If a persisted session blob fails validation during startup, remove the bad entry before returning null — otherwise the app can keep paying the parse/validation cost on every boot.

## Testing & Quality

**[2026-02-22]** Test data must match actual code behavior, not assumed behavior — When writing the extractor test for "single-newline fallback", the test assumed the fallback path would be triggered, but the code's double-newline split actually succeeds with a single large paragraph. Always trace through the actual splitting logic before asserting paragraph counts.

**[2026-02-22, updated 2026-02-28]** Mock SpeechSynthesis carefully — The TTS engine tests require mocking both `speechSynthesis` (the global singleton) and `SpeechSynthesisUtterance` (the constructor). Set them on `globalThis` in `beforeEach` and restore in `afterEach`. The mock `speak()` should call `onend` via `setTimeout` to simulate the async callback chain. Use `vi.useFakeTimers()` for tests that involve the resume watchdog timer. **The mock must track `speaking`/`paused` state** — `pause()` should set `paused=true, speaking=false`, `resume()` should set `paused=false, speaking=true`, `cancel()` should set both to false. Without state tracking, `resume()` can't distinguish "properly paused" from "nothing to resume" — breaking tests for the pause/resume edge cases.

**[2026-02-23, updated 2026-02-24]** Background audio requires a real media session on Android — `speechSynthesis` is not treated as media playback by Chrome on Android. When the PWA goes to background, Chrome suspends the page and kills TTS. The fix is to play a silent `<audio>` track (generate a 10-second WAV programmatically, loop it) and register `navigator.mediaSession` action handlers. **Critical: the `<audio>` element MUST be appended to `document.body`** — `createElement` + `.play()` alone is not enough; Android Chrome ignores detached audio elements when deciding whether to suspend a page. Additionally, add a periodic keep-alive (5s interval) and a `visibilitychange` handler to restart the silent audio if the browser pauses it while backgrounded. Activate the silent audio from a user-gesture call stack (play button click) and deactivate on stop/end.

**[2026-02-23, updated 2026-02-25] Visibility change state management** — The `visibilitychange` handler must synchronize multiple state systems when the page backgrounds (`hidden`) or resumes (`visible`):
1. **Screen Wake Lock:** Auto-released when hidden; must be re-acquired on `visible` if playback is active. Also re-acquire on `resume()`.
2. **Dead-man's Switch:** Clear the watchdog timer on `hidden` to prevent false triggers while JS is suspended; reset `_lastProgressTime` to `now()` on `visible`.
3. **Background Audio:** `MediaSessionController` should restart silent audio if paused by the browser during backgrounding.
4. **TTS Recovery:** On `visible`, trigger a new sentence fetch if the playback state indicates it should be active.
Guard against races: if `_isPaused` is true in `acquireWakeLock()`, release immediately.

---

## Performance & Infrastructure

## Dependencies & External Services

## Process & Workflow

**[2026-05-16] Use exact shipped labels in docs-visible UI syncs** — When README/docs mirror a live control, prefer the literal button label or accessible name over generic icon/menu wording. It keeps docs aligned with the shipped surface and makes drift easier to spot.

---

## Archive

**[2026-02-22] Archived [2026-04-10]** Readability.js is a global, not an ES module — Transitioned to modular imports via NPM and Vite.

**[2026-02-22] Archived [2026-04-10]** Import paths must end in `.js` even in TypeScript source — Transitioned to Vite which handles module resolution more flexibly.

**[2026-02-22] Archived [2026-04-10]** TypeScript outDir overlaps with source root — Transitioned to Vite which builds to `dist/`.
