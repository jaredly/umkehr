# Research: Rainbow Lamport IDs Debug Rendering

## Goal

Add a debug option to `examples/block-rich-text` that colors each visible character by the numeric component of its Lamport id:

```ts
background-color: hsl(${id % 36}, 100%, 50%)
```

This is meant to make identity continuity visible while testing edits, splits, joins, moves, undo/redo, sync, and imported histories.

## Relevant Current Code

- Main app: `examples/block-rich-text/src/App.tsx`
- Styling: `examples/block-rich-text/src/style.css`
- CRDT ids: `src/block-crdt/ids.ts`
- Character traversal: `src/block-crdt/traversal.ts`

`EditorApp` currently owns global UI state such as history, attachments, transient selections, and key performance samples. The floating perf monitor is rendered at the top of the app:

```tsx
<KeyPerfMonitor samples={keyPerfSamples} />
```

`KeyPerfMonitor` is fixed in the top-right corner and currently has `pointer-events: none`, so putting an interactive checkbox inside it requires changing that CSS. A good pattern is to keep the whole panel clickable with `pointer-events: auto`, or use `pointer-events: auto` only on a nested debug control.

The editor already computes visible character ids per block:

```ts
const charIdsByBlock = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const block of blocksWithAnnotationBodies) {
        result.set(block.id, orderedCharIdsForBlock(replica.state, block.id, {visibleOnly: true}));
    }
    return result;
}, [blocksWithAnnotationBodies, replica.state]);
```

Those ids are passed through `RenderBlockContext`, then into `EditableBlock`, then into `RichTextEditableSurface` as `charIdsByOffset`.

The editable DOM is rendered imperatively. `RichTextEditableSurface` serializes render inputs with `serializeRuns(...)` and replaces children with `renderRunNodes(...)` when that serialized value changes. `renderRunNodes(...)` creates render chunks via `runRenderChunks(...)`; `renderRunChunkNode(...)` creates the actual span or inline embed node; `applyRunClasses(...)` applies formatting, link, code, annotation, and popover metadata.

`orderedCharIdsForBlock(state, blockId, {visibleOnly: true})` returns string ids like `0007-left`. The CRDT helper `parseLamportString` converts that string to `[7, 'left']`. For this debug view, the numeric component is `parseLamportString(charId)[0]`.

## Recommended Implementation

Thread a boolean, probably named `rainbowLamportIds`, from `EditorApp` down through:

- `KeyPerfMonitor`
- both `BlockEditor` instances
- `RenderBlockContext`
- `EditableBlock`
- `RichTextEditableSurface`
- `serializeRuns(...)`
- `renderRunNodes(...)`
- `renderRunChunkNode(...)`

In `EditorApp`, add:

```ts
const [rainbowLamportIds, setRainbowLamportIds] = useState(false);
```

Then render a checkbox inside or directly below `KeyPerfMonitor`. Because `KeyPerfMonitor` is a small fixed debug panel, the checkbox belongs there rather than in each editor.

The lowest-risk rendering behavior is to split render chunks at every character boundary when rainbow mode is on. Today `runRenderChunks(...)` only splits on formatting/run boundaries, inline embeds, selection decorations, syntax tokens, and ingredient tokens. A chunk can span multiple character ids, so applying one background to the whole chunk would be incorrect. In rainbow mode, add every offset from `1` to `runSegments.length - 1` to the run-local `boundaries` set.

Then, when rendering a non-embed chunk, derive its character id from `options.charIdsByOffset?.[chunk.blockStartOffset]`. Because rainbow mode forces one-character chunks, that id maps to the exact rendered character. Apply the background as an inline style:

```ts
const counter = parseLamportString(charId)[0];
span.style.backgroundColor = `hsl(${counter % 36}, 100%, 50%)`;
```

This should also be included in the serialized render key. Otherwise toggling the checkbox may not replace the existing DOM because `serializeRuns(...)` will still see the same runs, char ids, and decorations. Include `rainbowLamportIds` in the JSON returned by `serializeRuns(...)`, and pass it at every call site.

Annotation body editors use their own `RichTextEditableSurface` call and compute `charIdsByOffset` locally. If the mode is intended to apply everywhere visible in the app, pass the flag into annotation body rendering too. If the goal is only the main side-by-side editor content, leave annotation bodies unchanged and document that as an intentional scope.

## Styling Notes

The task asks for `background-color: HSL(${id % 36},100%,50%)`. CSS color functions are case-insensitive, but the existing code style usually uses lowercase CSS strings; `hsl(...)` is fine unless exact string matching is desired.

The color formula uses hue degrees `0..35`, so the palette is a narrow red-to-yellow segment rather than a full hue wheel. That matches the task text exactly. If a true rainbow is desired, use `(id % 36) * 10`, but that would be a behavior change from the requested formula.

Because `hsl(..., 100%, 50%)` is visually strong, it may reduce readability for code syntax highlighting, links, comments, selections, and retained selection highlights. Inline `backgroundColor` is acceptable for a debug mode, but existing selection highlight classes may visually compete with it.

## Tests / Verification

Focused automated coverage can live in `examples/block-rich-text/src/App.test.tsx` if existing app-level DOM render tests are suitable. Useful checks:

- The checkbox appears in the perf/debug panel.
- With the checkbox off, editable text spans do not receive rainbow background styles.
- With the checkbox on, characters are rendered with backgrounds derived from their visible char ids.
- A block containing a formatted run with multiple characters produces per-character colors, not one color per run.

Manual verification should include:

- Type text in one editor, sync/offline-edit/sync, and confirm moved or retained chars keep their colors.
- Split and join blocks and confirm characters that move preserve colors.
- Delete and undo/redo to confirm restored/replacement chars show identity differences.
- Check code blocks, inline links/code, annotation/popover text, inline embeds, and retained selection highlights for acceptable interaction with the debug backgrounds.

## Open Questions

- Should the mode color all editable surfaces, including annotation body editors and preview subtitle/image caption editors, or only the main document blocks?
    - yes everywhere
- Should inline embed sentinel characters be colored? They have a backing char id, but the DOM node is not a normal text span.
    - sure
- Should the formula be implemented exactly as `id % 36` degrees, or should it be spread across the hue wheel with `(id % 36) * 10`? The task text says the former.
    - oh yeah spread across the wheel. honestly (id % 72) * 5 is maybe better
- Should rainbow mode persist across reloads via `localStorage`, or reset to off on each app load?
    - reset to off
- Should the checkbox live inside the existing perf monitor despite changing `pointer-events`, or should there be a small separate debug panel directly below it?
    - yeah change pointer-events
