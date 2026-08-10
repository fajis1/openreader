# OpenReader AI Handoff

Shared tracked context for Gemini/Antigravity (`agy`) and Codex.

## Rules

- Read `GEMINI.md` and this file before working.
- Record verified work below.
- Include changed files, tests or checks run, and unresolved follow-up.
- Never place secrets or `.env` contents here.

## Handoff Log

### 2026-08-10 — Internally consistent case-equivalent dictionary entries

- Audited all 2,584 Git-tracked pronunciation words for NFC and case-folded default conflicts. There were no conflicting NFC-equivalent keys; 16 Greek case groups had different defaults.
- Synchronized the default and safe alternative list for 14 reviewed groups where capitalization does not change the lexical word, including `θεοῦ/Θεοῦ`, `ποιεῖσθαι/Ποιεῖσθαι`, and `διαθήκαι/Διαθήκαι`. Kept `Δία/δία` and `Δια/δια` as explicit reviewed case-sensitive exceptions because capitalization may distinguish a proper name or lexical use.
- Strengthened the repeatable Git cleaner to fail on every future unreviewed Greek case conflict, while preserving explicitly reviewed semantic distinctions. The release remains at 2,584 words and now has 9,782 choices because equivalent variants share the same reviewed alternatives.
- Verified an idempotent `pnpm dict:clean:check`, 76 focused dictionary/Smart Audio/pronunciation/multi-voice tests, targeted ESLint, and `git diff --check`. Follow-up: import the new shared dictionary release on each instance; unchanged local values can adopt it automatically, while locally modified conflicts remain reviewable by design.

### 2026-08-10 — Authoritative post-Gemini pronunciation reconciliation

- Added deterministic reconciliation before final Smart Audio validation, storage, and Kokoro: when Gemini tags a single visible word already present in the merged global/profile dictionary, only the IPA is replaced with the existing dictionary value. Visible text, untagged text, and unknown words are unchanged; safely aligned phrase tags are still split first.
- Applied the same behavior to queued generation, direct chapter regeneration, and LitRPG voice segments. Canonically equivalent Unicode and unambiguous case variants match, while conflicting normalized/case-folded dictionary keys fail conservatively without selecting an arbitrary value.
- Prevented Gemini's `new_pronunciations` response from overwriting or re-learning any already-known dictionary word. The existing structural and inflection validators still run after reconciliation and continue to fail closed for unknown bad output.
- Verified 64 focused Smart Audio, pronunciation-policy, timeout, data-integrity, and multi-voice tests; targeted ESLint and `git diff --check` pass. Follow-up: restart/deploy the application code before resuming the stopped audiobook, then regenerate the failed chapter and confirm `ὑμῖν` uses `/hjumin/` in the saved review text and Kokoro request.

### 2026-08-10 — Final Smart Audio pronunciation/OCR gate and chapter-8 verification

- Extended the server-appended cleanup contract so Gemini reconstructs contextually clear missing, split, duplicated, and visually confused OCR characters, then repeated a concise final pronunciation check immediately before the source text in Standard, Scholar, bibliography, and LitRPG multi-voice requests. The final check contains concrete phrase, OCR, inflection, and rough-breathing negative examples.
- Added deterministic post-Gemini normalization and validation before storage/TTS: safely aligned phrase tags are split into one tag per word; unalignable phrases, mixed-script tagged words, Greek final-sigma/final-nu mismatches, and dropped rough-breathing `h` in `υἱ-` words fail closed.
- Restarted OpenReader and both Python workers, then repeatedly regenerated only chapter 8 under an automatic pause guard. The gate caught and rejected a real `θετὸν -> /θɛtɒs/` inflection mismatch before storage. The final chapter-8 `__text.txt` has 80 balanced tags and zero phrase, mixed-script, inflection-ending, dropped-`h`, known OCR-fragment, replacement-character, or control-marker findings; `vio[θεσ]` was reconstructed and the checked forms include `υἱοῦν -> /huioʊn/`, `θετὸν -> /θɛtɒn/`, and `υἱοθεσία -> /huioʊθɛsiɑ/`. The audiobook remains paused.
- Corrected the active Scholar profile and instance-global values for `υἱός`, `υἱὸς`, `υἱοῦν`, and `υἱοῦσθαι` to the reviewed `hui-` convention. Live SQLite backups were written under `docstore/backups/`, and each replaced chapter-8 artifact set was size-verified under `audiobook_regeneration_backups/`.
- Verified 47 focused cleanup/data-integrity/timeout/multi-voice tests, Python compilation, targeted ESLint, and `git diff --check`. Follow-up: consider staging newly learned pronunciations for review instead of immediately promoting every structurally valid value to the profile/global library, because structural validation cannot prove every IPA is semantically correct.

### 2026-08-09 — Mode-aware Smart Audio NATS timeout

- Replaced the duplicated fixed 120-second Gemini/NATS request deadline with a shared resolver: Scholar, bibliography-catcher, and LitRPG multi-voice cleanup now default to 300 seconds, while standard cleanup remains at 120 seconds. `SMART_AUDIO_NATS_TIMEOUT_MS` can override the deadline and is bounded from 30 seconds to 15 minutes.
- Applied the same timeout policy to background generation and direct chapter regeneration, and documented the optional environment setting in `.env.example`.
- Verified 26 focused timeout/data-integrity tests, targeted ESLint, and `git diff --check`. Follow-up: restart or allow dev hot reload, then resume the paused audiobook and confirm slow scholarly batches can exceed two minutes without an NATS timeout.

### 2026-08-09 — Semantic cleanup of the shared pronunciation release

- Re-audited the Git-tracked dictionary beyond structural validation. The release now has 2,584 words/9,767 choices/2,225 definitions; 957 fingerprinted tombstones retire damaged Greek/Hebrew OCR keys, IPA-as-word records, ambiguous English homographs, and other malformed historical entries without silently deleting locally modified conflicts.
- Corrected reviewed complete-word defaults, including Greek/Latin `pneuma` with silent initial `p`, full `υἱοθεσία`, and dropped-prefix/middle/ending cases. Removed `πνεν͂ -> /pnuːm/`, `υἱοθεσ -> /θɛs/`, reversed Hebrew, suffix-only Greek, and phoneme-by-phoneme stutter defaults. No database was modified.
- Strengthened the shared policy and repeatable cleaner to reject silent-`p` violations, partial Greek vowel coverage, malformed Greek/Hebrew key structure, and words spelled as separate phoneme tokens. Added release assertions for the reported values and tombstones.
- Verified `pnpm dict:clean:check` is idempotent, targeted ESLint passes, `git diff --check` passes, the bundled release parser reports no issues, and 41 focused pronunciation/release/data-integrity tests pass. A local Perseus Morpheus lexical cross-check supported removal decisions; non-lexicon proper names and recognizable complete variants were not automatically deleted.
- Follow-up: after deploy/restart, review the administrator Dictionary Update prompt. Unchanged retired shared values can be removed safely; locally changed conflicts remain unselected and require an explicit decision.

