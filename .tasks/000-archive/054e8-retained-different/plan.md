# Plan: Boundary-Based Retained Inline Formatting

## Objective

Replace the current per-character retained formatting behavior in `examples/block-rich-text` with boundary-based retained mark ops.

When a collapsed caret has bold/italic/strikethrough active, typing should create one open mark per active mark type and selected caret, not one mark per inserted character. Stopping the mark should close that open interval by emitting a later remove mark over the open interval and a bounded add mark ending `after` the final typed character.

Product decisions from research:

- An empty mark end means "to the end of the block".
- Existing text after the caret must not become formatted while the retained mark is active.
- Stopping retained formatting emits two mark ops after typing: remove the open mark interval, then add a bounded mark through the final typed character.
- Multiple simultaneous carets should be supported.
- Selection movement should not close or clear an already-open retained mark.
- Delete/backspace and remote concurrent inserts should not get special behavior.
- Apply the redesign to `bold`, `italic`, and `strikethrough`.

## Phase 1: Extend Core Mark Boundaries

Files:

- `src/block-crdt/types.ts`
- `src/block-crdt/marks.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/formatting.test.ts`

Work:

1. Update the mark model to support an omitted/empty end boundary.
   - Likely shape: `end?: Boundary`.
   - Semantics: omitted `end` covers through the end of the start block, not through the whole document.
   - Keep existing serialized mark ops compatible by preserving required `end` on existing range-created marks.

2. Update `coveredCharIdsForMark(...)` to handle omitted `end`.
   - Determine the block containing `mark.start.id`.
   - Traverse only within that block when `end` is omitted.
   - Stop at block end even if the flattened document sequence continues into later blocks.
   - Preserve existing split/join behavior inside that block as much as possible.

3. Add a boundary-level mark helper.
   - Existing `markOp(...)` can stay as the range-oriented convenience wrapper.
   - Add a helper that accepts explicit `start`, optional `end`, mark type/data/remove, and id.
   - Ensure it computes or accepts `crossedSplits` consistently.

4. Add offset-to-boundary helpers needed by the editor.
   - For a collapsed caret before existing text, the open end should be `{id: nextChar, at: 'before'}`.
   - For end-of-block or empty block, the open end should be omitted.
   - For a final typed char, the bounded end should be `{id: finalChar, at: 'after'}`.

Tests:

- Existing mark range tests still pass.
- A mark ending `before next` excludes `next`.
- A mark ending `before next` includes later inserted children before `next`.
- A mark with omitted `end` covers inserted chars through the end of that block only.
- Omitted `end` does not spill into the next block.
- Remove-plus-bounded-add closes an open mark so future chars in the old open interval are not formatted.

## Phase 2: Add Retained Formatting Command Primitives

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/localTextOps.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`

Work:

1. Add command-level types for retained inline mark sessions.
   - Track mark type, open mark start, open mark end, open mark id, and final typed char id.
   - Store enough data to close the same open interval later.

2. Add an insertion command that can create or extend retained mark sessions.
   - It should insert text normally.
   - If a caret has active retained mark intents but no open mark yet, create one open add mark per active mark type:
     - Start: `before` the first inserted char.
     - End: `before` the original next char, or omitted for block end.
   - If a mark session is already open, insert text without adding another mark op.
   - Update the session's final typed char id to the last inserted char in the command.

3. Add a close command for retained mark sessions.
   - If no chars were typed for a pending mark, emit no ops and drop the session.
   - If chars were typed:
     - Emit a remove mark over the original open interval.
     - Emit a bounded add mark from the original start to `after` the final typed char.
   - Make id ordering explicit: remove first, bounded add second, so the bounded add wins for the intended typed range.

4. Preserve existing range mark behavior.
   - Non-collapsed selections should continue to use the existing range toggle path.
   - Link and annotation marks should not be routed through retained-formatting behavior.

Tests:

- Collapsed caret in the middle of text: `a|b`, turn on bold, type `XY`, stop bold -> `a` plain, `XY` bold, `b` plain.
- The same flow emits one open add mark during typing, then one remove and one bounded add when stopping.
- Collapsed caret at end of block works with omitted end.
- Empty block works with omitted end.
- Multiple inserted characters in one command update the final char boundary correctly.
- Toggling off before typing emits no mark ops.
- Existing `insertTextWithMarks` expectations are either replaced or updated to the new retained command behavior.

## Phase 3: Support Multi-Caret Retained Marks

Files:

- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`

