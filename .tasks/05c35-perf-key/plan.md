# Plan: Keypress Performance Monitor

## Scope

Add an always-visible, fixed-position performance monitor to `examples/block-rich-text`. It should collect synchronous input-handler timings for all editor input paths:

- normal printable text through `beforeinput`
- Backspace/Delete through `beforeinput` or handled `keydown`
- shortcuts, navigation, Enter, and Tab handled by `keydown`
- paste events
- repeated keydown events, sampled individually

Samples should be combined across both editors in one chart. They are transient runtime instrumentation and should not be persisted in history export/import.

## Phase 1: Add Transient Perf Sample State

Update `examples/block-rich-text/src/App.tsx`.

1. Add local types near the editor app types:
   - `KeyPerfSample`
   - a callback payload type for recording a sample

2. Add state in `EditorApp`:
   - `keyPerfSamples`
   - `nextKeyPerfSampleIdRef`

3. Add a bounded append helper:
   - keep the last 60 or similar samples
   - store `{id, editorId, label, ms}`
   - clamp or sanitize non-finite durations defensively

4. Pass an `onKeyPerfSample` callback into both `BlockEditor` instances.

Acceptance checks:

- Perf samples are independent from `history`.
- Reset/import/replay history does not need to preserve or replay perf samples.

## Phase 2: Render the Monitor

Update `examples/block-rich-text/src/App.tsx` and `examples/block-rich-text/src/style.css`.

1. Add a small `KeyPerfMonitor` component:
   - renders near the top of `EditorApp`
   - shows the latest duration, such as `7.4 ms`
   - shows the latest input label
   - renders one bar per sample
   - renders an empty baseline state when no samples exist

2. Map sample duration to bar height:
   - cap visual scale at roughly 50ms
   - keep sub-16ms samples readable
   - avoid layout shifts by using fixed monitor and bar dimensions

3. Add threshold styling:
   - fast: under 8ms
   - medium: 8-16ms
   - slow: over 16ms

4. Style the monitor as instrumentation:
   - fixed top-right
   - compact dimensions
   - high z-index
   - `pointer-events: none`
   - no impact on editor layout

Acceptance checks:

- Monitor is visible on initial load.
- Bars do not resize the panel.
- Existing editor layout remains unchanged.

## Phase 3: Instrument Text, Delete, and Paste Paths

Update `RichTextEditableSurface` and its call sites in `App.tsx`.

1. Add an optional input timing callback prop to `RichTextEditableSurface`.

2. In the native `beforeinput` listener, measure synchronous duration around command callbacks:
   - `insertText`
   - `deleteContentBackward`
   - `deleteContentForward`

3. Emit samples for every handled `beforeinput` event:
   - label printable input as the inserted character when short and safe
   - label longer input as `text`
   - label backward delete as `Backspace`
   - label forward delete as `Delete`

4. Instrument paste handling:
   - measure around `onPaste` command handling
   - label as `Paste`
   - include both rich clipboard and plain text paste paths

5. Thread the timing callback through all `RichTextEditableSurface` call sites:
   - normal blocks
   - table row headers
   - table title/cells
   - annotation body/editor surfaces, if they use the same component

Acceptance checks:

- Typing normal letters creates samples.
- Holding a printable key creates one sample per input event.
- Backspace/Delete creates samples whether handled by `beforeinput` or `keydown`.
- Pasting creates a sample.

## Phase 4: Instrument Handled Keydown Paths

Update the block-level `onKeyDown` handlers in `App.tsx`.

1. Add a helper for measuring handled keydown work:
   - start with `performance.now()`
   - run the existing handler branch
   - emit a sample only if the branch actually handled editor work

2. Avoid sampling irrelevant keydowns:
   - do not record unhandled printable keydowns, because `beforeinput` handles text input
   - do not sample Escape-only popover close unless it becomes part of the editor input definition

3. Preserve existing keystroke logging behavior:
   - `onKeystroke` can remain for the history log
   - perf samples should be separate from `history.keystrokes`

4. Ensure repeat keydowns are sampled individually:
   - no debounce or aggregation
   - each handled repeat event appends one sample

Acceptance checks:

- Enter, Tab, Backspace, Delete, shortcuts, and handled navigation keys produce samples.
- Unhandled keydowns do not create misleading zero-work samples.
- Existing keyboard behavior remains unchanged.

## Phase 5: Tests

Update `examples/block-rich-text/src/App.test.tsx`.

1. Add monitor rendering tests:
   - monitor exists on initial render
   - empty state is shown before input

2. Add text input test:
   - use the existing typing helper to type printable text
   - assert bars appear
   - assert latest value has an `ms` label

3. Add keydown test:
   - fire Backspace or Enter
   - assert a new sample is shown

4. Add paste test:
   - fire a paste event with text
   - assert a `Paste` sample is shown

5. Add cap test:
   - generate more samples than the configured max
   - assert only the capped number of bars are rendered

6. Add history isolation test:
   - confirm perf samples do not affect history action counts
   - confirm exported history does not include perf samples

Testing details:

- Do not assert exact real durations.
- Use deterministic `performance.now()` stubbing only if class thresholds need stable assertions.
- Prefer accessible labels or `data-testid` only for the monitor/bars if querying by visible text is brittle.

## Phase 6: Verification

Run focused checks:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts
```

If the example app has a standard dev command available, start it and visually inspect:

```sh
npm run dev
```

Manual verification:

- type normal text in Editor A and Editor B
- hold a key to verify repeated samples
- press Enter, Tab, Backspace, Delete
- use formatting shortcuts
- paste a short and large text payload
- confirm bars update without moving editor content

## Notes

- Prefer keeping all monitor code in `App.tsx` unless the component becomes noisy enough to justify extraction.
- Do not expand `history.ts` for perf data unless requirements change.
- Keep the first implementation synchronous, per the answered question. A future post-render latency monitor can reuse the sample state and chart UI with a different timing source.
