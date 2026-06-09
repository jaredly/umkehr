Split, Move, and Join: a CRDT for block-based text editing

Notion-like blocks are all the rage in document editors.
I like them too.
but I also want local-first/collaborative editing goodness.

Introducing, the first (to my knowledge) CRDT for text editing that allows for multiple "blocks" of text, that can be split, moved, and joined together, all while preserving concurrent edits.

This improves dramatically on the state of the art. Some algorithms allow the designation of blocks (automerge), but none to my knowledge allow reordering of those blocks without resorting to destructive cut & paste.

How does it work? We start with an RGA/Causal Tree data structure where each character has a lamport ID and a reference to a parent character. Concurrent edits are prevented from interleaving by virtue of the parent references establishing a causal ordering between characters.

[diagram of characters pointing to their parents, including concurrent edits]

The change is that we allow the parent reference to be updated, so that text can be moved around, using a 'last write wins' policy for the parent reference.

[diagram of a simple sequence of characters, then splitting at one character by re-parenting it to a new block]

A naive approach, updating the parent of the char where you want to split, would work in the trivial case where text was all inserted in sequence, but breaks when the character sequence is actually a tree, due to insertions happening either concurrently or out of order.

[diagram of a naive split that yields suprising behavior in the presence of sibling nodes]

-> I think we actually want a video of 'typing into a text editor and then pressing enter'


In order to faithfully split a block of text following user intent, we must also re-parent sibling nodes that fall after the split point, so that they also move to the new block.

[diagram of a split that correctly moves sibling nodes to the new block]

This gets us a split behavior that follows user intent, but it still fails in the presence of concurrent splits, as "last write wins" fails when "incidental reparent" wins over a concurrent "intentional split".

[diagram of two concurrent splits that happen to fall along sibling nodes. the later split gets eaten up by the former]

In order to solve this problem, we need a way to indicate that the "sibling reparenting" was incidental, and should be overridden by a split that happened further to the right, even if it happened earlier. To this end, the "timestamp" associated with an incidental reparenting becomes richer, and tracks the "ancestor path" of the split position that initiated the incidental reparenting.

[diagram of this thing making sense]

Next up: making rich text work!


.....


oof ok so something have made things more complicated:

- wanted to eliminate the possibilty of join-cycles. which I do think is worth it
- wanting unindent to do "incidental reparenting" of later sibling nodes so that we can follow user expectation, principle of least surprise
- also wanting to eliminate the possiblity of block nesting cycles. seems like it might require a similar bookkeeping setup, which tbh is a little annoying, but I kindof want this to be rock solid. also, most docs are going to have relatively little in the way of block reparenting.

# YEAS

# OK, fun features:

- multi-cursor, why notttt
- export/import
- unindent-reparenting

## Public Integration Contract

`umkehr/block-crdt` exposes plain operation records (`Op[]`) as the replication and persistence format, but editor integrations should normally create those records through the public change helpers:

- `insertTextOps(state, {actor, block, offset, text, ts})`
- `deleteRangeOps(state, {block, startOffset, endOffset})`
- `splitBlockOps(state, {actor, block, offset, ts, options})`
- `joinBlocksOps(state, {actor, left, right, ts})`
- `moveBlockOps(state, {actor, block, parent, before, after, ts, options})`
- `setBlockMetaOps(state, {block, meta})`
- `markRangeOp(state, block, startOffset, endOffset, type, data, remove, id)`

The helpers return related `Op[]` batches. They do not hide the operation log, and they do not introduce a separate transaction object. A sync layer can store and transmit the returned ops directly.

`moveBlockOps` takes a visible logical parent. If a deleted or joined block is hidden by materialization, its visible children are treated as children of the nearest visible ancestor for `visibleBlockChildren`, `visibleBlockOutline`, and move placement. Callers should not pass hidden blocks as move parents.

## State Model

Characters and blocks both have stable Lamport ids. Characters form parent-linked trees rooted at a block id. Blocks carry an LSEQ sibling order and a materialized path used for nesting. Deletes are tombstones: deleted characters and blocks remain in state so concurrent operations can still resolve against stable ids.

Splits and joins are non-destructive records. A split creates a new block and moves the right-side character subtree into it. A join records that the right block is semantically hidden and that its characters are materialized after the left block tail. Joined blocks remain in state, but visible traversal, plain text materialization, and formatted block materialization omit them as blocks. Visible descendants of hidden blocks are spliced into the nearest visible parent's child list and ordered with that logical sibling list.

## Applying Ops

Use strict helpers for local batches that were just produced by this package:

- `applyStrict(state, op)`
- `applyManyStrict(state, ops)`
- `apply(state, op)` and `applyMany(state, ops)` are currently kept for compatibility with the strict style.

Use remote helpers for arbitrary network/storage delivery order:

- `applyRemote(state, op)`
- `applyRemoteMany(state, ops)`

`applyRemote` returns one of:

- `applied`: the op changed state.
- `ignored`: the op was duplicate or stale under the CRDT's conflict rules.
- `pending`: the op is structurally valid but references dependencies that have not arrived yet.
- `invalid`: the op is malformed or conflicts with an existing id payload.

Pending ops should be retried after their missing Lamport ids arrive. Missing parents for `char` and `char:move`, missing block path ancestors, missing mark anchors, split anchors, and join anchors are treated as pending rather than silently accepted.

## Metadata

Block metadata is generic. The core only requires a lexicographically sortable `ts` field:

```ts
type CustomMeta = {ts: string; kind: 'task'; priority: number};
```

The default metadata union includes paragraph, blockquote, bullets, and checkboxes for the demo editor, but the CRDT algorithms do not depend on those variants. `block:meta` conflict resolution compares `meta.ts`.

## Formatting

Formatting marks live in the core package because mark coverage depends on split and join semantics. Marks anchor to character ids and can record crossed split ids so coverage follows the user's intended text range after later structural edits.

`materializeFormattedBlocks(state)` returns visible blocks with formatted text runs. Joined blocks are hidden as blocks, but their visible characters still contribute to the joined text stream. Mark materialization scans marks and character sequences, so expect work proportional to visible characters plus mark coverage. This is suitable for documents with thousands of blocks and substantially more characters; very large documents should cache materialized ranges at the application layer.

## Identity And Validation

Lamport string encodings are map keys, not semantic ordering. Use `compareLamports` or `compareLamportStrings` when ordering ids. Actor ids must not contain `-`, because that character separates Lamport counters from actor ids in the string encoding.

`validateOp(op)` checks operation shape and Lamport id encoding. It does not prove dependencies are present; dependency readiness is reported by `applyRemote`.