Work:

1. Represent retained mark sessions per selection entry.
   - The key should be stable enough to survive retained selection resolution.
   - Existing selection entries have ids; use those ids rather than deriving identity from block/offset.

2. Update multi-selection insertion.
   - For each caret, create or extend that caret's retained mark sessions.
   - Maintain the existing reverse-sorted insertion behavior so offsets remain correct.
   - Return updated retained selections and updated retained mark session state.

3. Update multi-selection close.
   - Closing bold/italic/strikethrough should close all open sessions for that mark type across selected carets.
   - If multiple caret sessions exist, emit remove-plus-bounded-add for each one that typed text.

Tests:

- Two carets in one block with bold active type `X`; both insertions are bold.
- Continuing to type at both carets does not emit extra mark ops per character.
- Stopping bold closes both open sessions.
- Multiple carets in different blocks support omitted-end behavior independently.

## Phase 4: Wire Editor State And UI Behavior

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/App.test.tsx`

Work:

1. Replace boolean `PendingInlineMarks` with retained mark session state.
   - It should support three states per mark type and selection entry:
     - Intent active, no char typed yet.
     - Open mark created, tracking final typed char.
     - Closed/absent.

2. Update `runInlineMarkToggle`.
   - For non-collapsed selections, keep existing range toggle behavior.
   - For collapsed selections:
     - If the mark type is inactive, activate retained intent for every caret.
     - If the mark type is active/open, close the retained sessions for that mark type and emit close ops.

3. Update text insertion.
   - Route text insertion through the retained-formatting-aware multi-selection command.
   - If no retained marks are active, use the normal insertion path.
   - Keep markdown shortcuts and other insertion behavior compatible if they are already layered on insertion.

4. Keep toolbar active state correct.
   - Active should include retained mark intent/open state.
   - Active should still include marks derived from selected text or caret context.

5. Do not clear retained mark sessions on selection movement.
   - This follows the answered product decision.
   - Reset/editor teardown can still clear local-only session state.

Tests:

- Keyboard `Cmd+B`, type several characters, `Cmd+B` closes and renders one bold run.
- Toolbar button follows the same retained behavior.
- `italic` and `strikethrough` follow the same retained behavior.
- Moving the selection does not implicitly close an open retained mark.
- Range formatting still toggles selected text and does not create retained sessions.

## Phase 5: Verification And Cleanup

Work:

1. Audit exported APIs.
   - Export only helpers that are useful outside the implementation.
   - Keep old helper names where compatibility matters, especially `markRangeOp`.

2. Check performance and op counts.
   - Add targeted assertions that typing N characters with one retained mark emits one open mark, not N marks.
   - Confirm close emits exactly two mark ops per active typed retained session.

3. Run focused tests:

```sh
npm exec vitest -- run src/block-crdt/formatting.test.ts
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

4. Run broader smoke if the focused tests expose shared behavior changes:

```sh
npm exec vitest -- run src/block-crdt examples/block-rich-text/src
```

## Implementation Notes

- Treat omitted end as a real CRDT semantic, not an editor-only hack. Materialization, visible ranges, and helper APIs should agree on it.
- Closing must not mutate the original open mark. Mark ids are immutable, and `applyMark` correctly rejects conflicting duplicate ids.
- Use Lamport id ordering deliberately. For close ops, the bounded add must have a higher id than the remove if their ranges overlap.
- Existing text after the caret stays unformatted by using `end: before originalNextChar` when there is an original next char.
- End-of-block and empty-block typing use omitted end, which means future children in that block remain in the open interval until close.
