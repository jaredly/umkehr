# Rich Causal Blocks

`umkehr/block-crdt` is an operation-based CRDT for block-structured rich text. It models text as stable character ids inside stable block ids, supports non-destructive split/join/move operations, and exposes plain `Op[]` records for storage and replication.

The package is intended for editor/runtime authors. Application code should usually create ops with the public change helpers and reserve raw op construction for tests, migrations, and advanced integrations.

## Importing

```ts
import {
    applyMany,
    applyRemote,
    cachedState,
    insertTextOps,
    materializeFormattedBlocks,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
```

Support modules are also exported, for example `umkehr/block-crdt/types` and `umkehr/block-crdt/lseq`.

## Quick Start

```ts
import {
    applyMany,
    cachedState,
    insertTextOps,
    materializeFormattedBlocks,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';

const ts = (() => {
    let next = 1;
    return () => String(next++).padStart(5, '0');
})();

let state = cachedState(initialState('alice', ts()));
const block = [0, 'alice'] as const;

const ops = insertTextOps(state, {
    actor: 'alice',
    block,
    offset: 0,
    text: 'Hello',
    ts,
});

state = applyMany(state, ops);
const visible = materializeFormattedBlocks(state);
```

Persist and replicate the `ops` array. Rebuild the cached wrapper with `cachedState(rawState)` after loading a persisted raw `State`.

## Data Model

`State<M>` stores five durable record maps:

- `chars`: character records keyed by Lamport id strings.
- `blocks`: block records keyed by Lamport id strings.
- `marks`: formatting marks keyed by mark Lamport id strings.
- `splits`: split records that preserve split boundaries for formatting and undo planning.
- `joins`: join records that hide right blocks without deleting their contents.

`CachedState<M>` wraps `State<M>` with derived traversal indexes. The cache is not the persistence format.

Characters and blocks use stable Lamport ids: `[counter, actor]`. Actor ids must not contain `-`, because string encodings use that separator. Lamport string encodings are map keys only; use `compareLamports` or `compareLamportStrings` for semantic ordering.

Characters form parent-linked trees rooted at block ids. Blocks carry:

- `id`: stable Lamport id.
- `meta`: app-defined metadata with at least a lexicographically sortable `ts`.
- `order`: LSEQ sibling position plus a materialized block path.
- `deleted`: tombstone flag.

Deletes are tombstones. Deleted chars and blocks remain in state so concurrent and out-of-order ops can still resolve against stable ids.

## Operation Format

`Op<M>` is the wire/storage format:

- `char`
- `char:move`
- `char:delete`
- `block`
- `block:move`
- `block:delete`
- `block:meta`
- `mark`
- `split-record`
- `join-record`

The operation shape is public, but normal editor integrations should prefer the change helpers below. Raw ops have non-obvious dependency and versioning invariants.

## Change Helpers

The public helpers return related `Op[]` batches. They do not introduce a transaction object and they do not hide the op log.

```ts
insertTextOps(state, {actor, block, offset, text, ts});
deleteRangeOps(state, {block, startOffset, endOffset});
splitBlockOps(state, {actor, block, offset, ts, options});
joinBlocksOps(state, {actor, left, right, ts});
moveBlockOps(state, {actor, block, parent, before, after, ts, options});
setBlockMetaOps(state, {block, meta});
markRangeOp(state, block, startOffset, endOffset, type, data, remove, id);
```

Offsets are visible text offsets inside a visible block. Text insertion uses `Intl.Segmenter`, so ids are allocated per grapheme cluster rather than per UTF-16 code unit.

`moveBlockOps` takes a visible logical parent. Hidden deleted/joined parents are not public move targets. If a hidden block has visible descendants, those descendants are treated as logical children of the nearest visible ancestor for `visibleBlockChildren`, `visibleBlockOutline`, and move placement.

## Applying Ops

Use strict helpers for local batches that were just produced by this package:

```ts
state = applyMany(state, ops);
state = applyManyStrict(state, ops);
state = applyStrict(state, op);
```

Use remote helpers for arbitrary network or storage delivery order:

```ts
const result = applyRemote(state, op);
const batchResult = applyRemoteMany(state, ops);
```

`applyRemote` returns:

