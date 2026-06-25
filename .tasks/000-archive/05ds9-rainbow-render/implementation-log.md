# Implementation Log: Rainbow Lamport IDs Debug Rendering

## Phase 1: Debug State and UI

- Started by confirming the current render path and app-level test harness.
- Added local `rainbowLamportIds` state in `EditorApp`, defaulting to off.
- Added a controlled `Rainbow IDs` checkbox to the existing key perf monitor.
- Changed the key perf monitor to accept pointer events so the checkbox is interactive.
- No issues encountered.

## Phase 2: Thread Render Flag

- Passed `rainbowLamportIds` from `EditorApp` into both editor replicas.
- Added the flag to `RenderBlockContext`, `EditableBlock`, and `RichTextEditableSurface`.
- Passed the flag into annotation body surfaces through sidebar, footnote, and floating popover containers so the mode applies everywhere.
- No workaround needed; the main document path was centralized, but annotation body editors needed their own prop chain.

## Phase 3: Per-Character Backgrounds

- Included `rainbowLamportIds` in the serialized render key so toggling the checkbox triggers DOM replacement.
- Updated run chunking to split every visible character only while rainbow mode is enabled.
- Added safe Lamport color derivation with `(counter % 72) * 5`.
- Invalid or missing character ids are ignored instead of throwing during render.

## Phase 4: Inline Embeds

- Applied the same rainbow background to inline embed elements using the embed sentinel character id.
- No issues encountered yet; click metadata is left untouched.

## Phase 5/6: Tests

- Added app-level tests for the checkbox default state, on/off toggling, per-character colored spans, formatted run splitting, and inline embed coloring.
- First focused test run found two test-only issues:
  - The bold toolbar button is accessible as `B`, not `Bold`.
  - The inline embed DOM node is replaced when rainbow mode rerenders, so the test must re-query the element after toggling.
- Updated the tests for those harness details.
- Focused rainbow test run passes: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "rainbow Lamport"`.
- TypeScript check passes: `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`.
- Full `App.test.tsx` run has one failing existing timing-sensitive perf assertion:
  - Test: `keeps React render after typing in a 70 word block with every fifth word bolded close to plain text`.
  - Failure observed twice in the full file, with marked render around 8.4-8.5 ms and threshold around 5.4-6.5 ms.
  - The same perf test passes when run in isolation, so this appears to be suite-order/timing sensitivity rather than a functional rainbow rendering failure.