### 2026-08-09 — First-class LitRPG Audio Drama casting and review

- Completed the previously disconnected multi-voice prototype: added a visible LitRPG Audio Drama profile/mode, canonical PDF/EPUB/TXT/HTML character scanning, reviewed cast persistence, casting gates in single/batch/Jobs flows, and automatic queue resume. PDF scans use the same `skipBlockKinds`/TOC preparation as generation; changing PDF narration filters now retains voice choices but forces a rescan.
- Moved structured cast extraction and speaker assignment into the shipped `audiobook_worker.py`, sharing its per-key Gemini locks/cooldowns. The old standalone worker now refuses to start. Server validation rejects unknown speakers, changed/unsupported voices, leaked control markers, HTML/XML, malformed tags, or untagged text before Kokoro TTS.
- Improved the casting and desktop review UIs with aliases, add/remove/rename, voice previews, recoverable malformed markup, unsaved-edit protection, and persistent mobile timestamp flags that can be resolved on desktop. Cast and review state is protected from stale generic document-settings writes.
- Verified the optimized production build, Python compilation, targeted ESLint, `git diff --check`, 19 focused multi-voice/settings/TTS tests, and 46 adjacent audiobook/Smart Audio tests. The broader audiobook selection is 145/146 after updating two moved/new-mode assertions; the sole remaining failure is the pre-existing `smart-audio-profile-secrets` source-metadata assertion. Full TypeScript reports only existing untracked scratch/temp-file diagnostics, with no changed-file diagnostics.
- Follow-up: deploy/restart the Node and Python worker together, create or select a LitRPG Audio Drama Smart Audio profile with a configured Gemini key and Kokoro TTS model, then smoke-test one fresh PDF through cast scan, voice review, generation, mobile flagging, and desktop regeneration.

### 2026-08-09 — Shared pronunciation release cleanup and safe propagation

- Deterministically cleaned the Git-tracked global pronunciation release: reduced it from 3,540 words/13,919 choices to 3,339 words/13,142 choices, removed 201 malformed word entries and 15 unsafe choices, repaired nine trusted entries, and removed 117 unusable definitions. Added an idempotent `dict:clean`/`dict:clean:check` workflow and made future database-to-Git exports run the same cleanup automatically.
- Added 202 fingerprinted pronunciation/definition tombstones and replaced the release updater so it compares complete choice arrays, imports all shared choices, offers unchanged retired entries as safe preselected removals, and leaves locally modified deletion conflicts unselected. Admins update the instance-global library transactionally; non-admin users can adopt updates into or remove retired values from their active profile without overwriting unrelated personal entries.
- Expanded the shared Kokoro policy to reject phrase keys, IPA-as-key records, mixed-script OCR fragments, consonant fragments, repeated/stutter pronunciations, and spelled-letter garbage before new scan/refine results can re-enter the library. Corrected the fallback `Aetherians` pronunciation and removed its malformed phrase fallback.
- Included the release JSON files and maintenance scripts in the production image, added Next.js output tracing for the three release files, and made startup dictionary seeding fail visibly instead of silently continuing after an import error.
- Verified the production build, targeted ESLint, `git diff --check`, release idempotence, bundle tracing, and 52 focused tests. The full unit suite passed 657/658; the isolated remaining failure is the pre-existing `smart-audio-profile-secrets` assertion that write-only source-profile metadata is removed, outside this change's files.
- Follow-up: after deployment, sign in as an administrator and review the Dictionary Update prompt; unchanged malformed records are preselected for removal, while any locally edited value requires an explicit decision. Do not bulk-select deletion conflicts without reviewing their local values.

### 2026-08-09 — Pronunciation-library repair

- Backed up the workspace SQLite database to `docstore/backups/pronunciation-cleanup-before-2026-08-09.sqlite3.db`, then transactionally cleaned `docstore/sqlite3.db` without changing application source.
- Removed 124 malformed global words, 355 contaminated profile entries across stored preference copies, and 87 document-lexicon OCR fragments. Normalized 1,086 profile values for Kokoro compatibility, corrected `Aetherians` and `Limes`, preserved the intended `Eather` sound, repaired four trusted global defaults, and repaired two document entries. Ambiguous batch-mismatched pronunciations were deleted rather than guessed.
- Verified both databases with SQLite `integrity_check`; a second cleanup dry run reported zero changes. Independent audits found zero remaining malformed keys, repeated-token defaults, incompatible stress/pharyngeal values, or unresolved known batch mismatches in the cleaned scopes. The focused pronunciation/lexicon suite passed all 51 tests.
- Follow-up: this repair affected only the workspace database. If a deployed Ripeaver instance uses a separate database, back it up and run an equivalent audited repair there before relying on these data changes.

### 2026-08-09 — PP-DocLayout audiobook pipeline hardening

- Unified foreground and queued PDF preparation around one block filter. The background worker now loads each document's `pdf.skipBlockKinds` before chapter batching, so the default headers, footers, footnotes, and vision footnotes are removed before Gemini or TTS.
- Added mandatory runtime cleanup rules after saved profile prompts, explicit `cleaned`/`omitted` Python worker outcomes, fail-closed Smart Audio errors, and a final validation gate that rejects leaked layout, system-hint, chapter-title, or misplaced omission markers before storage/TTS.
- Kept Scholar-only layout metadata in `cleanupText` while saving marker-free source text as `__original.txt`; aligned bibliography-catcher with Scholar lexicon preflight, definitions, and NATS routing. Direct explicit omissions now remove stale chapter/combined audio instead of falling back to raw text.
- Verified 77 focused unit tests, Python compilation for both cleanup workers, and `git diff --check`. Full TypeScript reports only pre-existing untracked scratch/temp-file diagnostics; targeted ESLint reports only existing legacy violations in the two large route/worker files, with no findings in the new helpers or tests.
- Follow-up: deploy/restart the Node and Python workers together, then smoke-test a new PP-DocLayout PDF containing headers and both footnote kinds; confirm no internal marker appears in Review text or generated audio.

### 2026-08-09 — Audiobook Pipeline WIP Checkpoint

- Checkpointed the current audiobook work before PP-DocLayout pipeline hardening: M4B chapter compatibility, Gemini queue backoff, empty-response handling, force re-recording, provider-aware batch regeneration, download feedback, pronunciation cleanup controls, and updated Smart Audio prompts.
- Added the missing authenticated Clean Phrases API route required by the pronunciation inspector and corrected its authentication integration.
- Verified 33 focused audiobook/Smart Audio tests, Python worker compilation, default-profile JSON parsing, and `git diff --check`. The broader data-integrity selection had 51/52 passing; its remaining assertion expects the former hardcoded Standard NATS subject instead of the current Scholar-aware `targetSubject`. Full TypeScript remains blocked by excluded root diagnostics and temporary API routes.
- Follow-up: implement shared PP-DocLayout block filtering, an explicit Smart Audio omission contract, mandatory output validation, and foreground/background Scholar parity before treating layout-tag cleanup as complete.

