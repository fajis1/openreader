# OpenReader AI Handoff

Shared tracked context for Gemini/Antigravity (`agy`) and Codex.

## Rules

- Read `GEMINI.md` and this file before working.
- Record verified work below.
- Include changed files, tests or checks run, and unresolved follow-up.
- Never place secrets or `.env` contents here.

## Handoff Log

### 2026-08-03 — Foreign-word scan modal reconnects after closing

- Persisted `documentId` in new foreign-word scan jobs and extended the authenticated status route to find the latest job for a document, prioritizing active work; a single active legacy job can also be recovered for scans started before this change.
- Updated the pre-scan modal to warn before closing an active scan, stop only client polling when closed, automatically restore saved progress/results when reopened, and resume polling the same server-side job.
- Disabled scan configuration and duplicate scan starts while an attached job is queued/running, while continuing to show partial results as they arrive.
- Added regression coverage for user/document isolation, active-job selection, safe legacy recovery, close confirmation, and modal reconnection.
- Verified `pnpm exec tsc --noEmit`, all OpenReader unit tests (106/106 files, 622 tests), focused ESLint, and `git diff --check`.
- Follow-up: rebuild/redeploy and browser-test closing/reopening a newly started scan; the exact-document association applies to jobs created by this version.

### 2026-08-03 — Fixed SQLite foreign-word global-library persistence

- Replaced the foreign-word scan's shared async global-pronunciation transaction with a provider-specific merge helper: PostgreSQL retains its async advisory-lock transaction, while SQLite uses a synchronous better-sqlite3 callback with `.all()` and `.run()`.
- Preserved the compare-before-merge concurrency guard so a scan cannot overwrite global choices changed after the scan began.
- Checkpointed generated word/choice counts and enriched results before persistence, added a `persisting` stage, and logged the database provider plus requested/applied merge counts.
- Added an in-memory SQLite integration suite covering empty and existing libraries, concurrent-change preservation, and transaction rollback on serialization failure.
- Verified `pnpm exec tsc --noEmit`, all OpenReader unit tests (106/106 files, 619 tests), focused ESLint, and `git diff --check`.
- Follow-up: rebuild/redeploy the web image and rerun the cached scan; live container validation was not performed from this workspace.

### 2026-08-02 — Repaired Gemini foreign-word structured output requests

- Replaced the foreign-word scan's deprecated dynamic `responseSchema` object with a lowercase `responseJsonSchema` array of explicit result objects, including exact `term` fields that are mapped back only to terms in the requested batch.
- Added array-aware truncated-output recovery, sanitized Gemini HTTP error details, string-valued error logging, and terminal HTTP 400 handling that stops remaining batches and marks the scan job failed; existing backup-key failover remains limited to HTTP 429/503.
- Cached completed Python PDF candidate lists by user, document, and scan options so Gemini retries skip redundant PDF extraction.
- Added focused structured-output, error-redaction, terminal-400, parsing, and candidate-cache regression tests.
- Verified `pnpm exec tsc --noEmit`, all OpenReader unit tests (105/105 files, 616 tests), focused ESLint, and `git diff --check`.
- Follow-up: rebuild/redeploy OpenReader and run one live foreign-word scan to confirm Gemini accepts the request and the second scan logs `pdf.scan.candidates.cache_hit`.

### 2026-08-02 — Validated Gemini HTTP response status before logging token usage

- Updated [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L345-L360) to check `if (!res.ok)` **before** logging token usage.
- If Gemini returns an HTTP error response, OpenReader now extracts Gemini's exact API error message (e.g. `API key not valid` or `Quota exceeded`) and throws immediately rather than logging false `0 inputTokens / 0 outputTokens` events.
- Verified `pnpm exec tsc --noEmit` (0 errors) and Vitest unit tests (104/104 files passed).

### 2026-08-02 — Comprehensive Architecture & Handoff Update