- `applied`: the op changed state.
- `ignored`: the op was duplicate or stale under CRDT conflict rules.
- `pending`: the op is structurally valid but references missing dependencies.
- `invalid`: the op is malformed or conflicts with an existing id payload.

Retry pending ops after their missing Lamport ids arrive. Missing parents for `char` and `char:move`, missing block path ancestors, missing mark anchors, missing split anchors, and missing join anchors are pending rather than silently accepted.

`validateOp(op)` checks op shape and Lamport encoding. It does not prove dependency readiness; use `applyRemote` for that.

## Split And Join Semantics

A split creates a new block and moves the right-side character subtree into it. When a split crosses a character tree rather than a simple list, incidental `char:move` ops move sibling subtrees that visually fall after the split point.

Intentional moves and incidental split moves use named version comparators:

- `compareCharParentVersions`
- `charParentVersionWins`
- `compareBlockOrderVersions`
- `blockOrderVersionWins`

These comparators preserve user intent when concurrent splits or moves overlap.

A join records that the right block is semantically hidden and that its characters materialize after the left block tail. Joined blocks remain in state; visible traversal, plain-text materialization, and formatted materialization omit them as blocks. Visible descendants of hidden blocks are spliced into the nearest visible parent's child list and sorted with that logical sibling list.

## Formatting

Formatting is in the core package because mark coverage depends on split and join records.

Marks anchor to character ids and can store crossed split ids. A mark created across an existing split records that split so materialization can follow the user's selected text range later. Subsequent splits and joins are handled by mark traversal.

Use `materializeFormattedBlocks(state)` to render visible formatted output:

```ts
const blocks = materializeFormattedBlocks(state);
for (const block of blocks) {
    for (const run of block.runs) {
        console.log(run.text, run.marks);
    }
}
```

Joined blocks are hidden as blocks, but their visible characters still contribute to the joined text stream.

## Metadata

Block metadata is generic. The core only requires a `ts` field:

```ts
type CustomMeta = {ts: string; kind: 'task'; priority: number};
```

`State<M>`, `CachedState<M>`, `Block<M>`, and `Op<M>` carry the metadata type. `block:meta` conflict resolution compares `meta.ts`.

The default metadata union supports the demo editor:

- paragraph
- blockquote
- bullets
- checkboxes

The CRDT algorithms do not depend on those variants.

## Undo Planning

`planUndoOps(before, current, batch, {actor, ts})` creates normal CRDT ops that undo a previously applied user-level batch when the inverse can be represented without mutating history.

Supported inverses:

- inserted chars become `char:delete` ops,
- block moves become newer `block:move` ops to the previous order/path,
- block metadata changes become newer `block:meta` ops with previous metadata,
- additive marks become newer remove marks over the same anchors.

The planner returns `{complete, ops, unsupported}`. Apply `ops` automatically only when `complete` is true.

Unsupported cases include char/block deletion, removed-mark undo without previous winning mark data, split records, and join records. Those require either future resurrection/unjoin operations or higher-level editor-specific inverse planning.

## Performance Expectations

The current target is thousands of blocks and one or two orders of magnitude more characters.

Expected costs:

- applying char insert/delete/move updates char traversal cache incrementally,
- block moves, block inserts, and joins rebuild block/cache structure,
- visible block traversal is proportional to visible blocks plus hidden descendants being spliced,
- formatted materialization scans visible character order and mark coverage.

For very large documents, cache rendered ranges at the application layer and avoid materializing the entire document on every keystroke.

## Migration Notes

This package is still before the first public `block-crdt` release, so the op wire shape can still change. If it changes after publication, migration should be handled at the stored `Op[]` or `State` boundary before calling `cachedState` or `applyRemote`.

Known pre-release changes already made:

- `block:status` was removed in favor of generic timestamped block metadata.
- missing dependencies are reported as `pending` by remote apply helpers.
- actor ids containing `-` are invalid.
- `block-crdt` package subpaths require built ESM `.js` specifiers.

## Release Checklist

Before publishing a release that includes `umkehr/block-crdt`:

- run `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src`,
- run `npm run typecheck`,
- run `npm run build`,
- run `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`,
- run `npm run pack:check`,
- verify package self-imports after build:
  - `node -e "import('umkehr/block-crdt')"`,
  - `node -e "import('umkehr/block-crdt/initialState')"`,
- review op wire-shape changes and update migration notes before publishing.