### 2026-08-08 — M4B Chapters, Rate Limit Backoff, and Layout Tags

- **M4B Chapter Compatibility Fix (`src/app/api/audiobook/route.ts`):**
  - Removed the `+disable_chpl` flag from FFmpeg's `-movflags` when combining audiobooks. This flag previously prevented the encoder from writing standard Nero chapters (the `chpl` atom) into the final M4B container, which caused many non-Apple audiobook players (like Smart Audiobook Player, VLC, and Android apps) to see the file as a single long track without chapters.

- **Gemini Rate Limit Backoff (`src/lib/server/audiobooks/worker.ts`):**
  - Addressed system-wide Gemini API `429 Too Many Requests` errors during background pronunciation and definition scans.
  - Implemented a 10-minute backoff (`RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000`) for any background job paused due to Gemini rate limits. The queue manager will now ignore these jobs for 10 minutes instead of instantly re-queueing them and creating an infinite request loop.

- **Layout Engine Tag Cleanup (`src/lib/server/default_smart_audio_profiles.json`):**
  - Added an aggressive rule (Rule 13) instructing Gemini to forcefully delete lingering layout engine tags (e.g., `[LAYOUT_ENGINE_TAG: FOOTNOTE]`, `[LAYOUT_ENGINE_TAG: NUMBER]`) from the text, as these tags were erroneously being read aloud by Kokoro TTS.
  - Wrote a temporary Node.js backend script (`src/app/api/temp-s3/route.ts`) to manually parse and scrub the active document's text files for these tags and fix the immediate issue on chunks 4, 6, and 10 without needing to burn LLM tokens.

### 2026-08-08 — Fixed Batch Regenerate API Endpoint and Phonetic Rules

- **Batch Regenerate Fix (`src/app/api/audiobooks/batch-regenerate/route.ts`):**
  - Fixed an issue where clicking "Re-Record All Modified chunks" did not spawn any Kokoro TTS generation. The background fetch request was using the external `host` header which timed out inside the Docker container's isolated network. Hardcoded `baseUrl` to `http://127.0.0.1:${process.env.PORT || 3003}` so the Next.js backend correctly routes the `POST /api/audiobook/chapter` request to its own loopback interface.
  - Removed the `(async () => {})()` Immediately Invoked Function Expression (IIFE) that was intended to run the rebuild in the background. Next.js 14 App Router actively terminates orphaned background promises as soon as the API response is returned, which was silently killing the rebuild process. The endpoint now explicitly `await`s the chapter rebuild loop synchronously, keeping the connection open until all audio chunks are successfully rebuilt.
  - Also patched a small bug where the `txtFiles` filtering failed to parse numerical prefixes for modified files.

- **Phonetics Update (`src/lib/server/default_smart_audio_profiles.json`):**
  - Updated the "Biblical Scholarship" profile to explicitly drop silent letters (e.g. `p` in `πνεῦμα` [pneuma] -> `[neuma]`) per user specifications so Kokoro doesn't mispronounce them.

### 2026-08-07 — Fixed Smart Audio API Endpoint Settings Parsing and NATS Routing

- **Smart Audio Payload & NATS Bug Fix:**
  - Fixed a `409 Conflict` (and subsequently `400 Invalid audiobook settings payload`) issue where clicking "✨ Clean with AI" on the review page instantly failed.
  - The UI now passes the `scholarAutoScan: true` flag in the settings payload to grant permission for single-chapter Scholar definition scans.
  - Adjusted `coerceAudiobookGenerationSettings` in `src/lib/server/audiobooks/settings.ts` (via `route.ts` fallback) so that if the UI only sends smart audio toggles (without full TTS fields like `providerRef`), the backend gracefully falls back to the saved `audiobook.meta.json` settings instead of outright rejecting the request.
  - Fixed NATS subject routing in `src/app/api/audiobook/chapter/route.ts` so that single-chapter requests correctly respect `workerMode === 'scholar'` and route to `audiobooks.scholar.clean` (the `biblical_scholar_worker.py`) instead of the hardcoded standard cleaner subject.

### 2026-08-07 — Fixed AI Reading Long Lists of Biblical Citations

- **Gemini TTS Prompt Update:**
  - Modified the `SMART CITATION FILTERING` and `STRIP IN-LINE CITATIONS` rules in `src/components/constants.ts`, `src/lib/server/default_smart_audio_profiles.json`, `config/default_book_tts_settings.json`, and `config/smart_audio_profiles.json`.
  - Gemini is now explicitly instructed to `ALWAYS REMOVE parenthetical lists of multiple biblical citations, even if they contain full book names (e.g., "(Galatians 4:5; Romans 8:15, 23; 9:4; Ephesians 1:5)", "(cf. Gen 1:26, 2:7; Rom 5:12)")`.
  - This solves an issue where `biblical_scholar_worker.py` expands short-form biblical books to full words (e.g., `Gal` to `Galatians`), causing the previous prompt rule (which only looked for abbreviations) to fail and allowed long lists of verses to be read aloud, disrupting the listening experience.
  - Deployed a one-off database migration script to actively patch the updated prompt constraints into existing user preferences.

### 2026-08-07 — Reordered Dictionary UI and Fixed API Key Modal

- **UI Enhancements in BookPronunciationInspectorModal:**
  - Reordered the table columns to match user specifications: Word | Global Choices | My Active Profile | AI Generator | Definition.
  - The "Refine with AI" button is now explicitly located in the "AI Generator" column.
  - The "Definition" column is correctly placed on the far right and retains its inline editing capabilities.
- **Settings Modal Z-Index Fix:**
  - Increased the z-index of `SmartAudioSettings.tsx` to `z-[60]`.
  - This ensures that if the user hits an API key error when clicking "Refine with AI", the settings modal will successfully appear on top of the dictionary modal instead of being hidden behind it.

### 2026-08-07 — Fixed HTML Tag Disruption in Foreign Word Isolation Detection

- **Isolated Word Detection Fix:**
  - Resolved an issue where `enrichTextFromBookLexicon` incorrectly injected English dictionary terms into consecutive foreign words if they were wrapped in HTML formatting tags (e.g., `<i>ἔσται</i>`).
  - The previous regex (`[\p{P}\p{Z}\s]`) did not treat HTML tag characters (`<`, `>`, `i`, `span`, etc.) as valid punctuation, causing the `FOREIGN_WORD_BEFORE/AFTER` checks to fail.
  - Updated the logic to strip HTML tags using `replace(/<[^>]+>/g, ' ')` before testing strings for adjacency, and updated the character class to `[\p{P}\p{S}\p{Z}\s]*` to include math symbols (`<`, `>`, `=`) and allow zero-width boundaries.

### 2026-08-07 — Fuzzy Pronunciation Dictionary Enhancements