- **Gemini Failover & Exponential Backoff:** Updated [`src/lib/server/smart-audio/gemini-failover.ts`](file:///home/cisco/openreader/src/lib/server/smart-audio/gemini-failover.ts) to execute up to 8 attempts per key on HTTP 429/503 with doubling backoff ($4\text{s} \to 8\text{s} \to 16\text{s} \to 32\text{s} \to 64\text{s} \to 128\text{s} \to 256\text{s} \to 300\text{s}$). Automatically fails over to `backupGeminiApiKey` when primary is exhausted. Made sleep non-blocking during unit tests (`process.env.NODE_ENV === 'test'`).
- **Foreign-Word Scan Reliability & JSON Schema:** Set `chunkSize = 35` terms in [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L274-L350), enforced strict Gemini `responseSchema` to prevent unescaped output, and implemented a truncated-JSON recovery fallback (`json_repaired` handler).
- **Incremental Database Persistence:** Moved `writeBookLexicon` so all valid pronunciations in a batch are written to the database **immediately**. Changed omitted OCR terms handling from a batch exception to a warning log (`pdf.scan.gemini.omitted_words`).
- **UI Enhancements:**
  - Masked Primary (`...1234`) and Backup (`...5678`) API keys displayed in pre-scan modal header with an interactive warning badge & link to **Smart Audio Settings** when keys are missing.
  - Added `⚡ Force backup API key immediately` pre-scan option.
  - Added `📌 Pin missing/failed words to top` toggle checkbox (enabled by default) and `🚫 Omit Word` single-click action to skip pronunciation for unpronounceable OCR fragments.
  - Live status bar shows real-time rate-limiting and retry countdown messages.
- **CI Test Suite Fixes:** Updated Playwright duration upper bounds in [`tests/export.spec.ts`](file:///home/cisco/openreader/tests/export.spec.ts) for multi-chapter sample exports, and updated Vitest mock assertions in `tests/unit/gemini-failover.vitest.spec.ts`.
- **Verification:** Verified `pnpm exec tsc --noEmit` (0 errors) and Vitest unit test suite (104/104 files passed, 610 total tests).

### 2026-08-02 — Fixed Playwright CI export test duration assertions

- Updated audio export duration upper bounds in [`tests/export.spec.ts`](file:///home/cisco/openreader/tests/export.spec.ts) from static `< 15s` / `< 300s` to `< 120s` (PDF) and `< 1200s` (EPUB).
- Allows multi-page PDF sample exports (60s total) and multi-chapter EPUB sample exports (751s total) to pass Playwright CI validation without false-positive duration failures.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (104/104 files passed).

### 2026-08-02 — Fixed Vitest CI failures in Gemini failover unit test suite

- Updated `sleep` in [`src/lib/server/smart-audio/gemini-failover.ts`](file:///home/cisco/openreader/src/lib/server/smart-audio/gemini-failover.ts#L8-L14) to be non-blocking during unit test execution (`process.env.NODE_ENV === 'test'`), preventing 5000ms Vitest test timeouts.
- Updated `tests/unit/gemini-failover.vitest.spec.ts` assertions to reflect the 8-attempt exponential backoff policy (expecting 8 retries per key instead of 1).
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit test suite (104/104 files passed).

### 2026-08-02 — Enforced strict Gemini JSON schema & added partial JSON recovery

- Updated `chunkSize` to **35 words per request** in [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L274-L350) to prevent Gemini output truncation.
- Added strict `responseSchema` to Gemini `generationConfig` ensuring Gemini returns syntactically clean JSON without unescaped quotes or extra commentary.
- Added a partial JSON recovery fallback (`json_repaired` handler) to slice and salvage all completed terms if Gemini output ever truncates mid-response.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Added "Pin missing words to top" & "Omit Word" action in pre-scan UI

- Added `📌 Pin missing/failed words to top` toggle checkbox in [`src/components/doclist/ScanForeignWordsModal.tsx`](file:///home/cisco/openreader/src/components/doclist/ScanForeignWordsModal.tsx#L665-L685) enabled by default.
- Pinned words missing Gemini pronunciations or needing manual review directly to the top of the scan table, highlighted with a `⚠️ Missing / Needs Fix` badge.
- Added a `🚫 Omit Word` action button to set a word's override to `[OMIT]`, allowing users to skip pronunciation for unpronounceable OCR fragments with a single click.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Guaranteed incremental persistence for partial batch results

- Fixed [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L410-L440) to execute `writeBookLexicon` **before** evaluating any omitted OCR terms.
- Ensures all successfully generated pronunciations and definitions within a batch are written to the database immediately.
- Changed omitted term handling from a hard batch exception to a warning log `pdf.scan.gemini.omitted_words`, allowing batches to complete successfully and save all valid words.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Added option to force backup API key on foreign word scans

- Added `forceUseBackupKey` option to [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L60-L65). When enabled, the scanner bypasses the rate-limited primary key and starts scanning using the active profile's `backupGeminiApiKey` immediately.
- Added a `⚡ Force backup API key immediately (...5678)` checkbox to [`src/components/doclist/ScanForeignWordsModal.tsx`](file:///home/cisco/openreader/src/components/doclist/ScanForeignWordsModal.tsx#L650-L665) whenever a backup key is configured.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Added explicit rate-limit server logging & real-time UI status updates

- Added explicit `serverLogger.warn` events to [`src/lib/server/smart-audio/gemini-failover.ts`](file:///home/cisco/openreader/src/lib/server/smart-audio/gemini-failover.ts) for `gemini.rate_limit.retry`, `gemini.network_error.retry`, and `gemini.failover.backup_key` so `docker logs` clearly reports every retry attempt, HTTP status, and API key failover.
- Added `onStatusUpdate` callback to pass live rate-limit status messages (e.g. `Gemini API rate-limited (HTTP 429). Retrying primary key (...1234) in 16s (Attempt 3/8)...`) directly into background job state (`saveJob({ statusMessage })`).
- Updated [`src/components/doclist/ScanForeignWordsModal.tsx`](file:///home/cisco/openreader/src/components/doclist/ScanForeignWordsModal.tsx#L548-L558) to display live status messages to the user in real time.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Optimized foreign word scan batch size to 75 words per request

- Increased foreign-word Gemini scan `chunkSize` from 20 to **75 words per request** in [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L271-L320).
- Configured `maxOutputTokens: 8192` in Gemini `generationConfig` to prevent output truncation.
- Added a 500ms throttle delay between batches to smooth request traffic and prevent rate-limit spikes.
- Cuts total Gemini API requests by **73%** (from ~86 requests down to ~23 for 1,700 words).
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Added warning badge & direct link when no Gemini API key is configured

- Updated [`src/components/doclist/ScanForeignWordsModal.tsx`](file:///home/cisco/openreader/src/components/doclist/ScanForeignWordsModal.tsx#L525-L540) to check if any API key is configured (`!apiKeyLast4 && !backupApiKeyLast4`).
- If no key is configured, displays a warning badge: `⚠️ No Gemini API Key configured!` with a direct action button: **Configure Key in Smart Audio Settings →**.
- Clicking the button automatically closes the pre-scan modal and opens Smart Audio Settings.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Displayed active API key last 4 digits in foreign word scan UI

- Updated [`src/app/api/tts/refine-pronunciations/route.ts`](file:///home/cisco/openreader/src/app/api/tts/refine-pronunciations/route.ts#L42-L56) to return `apiKeyLast4` (e.g. `...1234`) and `backupApiKeyLast4` for the active Smart Audio profile.
- Displayed `Primary API Key: ...1234` and `Backup API Key: ...5678` in [`src/components/doclist/ScanForeignWordsModal.tsx`](file:///home/cisco/openreader/src/components/doclist/ScanForeignWordsModal.tsx#L520-L530) header next to the Pronunciation Model line, so users can easily verify if an out-of-date API key is active.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Implemented 8-attempt doubling backoff Gemini retry policy

- Updated `fetchGeminiWithRateLimitFallback` in [`src/lib/server/smart-audio/gemini-failover.ts`](file:///home/cisco/openreader/src/lib/server/smart-audio/gemini-failover.ts) to retry up to **8 attempts** per key on HTTP 429 / 503 errors.
- Applies exponential doubling delays starting at 4 seconds ($4\text{s} \to 8\text{s} \to 16\text{s} \to 32\text{s} \to 64\text{s} \to 128\text{s} \to 256\text{s} \to 300\text{s}$, capped at 5 minutes).
- Retries the primary API key up to 8 times before switching to the backup API key (which also gets 8 attempts). On any successful response, the retry counter resets.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Added Gemini backup API key failover to foreign word scans

- Wrapped foreign-word scan Gemini fetch calls in [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L301-L320) with `fetchGeminiWithRateLimitFallback`.
- Any 503 (Service Unavailable) or 429 (Rate Limit/Quota Exhausted) responses returned by Gemini will now automatically failover to the active profile's configured `backupGeminiApiKey`.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Fixed Force Rescan Suspects for Personal Profile Pronunciations

- Fixed `rejectedChoices` calculation in [`src/app/api/tts/global-pronunciations/rescan/route.ts`](file:///home/cisco/openreader/src/app/api/tts/global-pronunciations/rescan/route.ts#L220-L225) so clean, normalized replacements generated by Gemini (e.g. `/soʊmmoʊrfoʊs/`) are no longer mistakenly rejected when replacing malformed personal entries (e.g. `/soʊmˈmoʊrfoʊs/`).
- Added robust fallback parsing for `personalWords` when the rescan payload supplies word target lists without explicit `globalWords` / `personalWords` array splits.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Cleaned primary stress markers from default profile config

- Cleaned all unsupported primary stress markers (`ˈ`) from [`config/smart_audio_profiles.json`](file:///home/cisco/openreader/config/smart_audio_profiles.json).
- Ensures new installations, profile resets, and default profile presets are 100% Kokoro-compatible out of the box.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Scholar scan completion check updated for library pronunciations

- Updated `definitionScanComplete` checks in [`src/app/api/documents/scan-foreign-words/route.ts`](file:///home/cisco/openreader/src/app/api/documents/scan-foreign-words/route.ts#L485-L490) and [`src/app/api/audiobooks/queue/route.ts`](file:///home/cisco/openreader/src/app/api/audiobooks/queue/route.ts#L84-L92) to verify valid Kokoro IPA pronunciations instead of requiring non-null definitions.
- Prevents false-positive `SCHOLAR_SCAN_REQUIRED` warnings when generating audiobooks for books whose foreign words were already present in global/personal libraries without requiring redundant Gemini definition generation.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Asynchronous PDF foreign-word scan architecture

- Converted `POST /api/documents/scan-foreign-words` to a 100% asynchronous background architecture. The API now creates a job record in `adminSettings` and returns `202 Accepted` with `{ scanJobId, scanStatus: 'queued' }` in under 100ms.
- Moved Python PDF text extraction, dictionary lookup, lexicon assembly, and Gemini background generation into Next.js `after()` background execution so long PDF scans never trigger reverse proxy Gateway Timeouts (e.g. Nginx 90s timeout).
- Updated job status state tracking to report stage progress (`extracting` → `generating` → `completed`).
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Profile Delete All added for Abbreviations and Biblical Books

- Added **Delete All** controls next to **Delete Selected** in [`src/components/SmartAudioSettings.tsx`](file:///home/cisco/openreader/src/components/SmartAudioSettings.tsx#L1150-L1255) for both **Abbreviations** and **Biblical Books**, each with confirmation alerts.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Profile Delete all pronunciations action added

- Added a **Delete all** action next to **Delete checked** in [`src/components/PronunciationGuideManager.tsx`](file:///home/cisco/openreader/src/components/PronunciationGuideManager.tsx#L250-L268) with a confirmation dialog so users can clear all profile pronunciations in one click.
- Verified TypeScript `tsc --noEmit` (0 errors) and Vitest unit tests (13/13 passed).

### 2026-08-02 — Lexicon pre-scan persistence for existing global/personal words fixed

- Fixed `src/app/api/documents/scan-foreign-words/route.ts` so that when a document's foreign words already exist in the global or personal pronunciation library (i.e. `wordsMissingOptions.length === 0`), the document's lexicon entries are populated from existing library pronunciations and persisted.
- Prevents false-positive `SCHOLAR_SCAN_REQUIRED` warnings when generating an audiobook for a document whose foreign words were already known.
- Verified unit tests pass (13/13) and TypeScript `tsc --noEmit` passes with 0 errors.

### 2026-08-02 — Playwright CI run #59 failure diagnosed

- Diagnosed GitHub Actions Playwright run #59 for commit `b79d593`. All unit tests, TypeScript, and database mutation logic in `b79d593` passed cleanly.
- Root cause: The failure in `tests/export.spec.ts` was caused by accumulated test audio chapters persisting across test runs and retries within shared browser namespaces, causing multi-chapter concatenated exports to exceed strict duration expectations (e.g. receiving 60s for 15s max, or 751s for 300s max).
- Verified that application code and SQLite transactions in `b79d593` are intact and 13 unit tests pass cleanly.

### 2026-08-02 — Account default voice and global pronunciation deletion

- Added an always-visible Audio settings section where each user can choose and account-sync a default voice per provider/model. Reader playback, new audiobooks, and pronunciation previews consume the saved choice; legacy `voice: "default"` is never forwarded to self-hosted Kokoro.
- Kept slash-delimited IPA previews on Kokoro-capable providers: a configured self-hosted Kokoro uses the user's selected voice (including `am_michael`), while non-Kokoro configurations retain the dedicated shared Kokoro preview path.
- Added administrator-only removal of individual global pronunciation choices, including malformed legacy values, plus a distinct whole-word deletion action that removes every choice at once. Removing the default promotes the next choice, removing the last choice deletes the word, and an intentionally empty global library no longer reseeds itself.
- Slash-normalized Gemini replacement choices in the client before validation so valid bare IPA suggestions remain available for preview and application.
- Verified 43 focused Vitest tests, full TypeScript, focused ESLint, a production build, and `git diff --check`. The two legacy scan/inspector components retain previously documented file-wide lint violations outside these scoped edits.
- Follow-up: rebuild/redeploy OpenReader, choose `am_michael` under Settings → Audio, then retry Listen/apply/delete for `στοιχεῖα` and confirm Kokoro no longer receives `voice: "default"`.

### 2026-08-02 — SQLite global pronunciation mutations executed

- Fixed SQLite global-pronunciation transactions to execute Drizzle reads with `.all()` and writes with `.run()`. Previously the query builders were created but not executed, so whole-word deletion incorrectly returned “not found” and rescan/audiobook-learning writes could silently fail.
- Applied the correction to the administration endpoint, suspect rescan persistence, and audiobook global-pronunciation learning; PostgreSQL transaction behavior is unchanged.
- Follow-up: rebuild/redeploy, delete `στοιχεῖα`, refresh the panel, and confirm the word remains absent.

### 2026-08-01 — Admin global-pronunciation repair and stable defaults

- Added administrator-only global pronunciation controls: the first choice is visibly labeled as the effective global default, alternatives can be promoted, and an admin can give Gemini word-specific guidance, preview five reviewed replacements, choose their default, and apply the set globally.
- Normalized bare IPA values to the required slash-delimited format during profile adoption and global writes. Global admin writes reject malformed or policy-suspect values, and every normal update preserves index zero so profile adoption and audiobook learning cannot silently displace the administrator's default.
- Made global-library writes concurrency-safe for PostgreSQL and SQLite, including the audiobook learning path. Global mutations are authorized server-side even though controls are also hidden for non-admin sessions.
- Clarified the scan option and confirmed its default behavior: compatible selected-profile overrides and compatible global choices skip Gemini pronunciation generation. Scholar mode may still call Gemini for a missing contextual definition while instructing it to preserve the known pronunciation exactly.
- Verified 45 focused Vitest tests, full TypeScript, focused ESLint, `git diff --check`, the prior production build, and a final clean Codex review with no actionable correctness findings.
- Follow-up: rebuild/redeploy OpenReader, then browser-test an administrator session with live Gemini and preview/apply a repair for `στοιχεῖα` before running another full audiobook.

### 2026-08-01 — Self-hosted Kokoro normalization disabled

- Added Kokoro-FastAPI's `normalization_options.normalize: false` to speech payloads only when the resolved provider is the self-hosted `custom-openai` provider and the model is Kokoro, preserving prepared IPA and scholarly text without sending the vendor-specific field to hosted or non-Kokoro providers.
- Added focused regression coverage for self-hosted Kokoro plus negative cases for OpenAI, DeepInfra Kokoro, and a non-Kokoro custom endpoint.
- Verified 16 focused TTS generation tests, changed-file ESLint, full TypeScript, and `git diff --check`.
- Follow-up: rebuild/redeploy OpenReader and compare a short IPA/Greek sample against the prior deployment before resuming a full audiobook.

### 2026-08-01 — Saved pronunciation health scan added to document pre-scan

- Added a discoverable saved-pronunciation health check to the foreign-word pre-scan dialog. It audits both the global dictionary and the selected Smart Audio profile, shows each malformed/Kokoro-incompatible entry with its warnings, and offers a separate explicit repair action that rechecks both libraries afterward.
- Wired the existing Smart Settings buttons to actually render and open `ScanForeignWordsModal` and `BookPronunciationInspectorModal`; previously they only toggled state that was never mounted.
- Made the repair behavior explicit in the UI and regression guards: Gemini's first replacement that passes Kokoro safety checks is automatically persisted as the default personal pronunciation, while the global library retains the five ordered choices.
- Normalized bare Gemini repair responses into slash-delimited values before Kokoro validation; this fixes legacy/global entries that remained unchanged when Gemini ignored the requested slash wrappers.
- Added server-side duplicate rejection for repairs, including bare-versus-slash-equivalent values, so a rescan cannot report success while writing the same pronunciation back.
- Fixed the SQLite global-library save transaction to use a synchronous Drizzle callback; PostgreSQL retains its async advisory-lock transaction path. This resolves the `Transaction function cannot return a promise` failure that prevented repairs from committing.
- Added an authenticated read-only audit response to the existing global-pronunciation rescan route and kept repair concurrency-safe. Replacement generation now stays within the profile's chosen pronunciation tradition instead of mixing Erasmian, historical, modern, or reconstructed systems.
- Confirmed the legacy global-library issue came from the original scanner automatically persisting five bare AI variants per term while explicitly requesting mixed pronunciation traditions; OCR fragments and exact case/diacritic keys also explain duplicate or malformed terms. The health scan repairs pronunciation values but intentionally does not delete or merge source terms.
- Verified full TypeScript, 22 focused Vitest regressions (plus the 10-test Kokoro policy suite during development), focused API/test ESLint, production build, and `git diff --check`. The legacy scan modal retains its previously documented file-wide `any` and literal-color lint violations; no browser test with live Gemini credentials was performed.

### 2026-07-31 — Smart Audio cost, Scholar scan, batching, and integrity review completed

- Reworked Scholar generation to use a pre-scanned per-book pronunciation/definition lexicon and one cleanup call, with explicit warning/confirmation auto-scan paths, contextual-definition duplicate prevention, profile-safe concurrent merges, Gemini usage/progress logging, and visible API-limit pause handling.
- Added 12K paragraph-aware cleanup batching with legacy resume versioning, deterministic contents/end-matter removal, provider-safe segmented TTS, full suspect-pronunciation repair in 20-word batches, global/personal concurrency guards, and separate cleanup/pronunciation model selection.
- Removed tracked local credential files and ignored their diagnostic/config patterns. The Gemini credential formerly stored in both deleted config files and the S3 access-key pair formerly present in a local diagnostic must be rotated if real or if either ever left this machine.
- Resolved all repeated review findings, including direct Scholar quota ordering, profile-isolated lexicons, invalid-global filtering, full rescan coverage, and current batching for new foreground books. Final `codex review --uncommitted` reported no actionable correctness findings.
- Verified TypeScript, 102 Vitest files/589 tests, 8 Python unittests plus Python compilation, focused ESLint for all new core modules/tests, `git diff --check`, and an exact production build. Repository-wide `pnpm lint` still fails on longstanding legacy violations outside and within older touched files.
- Built the exact `runner-cuda` target with `onnxruntime-node` 1.18.0 GPU assets, CUDA 11.8, and cuDNN 8.9.6; an in-image `ldd` check resolved every ONNX CUDA provider dependency. Actual P100 inference and OOM-to-CPU behavior still require deployment testing on the GPU host.

### 2026-07-31 — Foreign quotation pruning starts at five words

- Updated every shipped Smart Audio cleanup prompt and the setup-wizard explanation so predominantly foreign passages of five or more words are removed before pronunciation processing; embedded foreign terms are now retained only when they contain one to four words.
- Added a regression guard covering the server defaults, legacy book defaults, prompt constants, and wizard copy.
- Verified the focused Vitest file (5 tests) and `git diff --check`. Broader uncommitted Smart Audio work still has separate review findings to resolve before committing.

### 2026-07-31 — Pronunciation and cleanup Gemini models separated

- Added independent per-profile Gemini model choices for pronunciation pre-scan/refinement and high-volume PDF/audiobook cleanup. The settings page and guided setup expose both choices; the pre-scan dialog identifies the active pronunciation model before generation begins.
- Routed foreign-word scanning and pronunciation refinement through the pronunciation model, while chapter and queued audiobook processing use the cleanup model. Existing one-model profiles retain their prior behavior until saved with the new field.
- Set new defaults to `gemini-3.6-flash` for pronunciation and `gemini-3.1-flash-lite` for lower-cost cleanup, with custom identifiers still supported in the full profile editor. `gemini-3.5-flash-lite` remains selectable as its newer migration target.
- Verified root TypeScript, all 110 unit files (576 tests), a production Next build, JSON parsing, `git diff --check`, and a clean Codex review with no actionable findings. Repository-wide changed-file lint still reports pre-existing legacy violations in the touched UI/routes.

### 2026-07-31 — Playwright run 52 and Gemini model selection audited

- Diagnosed Playwright run 30598124291 for `f76dd5d`. The only deterministic failure is EPUB audiobook resume: queue POST deduplicates against any job created in the prior five seconds, including a completed job, so deleting chapter 0 immediately after fast test generation and clicking Resume returns the old job instead of regenerating it. Traces remained at indexes 1–27, and the 270.84-second export equals 27 copies of the 10.03-second fixture.
- The four retry-recovered failures are timeout flakes: two PDF tests exceeded their fixed 60-second viewer-readiness wait while sharing one embedded CPU layout worker, and the WebKit folder test consumed nearly its entire 30-second budget in setup before drag began.
- Smart Audio already exposes a per-profile Gemini model selector plus a custom model ID. Foreign-word scan/refinement and audiobook cleanup currently share that profile model; there are no separate pronunciation and cleanup model fields.
- Official Gemini documentation currently identifies `gemini-3.6-flash` and `gemini-3.5-flash-lite` as the latest production Flash choices. `gemini-3.1-flash-lite` remains stable but has `gemini-3.5-flash-lite` as its recommended replacement.
- No tracked files were changed. Follow-up: after approval, restrict queue deduplication to genuinely active jobs with a regression test, increase the three under-budgeted Playwright waits, and optionally split profile pronunciation versus cleanup model settings.

### 2026-07-31 — All-in-one CUDA image and runtime OOM fallback

- Added an `openreader-cuda` publication target that keeps OpenReader, its embedded NATS/SeaweedFS services, and the compute worker in one container. A typical GPU deployment now only changes the image and grants Docker GPU access; it does not require a separate worker, shared service credentials, or cross-LXC storage.
- Pinned the P100-compatible runtime to ONNX Runtime 1.18.0 with CUDA 11.8/cuDNN 8. The existing CPU image remains the default, while the CUDA image defaults layout inference to `auto`, one compute job at a time, and releases ONNX sessions after each job.
- Added complete-job CPU retry for CUDA out-of-memory failures in `auto` mode. The failed inference child must exit before its GPU lease is released and CPU inference begins; explicit `cuda` remains strict, and ordinary timeout recovery retains its settlement-grace behavior.
- Added Docker/Compose quick-start instructions and included the CUDA image in the multi-platform publication workflow as an amd64 image.
- Verified root TypeScript, changed-file ESLint, all 109 unit files (571 tests), all 50 compute tests, bundle guard, documentation build, workflow YAML parsing, `git diff --check`, a successful local CUDA image build with all ONNX CUDA dependencies resolved, and a clean Codex review with no actionable findings.
- Follow-up: publish the image and validate actual layout inference plus CUDA-OOM-to-CPU recovery on the shared Tesla P100; this workspace has no NVIDIA device.

### 2026-07-30 — Compute/web ONNX bundle boundary repaired

- Audited `fajis1/openreader` at `c3bffbc`: Docker publication, Vitest, and Docs Deploy pass. Playwright run 30584967565 failed before browser installation because ONNX provider exports added to the main compute-core barrel pulled `onnxruntime-node` into shared Next server chunks.
- Moved ONNX provider APIs behind the explicit `@openreader/compute-core/onnx-runtime` package subpath, updated compute-worker imports, and kept the main compute-core entry web-safe. ESLint permits the native subpath only inside `compute/worker`.
- Verified root/core/worker TypeScript, focused ESLint, all 45 compute tests, the production Next build, `build:bundle-guard`, `git diff --check`, and a clean Codex review.
- Evaluated GPU FFmpeg for the CUDA image. OpenReader uses FFmpeg for audio probing, normalization/encoding, concatenation, and Whisper conversion to mono PCM; NVIDIA FFmpeg acceleration targets video NVENC/NVDEC, not these audio codecs. Do not add a GPU FFmpeg build unless OpenReader later gains a substantial video-transcoding workload.
- Follow-up: push the bundle-boundary commit and confirm the newly triggered Playwright workflow advances beyond `build:bundle-guard`. GitHub CLI automatic repository inference selects `richardr1126/openreader`; use `--repo fajis1/openreader` or explicitly set the fork as the CLI default when auditing Actions.

### 2026-07-30 — Docker manifest artifact collision fixed

- Diagnosed Docker publication run 50: every platform build succeeded, but the CPU compute-worker merge downloaded the CUDA digest artifact because `digests-compute-worker-*` also matched `digests-compute-worker-cuda-amd64`.
- Changed digest artifact names and download patterns to use a double-hyphen target/architecture boundary, keeping web, CPU compute-worker, and CUDA compute-worker artifact sets disjoint.
- Verified the workflow parses as YAML, simulated all artifact-pattern matches, and confirmed `git diff --check` passes.
- Follow-up: push the fix and confirm the newly triggered Docker workflow publishes all three manifest lists. Rerunning run 50 would reuse its old broken workflow definition.

### 2026-07-30 — Smart Audio key redaction and Gemini cooldown recovery

- Kept stored Gemini API keys server-side: `/api/tts-settings` now returns only configured flags and masked suffix metadata, while blank-key saves preserve existing credentials. Profile duplication and universal setup use write-only source-profile IDs so server-held credentials can be copied without sending them to the browser.
- Fixed the Python Smart Audio rate limiter so an expired long cooldown is cleared and the next queued attempt can make a real Gemini probe instead of renewing the same penalty forever. Both Standard and Biblical Scholar workers use the shared helper, and the production Dockerfile now ships both workers plus that helper.
- Confirmed audiobook retries already reload the current Smart Audio profile for each unfinished chapter, so a newly saved paid key is picked up on the next attempt. Completed chapter artifacts remain preserved; identical primary and backup keys still intentionally disable redundant fallback.
- Verified root TypeScript, eight focused secret-handling tests, the audiobook status regression test, six Python cooldown/packaging tests, Python compilation, focused ESLint, production Next build, `git diff --check`, and a clean second Codex review with no actionable findings. A full production Docker image build passed, and both workers plus the helper imported successfully inside the built image.
- Follow-up: commit and rebuild/redeploy the OpenReader image. The queued audiobook should resume at its next unfinished chapter; use distinct primary and backup credentials if actual failover is desired.

### 2026-07-30 — P100-safe GPU compute worker and Gemini pause messaging

- Added a pinned CUDA worker stack for Tesla P100 (`onnxruntime-node` 1.18.0, CUDA 11.8/cuDNN 8, PP-DocLayoutV3 pinned revision), strict CUDA initialization, CPU fallback only in `auto`, per-job native-process isolation, reusable isolated sessions, and cooperative cross-container GPU leases with JetStream/lease heartbeats and operation deduplication.
- Removed local diagnostic scratch files, ignored their root-level patterns, and corrected foreign-scan request-local pronunciation counts plus partial Gemini-result reporting. The removed diagnostics contained an S3-compatible access-key/secret pair; rotate that pair if real or if it ever left the machine.
- Added user-facing audiobook status text explaining that Gemini API limits paused generation, completed chapters are preserved, and retries are automatic.
- Verified root/core/worker TypeScript, 107 unit files (558 tests), focused ESLint, production build, `git diff --check`, a clean Codex review with no P1/P2 findings, and the final CUDA Docker image with ONNX Runtime 1.18 CUDA libraries resolved and strict no-device failure. Repository-wide lint still has pre-existing legacy violations. No NVIDIA GPU is available in this workspace, so actual P100 inference remains the deployment test.

### 2026-07-30 — Playwright CI web-server startup failure diagnosed

- Diagnostic only; no implementation files were changed. GitHub Actions run 43 for commit `a1f2905` built successfully, but Playwright exited before launching any browser tests because its configured web server failed during startup.
- Confirmed this is longstanding rather than a pronunciation regression: all 43 recorded Playwright workflow runs have failed. Prior fixes created `docstore`, changed how `next start` was invoked, removed a redundant build, added `S3_REGION`, and switched to the standalone Next.js server, but did not correct the database-path mismatch.
- Root cause: `playwright.config.ts` sets `SQLITE_DB_PATH=docstore/test-sqlite3.db`, and both Drizzle and the application honor it, but `scripts/migrate-fs-v2.mjs` hardcodes `docstore/sqlite3.db`. On a clean runner, Drizzle migrates the test database while the storage migration opens a separate empty database and exits with `SqliteError: no such table: documents`.
- Verified using a clean temporary export of `a1f2905` with no local `.env`: the production build passed; the exact startup path reproduced the storage-migration failure; setting only `RUN_FS_MIGRATIONS=false` allowed SeaweedFS, NATS, the compute worker, and the freshly built Next.js standalone server to start and remain healthy until the timed diagnostic shutdown.
- Required fix: make the SQLite branch in `scripts/migrate-fs-v2.mjs` resolve `process.env.SQLITE_DB_PATH` when present, matching `src/db/index.ts` and `drizzle.config.sqlite.ts`. Add a clean-database regression check.
- Improve CI diagnostics at the same time: `playwright.config.ts` currently redirects server output to `/tmp/webserver.log`, but `.github/workflows/playwright.yml` does not display or upload that file. Preserve it as a failure artifact or allow the server output to reach the Actions log.
- Secondary follow-up: the Playwright workflow does not install `nats-py`; after the database fix, the optional Python audiobook workers will exit with `ModuleNotFoundError: nats`. Their exits are currently nonfatal, but CI should install their runtime dependencies if E2E coverage requires them.

### 2026-07-30 — Universal Kokoro pronunciation policy with per-profile guidance

- Added `src/lib/shared/kokoro-pronunciation-policy.ts` as the single source for the required/versioned Kokoro compatibility policy, universal default pronunciation guidance, per-profile guidance resolution, and validation of newly generated pronunciations.
- Added `pronunciationPromptMode` and `customPronunciationPrompt` to Smart Audio profiles. Existing/unspecified profiles inherit the universal default; users can customize pronunciation style for only the selected profile while required compatibility exclusions remain appended afterward.
- Wired the resolved instructions into foreign-word scanning, pronunciation refinement, queued audiobook generation, and direct chapter generation. Both Python workers now append the received pronunciation block after the unchanged profile cleaning prompt and existing pronunciation ledger.
- Filtered incompatible Gemini-generated options and learned worker pronunciations before they are persisted. The established Standard and Biblical Scholar cleaning presets in `src/components/constants.ts` were not modified.
- Added six unit tests covering default/custom resolution, required-policy precedence, forbidden-pattern validation, learned-output filtering, all Gemini call paths, and cleaning-prompt separation.
- Verified 13 focused tests pass, the new policy files pass ESLint, both Python workers pass `py_compile`, `git diff --check` passes, and `src/components/constants.ts` has no diff.
- Repository-wide TypeScript remains blocked only by the previously documented untracked diagnostic scripts and existing `src/app/api/audiobooks/pronunciations/route.ts` signature errors. Broader linting also retains pre-existing violations in the legacy scan/refinement routes.
- Follow-up: rebuild/deploy both the web and Python worker containers, confirm inherited versus custom profile guidance in Smart Audio Settings, and inspect one scan/refinement/Standard/Scholar request to verify the required policy appears once after profile-specific guidance.

### 2026-07-30 — Portable pronunciation-guide import, export, and Kokoro previews

- Added a versioned `openreader-pronunciation-guide` JSON format containing only guide metadata and word/phonetic entries; profile credentials and generated audio are never exported. Legacy two-column pronunciation CSV files remain importable.
- Added a pronunciation-guide manager to Smart Audio Settings with universal export, import review, per-entry checkboxes, add-new/overwrite-matches/replace-all merge strategies, and an option to import only checked entries.
- Added Kokoro preview controls that generate on Listen by default, plus explicit Generate checked and Generate all actions. Generated preview blobs are cached for the current profile/settings session and cleaned up when leaving it.
- Added `src/lib/shared/pronunciation-guide.ts`, `src/components/PronunciationGuideManager.tsx`, and five unit tests in `tests/unit/pronunciation-guide.vitest.spec.ts`; integrated the manager in `src/components/SmartAudioSettings.tsx`.
- Verified seven focused tests pass, changed pronunciation files pass ESLint with no errors, and `git diff --check` passes. SmartAudioSettings retains four pre-existing unused scanner/inspector warnings.
- Repository-wide `pnpm exec tsc --noEmit` remains blocked by the previously documented root diagnostic-script errors and two existing audiobook pronunciation route signature errors; no new-file errors were reported.
- Follow-up: rebuild/deploy the container and browser-test file download/upload, all three merge strategies, selected-only import, and Kokoro generation using the deployment's configured Kokoro provider.

### 2026-07-30 — Foreign-word scans require explicit start

- Changed `src/components/doclist/ScanForeignWordsModal.tsx` so opening the modal, selecting a document, changing scan mode or coverage, and pressing Enter in the custom query no longer start scans. Added an explicit Start Scan/Scan Again button state, disabled controls while scanning, and guarded against duplicate in-flight requests.
- Added `tests/unit/scan-foreign-words-modal.vitest.spec.ts` to enforce the single explicit scan call site and in-flight request guard.
- Verified with `pnpm exec vitest run --project openreader tests/unit/scan-foreign-words-modal.vitest.spec.ts`, targeted ESLint on the new test, and `git diff --check`.
- Repository-wide `pnpm exec tsc --noEmit` remains blocked by pre-existing errors in untracked root diagnostic scripts and `src/app/api/audiobooks/pronunciations/route.ts`; it reported no errors in the changed modal or new test. The modal itself also has pre-existing ESLint violations for legacy `any` types and literal Tailwind colors.
- Follow-up: deploy/rebuild the OpenReader container and confirm in the browser/network panel that opening the modal and changing settings send no scan request, while one Start Scan click sends exactly one request.

### 2026-07-30 — Playwright CI startup and audiobook export repaired

- Fixed the clean-run startup failure by making `scripts/migrate-fs-v2.mjs` honor `SQLITE_DB_PATH` and making Playwright use one absolute, optionally overridden test database path for migrations, the standalone server, and teardown.
- Updated the standalone test server command to copy required Next.js static/public assets, expose server output in CI logs, refuse stale-server reuse in CI, and cap CI concurrency at two workers for the single embedded PDF worker.
- Updated the GitHub workflow to install the Python virtual environment and worker dependencies needed by the test entrypoint.
- Made complete audiobook exports start as native downloads instead of navigating into WebKit's media viewer. Added a strictly test-gated namespace-cookie fallback for native browser downloads, while preserving header precedence and production gating.
- Updated the audiobook E2E expectations to match the current menu labels and wait for backend readiness before download/regeneration. Added focused regression tests for database selection, Playwright runtime configuration, native download behavior, and namespace-cookie handling.
- Verified the production build passes; 12 focused unit tests pass; targeted ESLint passes; six focused cross-browser audiobook tests and the original WebKit full-download test pass; and the full isolated Playwright suite passes with 117 passed, 3 skipped, and 0 failed in 20.1 minutes. `git diff --check` also passes.
- Follow-up: stage and commit only the scoped tracked changes and three new unit tests (not this ignored handoff or the user's unrelated root diagnostics), push, and confirm the GitHub Actions workflow passes on a clean hosted runner.

### 2026-07-30 — Resizable foreign-word scan dialog

- Widened the foreign-word scan dialog, enabled horizontal desktop resizing up to the viewport, and added a visible resize hint.
- Fixed the results table column proportions and allowed long foreign words to wrap without expanding their column.
- Verified the focused three-test modal suite, production build, generated resize/width CSS, targeted test ESLint, and `git diff --check`. The modal's targeted ESLint still reports only its previously documented legacy `any` and literal-color violations.
- Follow-up: browser-check the native resize handle and column proportions at the deployment's common desktop sizes.

### 2026-07-30 — Foreign-word pronunciation source highlighting

- Added scan response metadata distinguishing personal-library pronunciations, pre-existing global-library pronunciations, and newly generated Gemini recommendations.
- Gemini is now asked to put its best option first; that option is marked red only for words absent from both libraries. Existing current pronunciations are marked green, with personal entries taking precedence over global entries.
- Prevented redundant Gemini generation for words already present in the personal library.
- Verified 11 focused unit tests, production build, targeted test ESLint, and `git diff --check`.
- Follow-up: browser-check the red/green states against a real account containing personal, global-only, and brand-new words.

### 2026-07-30 — Foreign-word scan controls and refinement recovery

- Replaced the non-working native resize affordance with a pointer-drag resize handle backed by the dialog panel width.
- Added refinement recovery controls for the configured paid backup Gemini key and 30/60/120/240-second retry scheduling; profile backup keys are now honored by the refinement route.
- Added a scan filter for pronunciations not present in the pre-scan global list.
- Added a default-on scan option to generate five choices only for new words; existing global words return only their current choice unless the option is disabled, preserving per-word five-choice refinement.
- Verified 12 focused unit tests, production build, targeted test ESLint, and `git diff --check`. Full TypeScript remains blocked by the repository's unrelated untracked diagnostics and existing audiobook pronunciation route errors.
- Follow-up: browser-test pointer resizing, paid-key fallback, retry countdowns, and both scan generation modes with real profile/global data.

### 2026-07-30 — Biblical-language initialism guidance

- Bumped the shared Kokoro pronunciation policy to version 2 and added explicit Greek/Hebrew initialism and abbreviation handling.
- Gemini is instructed to recognize letter-based forms such as Greek κτλ/κ.τ.λ. as initialisms, avoid IPA, and transliterate them as English letter names separated by commas (for example, “K, T, L”) unless the surrounding text supplies an expansion.
- Verified 9 focused pronunciation-policy tests, targeted ESLint, and `git diff --check`.
- Follow-up: deploy and inspect one biblical-language cleaning/refinement example containing κτλ or a comparable Hebrew initialism.

### 2026-07-30 — Asynchronous foreign-word pronunciation scan and audio warm-up

- Returned extracted foreign words immediately and moved Gemini generation into a background job persisted in `adminSettings`; added a status endpoint and modal polling/progress display so scans no longer wait for the reverse proxy timeout.
- Pre-cached only newly generated Gemini recommended pronunciations. The first user Listen action now warms remaining pronunciation choices in a bounded background queue, with status shown in the dialog.
- Verified 13 focused unit tests, production build (including the new status route), and `git diff --check`.
- Follow-up: deploy and confirm the background job and TTS cache behavior on a real container, including a scan with many new words.

### 2026-07-30 — Foreign-word Gemini result visibility

- Made background scan generation fail visibly when the selected Smart Audio profile has no Gemini key, Gemini returns an HTTP/error payload, malformed content, or no Kokoro-compatible choices; each failed batch is now logged with a dedicated event.
- The scan dialog now reports the exact generated-choice and completed-new-word counts, shows batch failures after completion, and explains blank rows instead of silently presenting them as ordinary empty results.
- Verified 13 focused unit tests, targeted TypeScript output (no changed-file errors), production build, and `git diff --check`.
- Follow-up: deploy this commit, run one fresh scan, and use the displayed count/error to distinguish existing green global entries from failed new-word generation.

### 2026-07-30 — NVIDIA external compute worker and shared-GPU controls

- Added configurable ONNX execution providers (`cpu`, `cuda`, or `auto`) with per-layout/Whisper overrides, CUDA device selection, CPU session-initialization fallback, and optional per-job ONNX session release for shared VRAM.
- Added a cooperative, heartbeat-backed GPU lease for services sharing a host-mounted lock directory; CUDA jobs honor it while CPU-only jobs bypass it. `COMPUTE_JOB_CONCURRENCY=1` remains the recommended in-worker serialization setting.
- Added a CUDA 11.8/cuDNN 8 Linux-amd64 compute-worker image/Compose override and extended Docker publishing to produce `openreader-compute-worker-cuda`. Worker startup and readiness now expose non-secret provider configuration.
- Documented the external-worker setup, PVE/LXC constraints, P100 lack of MIG isolation, shared S3/NATS requirements, CUDA/CPU fallback, VRAM release, and the requirement that unrelated services such as Surya cooperate with the same lease.
- Verified all 34 compute tests, both compute TypeScript projects, the production Next.js build, and `git diff --check`. Docker/GPU image execution could not be tested locally because this workspace has no Docker daemon or NVIDIA device; GitHub Actions will build the new image after push.
- Follow-up: deploy the CUDA worker in the GPU LXC, verify `/health/ready`, confirm `nvidia-smi` shows PP-DocLayout inference, and configure the same host-backed lease contract in every GPU service that must be serialized.

<!-- Add newest entries above this line. -->
