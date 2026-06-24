# Plan: Rainbow Lamport IDs Debug Rendering

## Phase 1: Add Debug State and UI

1. Add `rainbowLamportIds` state to `EditorApp`, defaulting to `false`.
2. Pass the state and setter into `KeyPerfMonitor`.
3. Add a checkbox control in the existing top-right perf panel:
   - Label: `Rainbow IDs` or `Rainbow Lamports`.
   - Checked state: `rainbowLamportIds`.
   - Change handler: `setRainbowLamportIds(event.currentTarget.checked)`.
4. Update `.keyPerfMonitor` CSS so the panel can receive pointer events.
   - Change or override `pointer-events: none`.
   - Keep the panel compact and avoid blocking more of the editor than it already does.
5. Do not persist the setting. It should reset to off on every app load.

## Phase 2: Thread the Flag Through Rendering

1. Pass `rainbowLamportIds` from `EditorApp` to both `BlockEditor` instances.
2. Add `rainbowLamportIds` to the `BlockEditor` props type.
3. Add it to `RenderBlockContext`.
4. Pass it through `renderBlockNode(...)`, `renderEditableBlock(...)`, and `EditableBlock`.
5. Pass it into every `RichTextEditableSurface`:
   - Main document blocks.
   - Table titles, row headers, and table cells via existing `renderEditableBlock(...)` paths.
   - Annotation body editors.
   - Preview subtitle and image caption surfaces, since the decision is to color everywhere.
6. Add `rainbowLamportIds` to `RichTextEditableSurface` props and all internal render calls.

## Phase 3: Render Per-Character Backgrounds

1. Add `rainbowLamportIds` to `serializeRuns(...)`.
   - Include it in the JSON render key so toggling the checkbox forces DOM replacement.
2. Add `rainbowLamportIds` to `renderRunNodes(...)` options.
3. Add `rainbowLamportIds` to `runRenderChunks(...)`.
4. When `rainbowLamportIds` is enabled, split each run at every character boundary.
   - For each run, add boundaries from `1` through `runSegments.length - 1`.
   - Keep all existing split points for selections, embeds, syntax tokens, and ingredient tokens.
5. In `renderRunChunkNode(...)`, derive the chunk's character id from:

```ts
options.charIdsByOffset?.[chunk.blockStartOffset]
```

6. Convert the id with `parseLamportString(charId)[0]`.
7. Apply the debug color using the answered formula:

```ts
span.style.backgroundColor = `hsl(${(counter % 72) * 5}, 100%, 50%)`;
```

8. If the id is missing or invalid, leave the node uncolored rather than throwing during rendering.

## Phase 4: Color Inline Embeds

1. Inline embeds currently return a custom element from `renderInlineEmbed(...)` instead of a normal text span.
2. When `rainbowLamportIds` is enabled and the chunk is the inline embed sentinel:
   - Use the same `charIdsByOffset?.[chunk.blockStartOffset]` lookup.
   - Apply the same background color to the returned embed element.
3. Confirm the existing inline embed data attributes and click handling still work.

## Phase 5: Styling Polish

1. Add small CSS for the checkbox row inside the perf panel.
2. Keep the control readable against the existing dark translucent panel.
3. Make the checkbox hit target practical without making the panel feel like a separate settings card.
4. Avoid adding persistent UI text beyond the control label.

## Phase 6: Automated Tests

1. Add focused tests in `examples/block-rich-text/src/App.test.tsx` if the current test harness can exercise the rendered editor DOM.
2. Cover:
   - The debug checkbox renders and defaults unchecked.
   - Existing text has no rainbow background while unchecked.
   - Toggling on applies `hsl(${(counter % 72) * 5}, 100%, 50%)` to visible characters.
   - A multi-character formatted run is split and colored per character, not per run.
   - An inline embed receives a rainbow background when enabled, if existing helpers make that practical.
3. If App-level tests are too brittle for embed coverage, keep embed verification manual and document the gap in the final notes.

## Phase 7: Manual Verification

1. Run the block-rich-text test suite.
2. Start the example app.
3. Verify the checkbox toggles colors on and off without reloading.
4. Type in both replicas and confirm new characters receive colors based on their Lamport counters.
5. Move blocks, split blocks, join blocks, undo, redo, and sync after offline edits.
6. Confirm moved characters keep their colors and newly-created characters get new colors.
7. Check these surfaces with the mode enabled:
   - Normal paragraphs.
   - Headings and list items.
   - Code blocks and inline code.
   - Links and annotations.
   - Annotation bodies.
   - Tables.
   - Image captions.
   - Preview subtitles.
   - Inline embeds.

## Implementation Notes

- Use the existing `parseLamportString` import already available in `App.tsx`.
- Keep this as a display-only debug feature. Do not change CRDT state, history serialization, clipboard data, or operation generation.
- The extra per-character DOM splitting only happens while debug mode is enabled, so normal rendering should keep its current chunking behavior.
- Retained selection decorations may compete visually with rainbow backgrounds. Treat that as acceptable for debug mode unless it makes selections unusable.