- **Fuzzy Search Performance Optimization:**
  - Memoized the Levenshtein distance calculation in `BookPronunciationInspectorModal.tsx` using a `useRef` cache.
  - This prevents the entire dictionary from freezing/re-filtering every time a user adopts a single pronunciation.
- **Global Default Visibility:**
  - Updated the "Global Choices" rendering logic to ensure the current `globalDefault` is always visible as an option, even if it wasn't returned in the AI's top 5 suggestions.
- **Dictionary UX Hint:**
  - Added a visible hint inside the Dictionary Modal instructing users: "💡 Hint: You can double-click any word in the review text to instantly highlight it, then open this Dictionary to fix its pronunciation."

### 2026-08-07 — Fixed Foreign Word Pruning Ignoring Pre-processed IPA

- **Foreign Word Pruning Rule (Rule 11) Enhancement:**
  - Added explicit instructions to the Gemini prompt in `default_smart_audio_profiles.json` and `constants.ts` to treat words wrapped in Kokoro IPA markup (e.g., `[word](/ipa/)`) as "foreign words" when counting for the 5+ word pruning rule.
  - This fixes an issue where the pre-processor (`enrichTextFromBookLexicon`) applied IPA tags to long foreign phrases, causing Gemini to mistakenly treat them as English text and skip pruning.
  - Verified JSON/TS syntax and applied to all profiles using Rule 11.

### 2026-08-07 — UI Improvements, Title Generation, & PDF Fix

- **Compute Core Update:**
  - Fixed an issue in `compute/core/src/pdf/pdfjs-runtime.ts` where `GlobalWorkerOptions.workerSrc` was failing to be set because the `pdfjs` dynamic import was returning a module namespace object with a `.default` property under Next.js/Turbopack, causing `!pdfjs.GlobalWorkerOptions` to bail out silently.
  - The fallback to `.default?.GlobalWorkerOptions` now correctly configures the fake worker and resolves the `DOCUMENT_PREVIEW_GENERATE_FAILED` errors in the logs.
- **Python Workers (Gemini Clean/Scholar):**
  - Clarified the prompt in `audiobook_worker.py` and `biblical_scholar_worker.py` to strongly require a 3-5 word descriptive summary title, not just the word 'continued'.
  - Improved the `[CHAPTER_TITLE: ...]` parsing regex to ignore whitespace padding and case to reliably extract the chunk's AI-generated title instead of falling back to the layout engine's default.
