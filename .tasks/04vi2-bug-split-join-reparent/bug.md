# Bug: `EditorHarness.split` Can Fail After Join/Reparent Test Sequences

## Summary

While adding generated block reparent tests, I initially mixed the new reparent commands into the existing generated editing-script property test in `src/block-crdt/index.test.ts`.

That uncovered a preexisting test-harness edge case: after certain split/join/insert/reparent sequences, `EditorHarness.split(...)` can call the lower-level `split(...)` helper with a location whose `char` is not usable for the current block's internal traversal. The failure is a runtime `TypeError` inside `src/block-crdt/index.ts`, not a traversal cycle.

This is not currently proven to be a product bug. It may be a limitation of the test harness's offset-to-split-location logic after joined blocks. I kept the final reparent property test separate from the older text/split/join property so this edge case does not obscure the block-cycle task.

## Minimized Counterexample

Fast-check shrank the failing generated script to:

```ts
[
    {type: 'split', actor: 'alice', block: 0, offset: 0},
    {type: 'join', actor: 'alice', block: 0},
    {type: 'insert', actor: 'alice', block: 0, offset: 0, text: 'a'},
    {type: 'insert', actor: 'alice', block: 0, offset: 0, text: 'a'},
    {type: 'split', actor: 'alice', block: 0, offset: 1},
    {type: 'moveToRoot', actor: 'alice', block: 0},
]
```

The property failure was reported as:

```text
Error: Property failed after 4 tests
{ seed: 51, path: "3:3:1:3:3:6:6:9:9:9:9:12:12:15:16:16:11:11:11", endOnFailure: true }
Counterexample: [[{"type":"split","actor":"alice","block":0,"offset":0},{"type":"join","actor":"alice","block":0},{"type":"insert","actor":"alice","block":0,"offset":0,"text":"a"},{"type":"insert","actor":"alice","block":0,"offset":0,"text":"a"},{"type":"split","actor":"alice","block":0,"offset":1},{"type":"moveToRoot","actor":"alice","block":0}]]
```

The thrown error was:

```text
TypeError: Cannot read properties of undefined (reading 'id')
```

The stack pointed at:

```text
src/block-crdt/index.ts:1054:31
EditorHarness.split src/block-crdt/index.test.ts:228:27
```

## Failure Site

In `src/block-crdt/index.ts`, the lower-level `split(...)` implementation eventually does:

```ts
const pid = lamportToString(chars[cid].parent.id);
const children = cache.charContents[pid];
for (let at = children.indexOf(cid) + 1; at < children.length; at++) {
    const id = children[at];
    ops.push({
        type: 'char:move',
        id: chars[id].id,
        parent: {
            ts: [lastMoveTs(chars[id].parent.ts), ancestryPath, ts],
            id: tail,
        },
    });
    tail = chars[findTail(id, cache.charContents)].id;
}
```

The `TypeError` means `chars[id]` was `undefined` for one of the ids in `children`.

Given the sequence includes an early split at offset `0` followed by a join, the likely suspect is that `children` can include a join sentinel id. Join sentinels are represented in cache traversal via `cache.joinSentinels`, but they are not stored in `state.chars`.

Relevant implementation detail:

- `organizeState(...)` inserts joined block ids into `charContents` as sentinel children:

```ts
charContents[tailId] = insertSortedRev(charContents[tailId]?.slice() ?? [], rightId);
```

- `orderedCharIdsForBlock(...)` handles this by using `charRecord(state, id)`, which can synthesize a char-like record from `cache.joinSentinels`.
- The `split(...)` reparent loop shown above directly indexes `chars[id]`, so a join sentinel id in `cache.charContents` can become `undefined`.

This points to a real implementation hazard if user-level split can reach this state through normal commands.

## Why It Appeared During This Task

The original property test generated text editing commands:

- insert,
- split,
- join,
- delete.

I initially extended that same property with block reparent commands:

- indent,
- unindent,
- moveToRoot.

The minimized counterexample includes `moveToRoot`, but the thrown stack is in split processing, and the sequence already has a split/join/split pattern before reparenting. The reparent command may simply have helped fast-check reach/shrink the failing shape; it does not appear to be a block parent-cycle failure.

To keep the current task scoped correctly, the final implementation uses:

- the original text-editing property for text/split/join/delete,
- a separate block-reparent property seeded with multiple blocks and limited to indent/unindent/moveToRoot.

## Reproduction Direction

A focused regression test should start from the minimized counterexample and reduce it further manually.

Suggested test shape:

```ts
it('splits safely after joining a start-split block with later inserts', () => {
    const editor = new EditorHarness();

    editor.split('alice', 0, 0, {random: () => 0});
    editor.join('alice', 0, 1);
    editor.insert('alice', 0, 0, 'a');
    editor.insert('alice', 0, 0, 'a');

    expect(() => editor.split('alice', 0, 1, {random: () => 0})).not.toThrow();
});
```

If this reproduces without `moveToRoot`, the bug is isolated to split/join/sentinel handling. If it does not, add the `moveToRoot` step back in and inspect how block traversal changes the selected block for the second split.

## Suspected Fix Area

Potential fixes to investigate:

1. Update `split(...)` to treat join sentinels the same way traversal does, using a helper like `charRecord(...)` instead of direct `chars[id]` access where ids can come from `cache.charContents`.

2. Filter or handle join sentinel ids in the sibling-reparenting loop:

```ts
const char = chars[id];
if (!char) {
    // If this is a join sentinel, handle it explicitly or skip if correct.
}
```

3. Add a focused invariant around `cache.charContents`: if it may contain ids not present in `state.chars`, every traversal/move algorithm reading it must either use `charRecord(...)` or explicitly account for sentinel ids.

The first option is likely cleaner, but it needs careful review because `split(...)` emits `char:move` operations and join sentinels are not real chars.

## Impact

Known impact:

- Test harness generated scripts can produce a runtime error.
- The failure is reachable through command-shaped split/join/insert operations in the test harness.

Unknown impact:

- Whether the block-rich-text UI can trigger the same sequence through normal editing.
- Whether the correct behavior is to split across/around the join sentinel, ignore it during split sibling reparenting, or disallow this exact split location.

## Relationship To Block Parent Cycle Tests

This bug is separate from block parent-cycle prevention.

The new cycle tests did not find a traversal-visible cycle from current editor-command-shaped block reparent operations. This bug was encountered only while broadening a generated text editing property and is best handled as a follow-up split/join sentinel correctness task.
