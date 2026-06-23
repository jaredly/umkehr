# Research: Keypress Performance Monitor

## Goal

Add a lightweight performance monitor to `examples/block-rich-text` that behaves like a small FPS widget in the top-right corner, but samples editor keypresses. Each sample should render as a bar whose height represents how many milliseconds the keypress took.

The monitor is primarily for interactive diagnosis while typing in the example app. It should stay out of the document layout and be cheap enough that it does not meaningfully distort the timings it reports.

## Relevant Files

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/typingPerf.test.ts`
- `examples/block-rich-text/src/history.ts`

## Current State

The app already has two related pieces:

- A collapsed keystroke log in `EditorApp`, rendered above the editor grid.
- Runtime performance tests in `typingPerf.test.ts`, which measure command-level operations with `performance.now()`.

`EditorApp` owns the `history` state and passes `onKeystroke` into each `BlockEditor`:

```ts
onKeystroke={(blockId, event) => recordKeystroke('left', blockId, event)}
```

`recordKeystroke` appends metadata to `history.keystrokes` through `appendHistoryKeystroke`.

Editable blocks are rendered by `RichTextEditableSurface`. It handles text input with a native `beforeinput` listener:

```ts
element.addEventListener('beforeinput', onBeforeInput);
```

For normal text insertion, `beforeinput` prevents the browser mutation and calls `onInsertText(event.data, selection)`. Deletion via `beforeinput` calls `onDeleteBackward` or `onDeleteForward`.

The React `onKeyDown` handlers are mostly for shortcuts, navigation, Enter, Tab, Backspace, and Delete. They call `onKeystroke(block.id, event)` at the top, then dispatch commands.

Important detail: normal printable typing is primarily handled by `beforeinput`, so the existing keystroke log does not represent every typed character. The current `App.test.tsx` test for keystroke logging types `ab`, then fires Backspace, and expects only the Backspace keystroke to be logged.

## Measurement Options

There are two reasonable interpretations of "how many ms each key press took":

1. **Synchronous command duration**
   Measure from the start of a handled input callback until the command dispatch returns.

   This captures CRDT command work, history updates, replay cache updates, selection reads, and immediate synchronous React state scheduling. It does not include React render, layout effects, DOM replacement, selection restoration, paint, or browser layout.

   This is the simplest and least invasive option.

2. **End-to-render latency**
   Measure from input start until React has committed the editor update, likely using a pending sample ref plus `useLayoutEffect` or `requestAnimationFrame`.

   This better reflects what the user feels after a keypress, because `RichTextEditableSurface` performs DOM replacement and selection restoration in `useLayoutEffect`. It is more complex because not all keypresses produce ops, not all commands change state, and some navigation commands are selection-only.

Pragmatic recommendation: implement command/callback duration first, with an explicit label such as `Key ms` or `Input ms`. Keep the internal sample shape flexible enough to switch to post-commit timing later.

## Suggested Implementation

Add a local monitor state in `EditorApp`, not in persisted `history`.

Example shape:

```ts
type KeyPerfSample = {
    id: number;
    editorId: EditorId;
    label: string;
    ms: number;
};
```

Keep the last N samples, probably 48-80 bars. Since this is a transient UI diagnostic, it should not be exported with history or replayed.

Add an `onKeyPerfSample(sample)` callback path:

- `EditorApp` owns `keyPerfSamples`.
- `EditorApp` renders a fixed-position `<KeyPerfMonitor samples={keyPerfSamples} />`.
- `BlockEditor` receives `onKeyPerfSample`.
- Input handlers measure work and report a sample.

For handled `onKeyDown` commands, a small helper can wrap the body:

```ts
const started = performance.now();
try {
    // existing keydown handling
} finally {
    onKeyPerfSample({label: formatKeyLabel(event), ms: performance.now() - started});
}
```

For printable input, the best hook is inside the native `beforeinput` listener in `RichTextEditableSurface`, around `onInsertText`, `onDeleteBackward`, and `onDeleteForward`. This requires passing a timing callback into `RichTextEditableSurface`, because normal text insertion bypasses React `onKeyDown` command handling.

Avoid sampling irrelevant keys where no editor work happened. A practical rule:

- Sample `beforeinput` insert/delete events that call editor commands.
- Sample `keydown` only when the handler prevented default or invoked an editor command.
- Do not sample hover, mouse selection, popover escape close, copy, or paste unless later requested.

## UI Notes

Place the monitor fixed in the top-right corner, above the app shell:

- `position: fixed`
- `top: 12px`
- `right: 12px`
- fixed width around `160px`
- fixed height around `64px`
- dark translucent background or white panel with subtle border
- `pointer-events: none`
- high `z-index`

Bars can use CSS custom properties:

```tsx
<span className="keyPerfBar" style={{'--ms': `${sample.ms}`} as CSSProperties} />
```

Then clamp visual height in React or CSS. A readable mapping:

- 0-16ms: short to medium bars
- 16-50ms: visibly tall bars
- 50ms+: capped at full height

Color thresholds can make spikes obvious:

- under 8ms: green
- 8-16ms: amber
- over 16ms: red

The monitor should show a compact latest value, for example `7.4 ms`, and maybe the most recent key label. Avoid making this a new card-heavy section; it should read as instrumentation.

## Test Strategy

Add focused tests in `App.test.tsx`:

- Typing printable text through the existing `typeText` helper creates bars in the monitor.
- Firing Backspace creates a sample.
- The monitor caps the number of rendered bars.
- The monitor is present but does not add actions to history.

Because `performance.now()` is environment-dependent, tests should assert presence and shape rather than exact elapsed values. If needed, spy on `performance.now()` to make threshold classes deterministic.

Existing `typingPerf.test.ts` probably does not need changes unless the implementation extracts pure helpers for sample truncation or scale calculation.

## Risks

- Measuring in `onKeyDown` alone will miss ordinary text input because text insertion is handled in `beforeinput`.
- Measuring only synchronous handler time may under-report slow React commits or DOM selection restoration.
- Updating React state for every keypress adds overhead. Keep the state small, use bounded arrays, and avoid expensive derived calculations in render.
- The existing `history.keystrokes` export format should not be expanded casually; perf samples are transient and machine-specific.
- If the monitor samples all keydowns, it may show timings for keys that did not perform editor work, making the chart noisy.

## Open Questions

- Should "keypress took" mean synchronous input command time, or time until the updated editor is committed/restored/painted?
    - sync is ok for now
- Should the monitor include normal printable text inserted through `beforeinput`, or only keys currently recorded by the keystroke log?
    - everything
- Should paste be included? It is not a keypress, but it is often the worst interactive input path.
    - yes
- Should samples be combined across both editors or separated by editor A/B color?
    - combined
- Should the monitor always be visible in the example, or hidden behind a query param/toggle?
    - always visible for now
- Should repeat keydown events be sampled individually, aggregated, or ignored?
    - individually