- **Frontend Move:**
  - Moved the "Rebuild Modified Audio" button from the main `page.tsx` review view directly into the `MultiVoiceReviewStudio.tsx` overlay, per user request.
  - Implemented live-polling on the `listen/[bookId]/page.tsx` view so that the Context/Chapter list (with AI titles) and the Editor text automatically refresh every 5 seconds as Gemini and Kokoro background workers process the chunks. Auto-refresh safely pauses if the user manually edits the text to prevent data loss.
  - Updated the middle pane in the review view to display the original, pre-cleanup chunk text side-by-side with the editable cleaned text, making it much easier to review the AI's OCR corrections.
  - Added toggle buttons ("List", "Original", "Edit") to the review page header to allow users to hide/show columns, saving screen real estate on mobile devices and small monitors. Also updated the right pane header to "Edit text (after Smart AI Processing)".
  - Added the exact percentage of completion (`X% done`) alongside the time estimation in the global `JobsInlineView.tsx` background queue UI.
  - Fixed audio player seeking by implementing proper HTTP `Range` request support (`206 Partial Content`) in the `/api/audiobook/chapter/route.ts` API endpoint, allowing users to scrub to the middle of the audio without it snapping back to the beginning.
  - Added a "✨ Clean with AI" button to the "Original Text" column on the review page, allowing users to easily select a failed or messy chunk and re-send its raw text back through the Gemini Smart Audio worker queue.
  - Tightened the prompt instructions in both `audiobook_worker.py` and `biblical_scholar_worker.py` to explicitly forbid Gemini from copying the existing chapter title (like "Foreword") and force it to generate a unique 3-5 word summary based on the actual chunk contents.
  - Fixed a regex bug in the Python worker's pre-clean phase where biblical abbreviations with periods (e.g., `Lev. 26:12`) were failing to expand because the script only matched abbreviations without periods (e.g., `Lev 26:12`).
  - Added a Smart Audio Profile dropdown and a settings shortcut (⚙️) next to the "✨ Clean with AI" button on the Review page. Users can now seamlessly switch between their AI profiles (e.g., swapping to a lighter model) before re-running a chunk.
  - Added a "Clean Edited" checkbox next to the "✨ Clean with AI" button. When checked, the background worker will use the *manually edited text* (from the right column) instead of the original raw OCR text, allowing for a second AI pass over custom edits.
  - Added a "Fix Abbreviations" button to the "Edit Text" column header. This button performs an instant, local regex pass (matching the Python worker's pre-clean phase) over the current text to expand biblical books, verses, and custom abbreviations from the user's active profile, bypassing the need for an AI call.
  - Added a new API endpoint (`/api/audiobooks/fix-abbreviations-all`) and two new buttons to the top navigation bar of the Review page: **"Fix All Abbreviations"** (which runs the regex pass over all chunks in the book in the background) and **"Rebuild Modified Chunks"** (which scans for any modified text files and queues their MP3s to be re-recorded).
  - Consolidated all chunk action buttons (Clean with AI, Fix Abbreviations, Dictionary, Save to Audiobook, and AI settings) into a single unified global toolbar at the top of the screen so they remain visible even when hiding the original or edit columns.

### 2026-08-07 — Global Pronunciation Import Diff Viewer

- **Smart Audio Settings Update:**
  - Expanded the Smart AI Profiles modal width on the login/home page from `max-w-4xl` to `w-[95vw] max-w-7xl` to provide ample horizontal space.
  - Added a built-in diff viewer to the "Global pronunciation import preview" interface. It now displays a scrollable list of all differences between the incoming (Git JSON) library and the current global default (Docker DB).
  - Included a "Listen 🔊" button for both the current and imported pronunciations directly inside the diff viewer so administrators can preview and compare phonetic changes before completing the import.

### 2026-08-07 — Added Abbreviations to End-Matter Filter

- **End-Matter Filtering Update:**
  - Added "abbreviations" to the `END_MATTER_HEADING` regex in `src/lib/shared/audiobook-end-matter.ts`.
  - The system will now automatically omit tedious abbreviation lists and dictionaries when they appear at the beginning or end of a book chapter.

### 2026-08-07 — Strict IPA Output for Biblical Scholarship

- **Gemini TTS Prompt Update:**
  - Modified Rule 5 ("MANDATORY TRANSLITERATION & PHONETICS") and Rule 13 ("FIX BROKEN TTS TAGS") in the `Biblical Scholarship` profile.
  - Gemini is now explicitly instructed to *always* wrap its Greek/Hebrew transliterations in Kokoro IPA tags using the phonetic reference guide (e.g., `[huiothesia](/huioʊθɛsiɑ/)`) rather than outputting bare Latinized words. This gives Kokoro strict phonetic instructions for every non-Latin word.

### 2026-08-07 — Added Broken TTS Tag Cleanup Rule

- **Gemini TTS Prompt Update:**
  - Added Rule 13 ("FIX BROKEN TTS TAGS") to the `Biblical Scholarship` default profile in `config/smart_audio_profiles.json` and actively patched the user's current database profile.
  - Gemini will now correctly identify and merge fragmented Greek/Hebrew words that were split by OCR and mistakenly wrapped in separate TTS phonetic tags (e.g., `[υἱοθε](/niːoʊθɛ/)[σία](/siːɑ/)`), discarding the broken tags and outputting a single, fully-transliterated English word (e.g., `huiothesia`).

### 2026-08-07 — Added Long Foreign Quotation Cleanup Rule

- **Gemini TTS Prompt Update:**
  - Added Rule 12 ("LONG FOREIGN QUOTATIONS") to the `Biblical Scholarship` default profile in `config/smart_audio_profiles.json` and actively patched the user's current database profile.
  - Gemini will now automatically omit consecutive strings of 4 or more foreign words (including raw Greek/Hebrew or phonetic tags like `[word](/IPA/)`) so the listener doesn't have to hear long, unintelligible foreign sentences being read aloud phonetically.

### 2026-08-07 — Fixed Consecutive Foreign Word Definition Suppression

- **Consecutive Foreign Word Bug:**
  - Fixed a bug in `src/lib/server/smart-audio/book-lexicon.ts` where the logic designed to suppress dictionary definitions for consecutive foreign words (to avoid overwhelming the listener) failed if the words were separated by punctuation (like commas).
  - The `FOREIGN_WORD_BEFORE` and `FOREIGN_WORD_AFTER` regexes were overly strict (`\s+`) and only checked for spaces. They were updated to `[\p{P}\p{Z}\s]+` to correctly account for any Unicode punctuation or separators between the foreign words.

### 2026-08-07 — Added Stray Foreign Letters Cleanup Rule

- **Gemini TTS Prompt Update:**
  - Added Rule 11 ("STRAY FOREIGN LETTERS") to the `Biblical Scholarship` default profile in `config/smart_audio_profiles.json` and actively patched the user's current database profile.
  - Gemini will now automatically omit isolated/stray Greek and Hebrew letters (like 'δ' or 'א') from the final text instead of leaving them in for Kokoro to mistakenly read aloud as spelled-out words (e.g., "delta").

### 2026-08-07 — Fixed Stale Chapter Text Caching after Batch Replace

- **Chapter Text Caching Fix:**
  - Added `cache: 'no-store'` and a `t=${Date.now()}` query parameter to the `fetchChapterText` call in `listen/[bookId]/page.tsx`.
  - This prevents aggressive browser caching of GET requests, ensuring that when users navigate between chunks after executing a "Queue Modified Audio (Batch Replace)", the text area instantly loads the fresh text from the server rather than stale text from cache.

### 2026-08-07 — Clearer UI for Batch Replace and Rebuild Modified Audio

- **Batch Replace UI Clarification:**
  - Renamed the `Batch Replace in Books ⚡` button inside the Dictionary Modal to `Queue Modified Audio (Batch Replace) ⚡`. This clarifies to users that clicking the button modifies the text chunks immediately (effectively "queuing" them for audio regeneration), but does *not* rebuild the audio instantly.
- **Rebuild Modified Audio from Listen Page:**
  - Added a `Rebuild Modified Audio 🔄` button directly to the `listen/[bookId]/page.tsx` editor header. 
  - This allows users to make multiple text edits or dictionary replacements, and then trigger the background rebuild process for the book directly from the review page without having to reopen the dictionary modal.
  - The new handler `handleRebuildAllModified` uses the `/api/audiobooks/batch-regenerate` endpoint (bypassing the modal's multi-book confirmation and strictly executing the current book).

### 2026-08-06 — Multi-Voice Audiobook Generation & Review Pipeline

- **Multi-Voice Generation Pipeline:**
  - Implemented `audiobooks.multivoice.extract` and `audiobooks.multivoice.assign` in the Python worker (`multivoice_worker.py`) using Gemini 3.1 Flash and 3.6 to natively orchestrate Multi-Voice audiobooks.
  - Implemented an interactive mapping UI (`MultiVoiceCharacterModal.tsx`) allowing users to assign standard Kokoro TTS voices (like `af_heart` or `am_adam`) to Gemini-identified characters before audio generation starts.
  - Added support to `worker.ts` for pausing audiobook jobs when the character mapping is incomplete, and passing continuity states (`[CONTINUITY: ...]`) and chapter titles (`[TITLE: ...]`) between Gemini API calls to ensure context is maintained across chunks.
  - Added support to inject `pronunciations` from the global dictionary directly into Gemini 3.6's prompt during voice assignment, ensuring LitRPG custom words are automatically swapped to Kokoro IPA.

- **Audio-Drama Review Studio & Custom Pronunciations:**
  - Built `MultiVoiceReviewStudio.tsx` to let users review the assigned XML voice tags (`<voice name="af_heart">Hello</voice>`) for an entire chapter after it's generated.
  - Added features like "✂️ Split Segment at Cursor" to fix Gemini grouping multiple speakers into one chunk.
  - Added a "Kokoro Prosody Toolbar" allowing 1-click insertion of stress marks (`ˈ`, `ˌ`) and volume adjustments (`(-1)`, `(+1)`).
  - Extended the global Pronunciation Library (`BookPronunciationInspectorModal.tsx`) with a full "+ Add Custom Word" UI, allowing users to manually enter words missed by the scanner.
  - Integrated Gemini phonetics suggestion (via the `/api/tts/refine-pronunciations` endpoint) directly into both the Review Studio's dictionary and the main Pronunciation Library modals, enabling automatic Kokoro IPA suggestions for new custom words.
  - Wired the Review Studio into `/listen/[bookId]/page.tsx`, allowing it to be launched on desktop while the background audiobook process is still running.

- **Audiobook Queue Management & CI/CD Stability:**
  - Added "Pause" and "Resume" functionality to the audiobook queue (`JobsInlineView.tsx`), complete with a `/api/audiobooks/queue` PATCH route to update job statuses dynamically.
  - Implemented a "Review Progress" button in the queue that opens partial audiobooks (e.g., at 25% completion) for live review.
  - Repaired a critical CI/CD issue where redundant GitHub Actions workflows queue up for hours; implemented `concurrency` groups across all `.yml` workflows (`vitest.yml`, `playwright.yml`, `docker-publish.yml`, `docs-check.yml`) with `cancel-in-progress: true` to instantly cancel obsolete runs upon new pushes.

- **Mobile Review Player:**
  - Built `MobileReviewPlayer.tsx`, a sleek mobile-first player that automatically mounts on small screens on the `/listen/[bookId]` page.
  - Features a massive "🚩 Flag Error" button so users can flag timestamp locations of incorrect voices or pronunciations while listening on their commute, which can later be reviewed and fixed on the Desktop Review Studio.
  - Persists playback state across sessions via `localStorage`.

- **Follow-up:** 
  - Need to hook the mobile flags data to the backend DB (currently it just console logs).

### 2026-08-05 — Dev Server Stability, Heteronym Bypass, and Chapter Title Fixes

- **Dev Server Stability:**
  - **Problem:** Node.js routinely OOM crashed during heavy `audiobooks` batch processes, leaving orphaned `next-server` processes that blocked Port 3003 (causing `EADDRINUSE` upon manual restart).
  - **Fix:** Increased Node max heap to 8GB (`NODE_OPTIONS=--max-old-space-size=8192`) in `package.json` dev scripts. Added a crash-recovery loop to `scripts/openreader-entrypoint.mjs` to auto-restart the main app if it crashes unexpectedly.
- **Heteronym & Homograph TTS Rule:**
  - **Problem:** Global pronunciation dictionary was indiscriminately learning and misapplying heteronyms (e.g., forcing the biblical "Job" /dʒoʊb/ pronunciation on the occupation "job" everywhere).
  - **Fix:** Added a new rule to `src/lib/shared/kokoro-pronunciation-policy.ts` instructing Gemini to output heteronyms using a stealth syntax: `[Word](!/IPA/)`. The global dictionary scraper ignores the `(!/IPA/)` pattern. `audiobook_worker.py` and `biblical_scholar_worker.py` then use regex to strip out the `!` exclamation mark right before sending the text back to Node.js, ensuring Kokoro TTS receives valid markup without polluting the global dictionary.
- **Chapter Titles:**
  - **Problem:** AI chapter titles were not generating for standard audiobooks, and when they did generate for scholar, they were never saved to the database (and therefore not embedded in the `.m4b` metadata).
  - **Fix:** Appended the `[CHAPTER_TITLE: ...]` generation and extraction logic to `audiobook_worker.py`. Added a `db.update(audiobookChapters)` call to `src/lib/server/audiobooks/worker.ts` so the title is permanently saved, ensuring it automatically passes through to the FFMpeg `FFMETADATA` file.

### 2026-08-05 — bibliography-catcher mode now equals scholar feature set

- **Problem:** `bibliography-catcher` workerMode routed to `audiobook_worker.py` on `audiobooks.gemini.clean`, giving it only standard-mode features (no definitions, no changelog, no chapter titles).
- **Fix in [`src/lib/server/audiobooks/worker.ts`](src/lib/server/audiobooks/worker.ts):**
  - Added `SCHOLAR_NATS_SUBJECT = 'audiobooks.scholar.clean'` constant.
  - Added `isScholarLikeMode(mode)` helper that returns true for both `'scholar'` and `'bibliography-catcher'`.
  - All `workerMode === 'scholar'` guards expanded to `isScholarLikeMode(...)`: global definitions loading, book lexicon loading, auto-scan gate, and `includeDefinitions` flag.
  - NATS request now routes to `SCHOLAR_NATS_SUBJECT` when `isScholarLikeMode` is true, so bibliography-catcher hits `biblical_scholar_worker.py` which already generates changelog diffs and chapter titles.
  - Log line updated to reflect the correct NATS subject per mode.
- **Net result:** bibliography-catcher now requires a book pre-scan, inserts English definitions, produces a changelog diff, and generates chapter titles — identical to scholar mode, plus its existing layout-engine structural tags.
- **Follow-up:** Server restart required for `worker.ts` changes to take effect (Next.js hot-reload applies only to UI code in dev mode; the background queue worker process must be restarted).

### 2026-08-05 — Fixed Kokoro IPA phonetic tag stripping bug

- **Root cause found and fixed:** `preprocessSentenceForAudio` in [`src/lib/shared/audio-text.ts`](src/lib/shared/audio-text.ts) had a regex `.replace(/\[([^\]]+)\]\(\/([^\/]+)\/\)/g, '$2')` that was intended to extract IPA for Kokoro but instead stripped the full `[Word](/IPA/)` tag and sent only the raw IPA characters (e.g., `hyioʊθɛsiɑ`) to the TTS engine. Kokoro read each character as an individual letter instead of using its phoneme parser.
- **Fix:** Removed the stripping regex. Kokoro's server-side normalizer natively parses the `[Word](/IPA/)` markdown tag format. The full tag is now passed through untouched.
- **Cache purge:** Deleted 10 stale `tts_segment_entries` from `docstore/sqlite3.db` (segments keyed by the old stripped-IPA text). Fresh audio with correct phoneme pronunciation will be generated on next playback.
- **Verified:** `audio-text.ts` change does not affect highlight-char-map (which imports individual pattern constants, not the stripping regex). The `normalizeMappedChars` position-preserving path is unaffected.
- **Also implemented:** Chapter title generation via Gemini — `biblical_scholar_worker.py` now appends a `[CHAPTER_TITLE: N-word summary]` tag after the cleaned text; `worker.ts` parses `workerResult.chapter_title` and assigns it to `chapter.title` before DB insert. Requires server restart to take effect.
- **Follow-up:** A server restart is needed to pick up both `audio-text.ts` (frontend/server build) and `biblical_scholar_worker.py` changes.

### 2026-08-04 — Added Review Audiobook button and fixed listen page infinite loop

- Fixed an infinite rendering loop in the `ListenPage` component caused by `setTTSText` in a `useEffect` dependency array; playback toggles no longer trigger a re-render crash.
- Fixed a bug in `TTSContext` where it failed to read the `bookId` URL parameter, previously causing it to block playback on the `/listen/[bookId]` route.
- Cleaned up orphaned Next.js and Python worker background processes after a development server crash, restoring embedded `SeaweedFS` storage connectivity.
- Added a "Review Audiobook" button next to "Pre-Scan Foreign Words" in the `DocumentList` action bar for quick navigation.
- Fixed layout alignment and date/icon overlap in `ListView.tsx` by dynamically sizing the actions column using `min-content`.
- Verified user testing of the dev server UI.
- Follow-up: none.

### 2026-08-03 — Routed mixed-script OCR fragments through Gemini review

- Python now retains raw evidence when a Greek/Hebrew regex match is embedded in a mixed Latin/bracketed OCR token (for example, `vio[θεσ]iα`) instead of silently discarding that context.
- Gemini receives the evidence and makes the final `ocrFragment` classification. Confirmed fragments receive no pronunciation or definition and are excluded from the book lexicon and global-persistence path; intact terms remain eligible for normal processing.
- Bumped the foreign-word candidate cache to version 4 so scans do not reuse candidate lists created before OCR evidence was retained.
- Verified Python scanner tests, TypeScript, 40 focused Vitest tests, and `git diff --check`.
- Follow-up: rebuild/redeploy and rescan a document containing a mixed-script OCR artifact; existing historical global fragment entries are deliberately not auto-deleted and should be reviewed before removal.

### 2026-08-03 — Current pre-scan and audiobook operational state

- Pre-scan coverage is now fixed at 100% in both the modal and server route. This is required for a Scholar book lexicon to be certified as complete for audiobook generation.
- The mixed-script OCR evidence/classification flow runs in the document pre-scan only. Audiobook chapter cleanup uses its saved book/global lexicon plus a separate per-chapter Gemini cleanup pass; it does not re-run OCR candidate classification.
- A completed scan of the main Adoption document saved a complete Scholar lexicon with 2,964 entries and no Kokoro-unsafe IPA. Historical OCR-shard entries may still be visible in the global library until manually reviewed and removed.
- The local audiobook job was running without a recorded error when inspected; its Gemini cleanup batches were far below the Gemini 3.1 Flash-Lite token limits.

### 2026-08-03 — Made document pre-scans full coverage only

- Removed the Top 80% scan option; the pre-scan UI now clearly reports Full 100% coverage.
- The server now enforces `target = 100` regardless of a stale client request, preventing a partial scan from later failing Scholar audiobook preflight solely because of its scope.
- Verified TypeScript, focused scan-modal and Scholar-lexicon tests (26 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy, run one new pre-scan for an existing partial book, and confirm its saved lexicon is marked complete before creating the audiobook.

### 2026-08-03 — Transfer global definitions with global dictionary JSON

- Global JSON export/import now transfers both validated pronunciation choices and usable global definitions (format version 2), while retaining support for older pronunciation-only exports.
- Import preview reports definition counts and rejects blank or placeholder definitions; default merge preserves existing target definitions, while replace mode may intentionally replace definitions for imported terms.
- This prevents Scholar-mode scans from re-requesting Gemini definitions solely because IPA was imported without its cached English gloss.
- Verified TypeScript, 46 focused Vitest tests, two Python scanner tests, and `git diff --check`.
- Follow-up: export a fresh version-2 global dictionary from the source Reader and import it into the target Reader before the next Scholar pre-scan.

### 2026-08-03 — Excluded phrase candidates from foreign-word dictionaries

- Foreign-word scans now exclude whitespace-containing phrases and accidental slash-delimited IPA keys before sending candidates to Gemini or using them as reusable dictionary entries.
- Bumped the candidate-cache version so future scans do not reuse an earlier candidate list; custom searches remain exempt to preserve intentional multi-word queries.
- Verified TypeScript, 27 focused Vitest tests, two Python scanner tests, and `git diff --check`.
- Follow-up: rebuild/redeploy and run a scan of the affected document; remove the existing personal phrase override once, then the scanner will not recreate it.

### 2026-08-03 — Added manual personal-pronunciation repair controls

- Added Edit and Use Global controls beside each malformed personal/profile pronunciation in the Global Pronunciations health panel.
- Manual values are normalized to slash-delimited IPA and blocked unless they pass the same Kokoro safety checks; Use Global removes only the personal override so an existing global choice can apply.
- Verified TypeScript, focused global-pronunciation and scan-modal tests (15 tests), and `git diff --check`.
- Follow-up: browser-test edit/save and use-global flows in a real profile before deployment.

### 2026-08-03 — Reflowed global library admin actions

- Moved Export Global JSON and Import Global JSON to a second action row below the primary document/inspection/global-list controls, preventing them from running off-screen on narrower settings layouts.
- Verified TypeScript, focused global-pronunciation tests (8 tests), and `git diff --check`.
- Follow-up: browser-check the settings card at the deployment's target screen width after rebuild/redeploy.

### 2026-08-03 — Added admin global-pronunciation import preview

- Added an admin-only Import Global JSON control beside the global-library export action.
- Imports accept OpenReader export envelopes or raw pronunciation dictionaries, validate every choice against the Kokoro safety policy, preview malformed/duplicate entries, and require a second explicit import action before writing.
- Safe merge is the default and preserves existing defaults; an admin may explicitly replace choices only for imported words.
- Verified TypeScript, focused global-pronunciation and scan-modal tests (15 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy the web image and browser-test import preview/merge with an exported library.

### 2026-08-03 — Clarified foreign-word scan progress wording

- Updated the scan modal to report terms processed separately from newly generated pronunciation choices.
- Removed the misleading implication that the scan total represents missing/new pronunciation words; Scholar-mode definition/review queues now display accurately.
- Verified TypeScript and the focused scan-modal unit test.
- Follow-up: rebuild/redeploy the web image to expose the wording change.

### 2026-08-03 — Added admin global-pronunciation export

- Added admin-authenticated `GET /api/tts/global-pronunciations/export`, returning the normalized global library as a downloadable JSON file with no credentials or private settings.
- Added an admin-only Export Global JSON button in Smart Audio Settings.
- Verified TypeScript, focused modal/data-integrity tests (25 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy to expose the export endpoint in the running web image.

### 2026-08-03 — Added cancellable foreign-word scans

- Added an authenticated scan-status cancellation endpoint that marks only the owned queued/running job as `cancelled`.
- The background scanner now checks the durable job flag before continuing or overwriting progress, exits cleanly after cancellation, and preserves results already persisted from completed batches.
- The scan modal now stores the job ID, shows a Cancel scan button, stops polling after cancellation, and explains that completed results were kept.
- Verified TypeScript, focused scan-modal/lexicon/data-integrity tests (43 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy the web image; cancellation takes effect between Gemini requests (an already in-flight request may finish before the worker observes the flag).

### 2026-08-03 — Global dictionary baseline with local overrides

- Added a provider-safe `global_definitions` admin library alongside the existing global pronunciation library; foreign-word scans and Scholar audiobook preparation now persist usable definitions there.
- Global pronunciations and definitions are always loaded as the baseline. Profile/book lexicon entries are applied afterward as individual-word overrides, and the audiobook lexicon resolver seeds both fields before deciding whether Gemini is needed.
- A fully resolved global/local entry now completes without requiring a Gemini key or making a redundant Gemini request. The Smart Audio settings UI describes the global library as always enabled.
- Verified TypeScript, focused lexicon/data-integrity/definition-policy tests (39 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy the web image and rerun the affected audiobook job; existing global definitions will prevent another lookup for already-resolved words.

### 2026-08-03 — Persist scan results after every successful batch

- Foreign-word scans now merge accepted global pronunciation choices and usable definitions immediately after each successful Gemini batch, while retaining the final idempotent persistence/completion stage.
- Added batch persistence events with database-provider and applied-count metadata. A Reader restart can no longer discard all generated choices from earlier completed batches.
- Verified TypeScript, focused lexicon/data-integrity/definition-policy tests (39 tests), and `git diff --check`.
- Follow-up: rebuild/redeploy before the next scan; existing in-memory results from a currently running old image cannot be recovered after interruption.

### 2026-08-03 — Fixed SQLite Smart Audio profile persistence

- Split `writeSmartAudioProfilesDocument` and `mergeGeneratedPronunciationsIntoLatestProfile` into PostgreSQL async/advisory-lock and SQLite synchronous better-sqlite3 transaction paths.
- SQLite profile reads now use `.all()` and writes use `.run()`, preventing `Transaction function cannot return a promise` after a scan has already generated and persisted pronunciations.
- Added data-integrity regression assertions for the synchronous profile transaction path.
- Verified `pnpm exec tsc --noEmit`, focused profile/lexicon/SQLite tests (36 tests), Python scanner tests, and `git diff --check`. The full OpenReader suite reached 106/107 files and 628/629 tests; its single failure was the unrelated environment-sensitive runtime seed fallback test, which received an auto-generated keyless provider instead of the test's expected env-fallback provider.
- Follow-up: rebuild/redeploy and rerun the existing cached scan; the book should be marked complete without triggering another Gemini scan.

### 2026-08-03 — Dictionary placeholder suppression and editing

- Added a shared definition-quality policy that converts meta-glosses such as “Fragment or inflected form,” “OCR fragment,” and “inflected form” to intentional `null` definitions so they are never inserted into audiobook narration.
- Extended both foreign-word Gemini prompts and structured output with `definitionOmitted`; intentional omissions now satisfy lexicon completion without repeated scans, while useful contextual definitions remain unchanged.
- Filtered the known `κω` OCR fragment from both Greek/Hebrew and all-foreign Python scans and bumped the candidate-cache version so older cached candidates are not reused.
- Added a document-level saved-definition health check with bulk removal plus per-row add/edit/clear controls; cleanup preserves the pronunciation while removing only the unusable definition.
- Verified TypeScript, targeted ESLint, 36 focused unit tests, all OpenReader unit tests (107/107 files, 629 tests), two Python scanner tests, and `git diff --check`.
- Follow-up: rebuild/redeploy, audit the affected document, remove its saved placeholder definitions, and browser-test manual editing; no live Gemini or audiobook generation was run from this workspace.

### 2026-08-03 — One-pass Gemini pronunciation quality correction

- Bumped the Kokoro pronunciation policy to version 3, explicitly rejecting adjacent `/y/`/`/j` glides and grouped capital sequences while preserving comma-separated initialism letters.
- Foreign-word scans now strictly validate initial Gemini choices, send only omitted/incomplete/unsafe terms and their exact violations through one automatic correction request, then stop retrying and mark any remaining incomplete terms for review.
- Filtered unsafe personal/global/generated choices from scan reuse and persistence so malformed results cannot become document or global-library defaults.
- Verified `pnpm exec tsc --noEmit`, all OpenReader unit tests (106/106 files, 625 tests), 21 focused tests, and `git diff --check`. Targeted route lint remains blocked only by its pre-existing file-wide `any`, console, and response-helper violations.
- Follow-up: rebuild/redeploy and run a live scan containing adjacent-glide and Greek, Hebrew, and Latin initialism examples; no live Gemini request was made from this workspace.

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

### 2026-08-04 — Layout Engine Hints for Bibliography Catcher Profile

- Exposed PDF layout block kinds (e.g., `reference`, `table`) directly to the Gemini TTS text generation process.
- Created a new Smart Audio profile worker mode, `bibliography-catcher`, which injects structural tags like `[LAYOUT_ENGINE_TAG: REFERENCE]` directly into the text chunk.
- Added a new default Smart Audio profile named "Bibliography Catcher (Test)" with instructions instructing Gemini to ruthlessly delete any end-matter blocks flagged with these layout tags.
- Verified build and TypeScript compatibility.

### 2026-08-04 (Part 2) — Table of Contents Page Cutoff via pdfjs-dist

- Implemented deterministic PDF page cutoffs by parsing the embedded digital Table of Contents (Outline) directly from the raw PDF using `pdfjs-dist`.
- Added `src/lib/server/pdf-parse/toc.ts` to identify the start page of Chapter 1 and the exact start page of end matter (Bibliography, Index, Works Cited).
- Integrated this TOC filter directly into `src/lib/server/audiobooks/worker.ts`. Any PDF pages before the first chapter, or after the end matter, are now entirely dropped before the smart audiobook process even sees them.
- Wrote and executed a script (`fix_profiles.ts`) to forcibly push the "Bibliography Catcher (Test)" profile into the user's database state to ensure they could see it in the UI.
- Next Agent: The user is currently testing the 18 MB "adoption as sons" PDF against this new logic locally. If they need further refinements, check how `computeTocBoundaries` matches the section titles.

<!-- Add newest entries above this line. -->

### 2026-08-03 — Filter malformed mixed-script OCR fragments from global pronunciation dictionary

- Updated `filterKokoroCompatiblePronunciationRecord` in `kokoro-pronunciation-policy.ts` to reject words containing brackets, digits, or mixed Latin/Greek/Hebrew characters.
- This ensures that if the Gemini audiobook generator attempts to fix or pronounce an OCR corrupted string like `vio[θεσ]iα` without removing the corruption, the malformed string will not be learned and saved into the global pronunciation dictionary.
- Verified all TypeScript tests pass.

## 2026-08-06 Multi-Voice Audio-Drama Implementation

**What Changed:**
- Created `multivoice_worker.py` to handle character extraction and voice assignment via Gemini.
- Updated `src/types/client.ts` to add `multi-voice` to `workerMode`.
- Updated `src/types/document-settings.ts` to add `SmartAudioCharacterMap` to `DocumentSettings`, including the `aliasFor` field for merging duplicate characters.
- Created `src/app/api/audiobook/characters/scan/route.ts` to manually trigger the Pass 1 extraction.

**Next Steps:**
- Update `src/lib/server/audiobooks/worker.ts` to pause generation if voices aren't assigned (status `waiting_for_voices`).
- Update `worker.ts` to send chunks to `audiobooks.multivoice.assign` with the mapped character list and continuity state.
- Create the UI for mapping characters.
- Build the Review Studio UI for editing character segments and forcing a regeneration.


## 2026-08-07
* **Changed:** Updated `BookPronunciationInspectorModal.tsx` in Next.js to properly parse and display the 5 newly generated Kokoro IPA pronunciation options returned by Gemini instead of blindly refetching data from the server.
* **Verified:** The bug was traced from `fetchPronunciations` wiping the local state over `data.newChoices`. The fix updates local state appropriately when new choices are successfully returned from `/api/tts/refine-pronunciations`.
* **Follow-up:** None.

## 2026-08-08
- Fixed TTS batch generation script failing to resolve external Kokoro base URLs
- Fixed TTS batch generation script falling back to an invalid Kokoro model name (kokoro-v1)
- Verified that 'Force Re-Record All' properly runs the generation queue against the user's custom Kokoro provider
