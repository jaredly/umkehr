Rich Causal Blocks: a CRDT for block-based text editing

Notion-like blocks are all the rage in document editors.
I like them too.
but I also want local-first/collaborative editing goodness.

Introducing, the first (to my knowledge) CRDT for text editing that allows for multiple "blocks" of text, that can be split, moved, and joined together, all while preserving concurrent edits.

This improves dramatically on the state of the art. Some algorithms allow the designation of blocks via in-text markers (i.e. automerge), but none to my knowledge allow reordering of those blocks without resorting to destructive cut & paste.

How does it work? We start with an RGA/Causal-Tree data structure where each character has a lamport ID and a reference to a parent character. Concurrent edits are prevented from interleaving by virtue of the parent references establishing a causal ordering between characters.

```text
Every inserted character has a stable Lamport ID and a parent pointer.
Children of the same parent are sorted by ID, so concurrent inserts do not
interleave unpredictably.

block B
  |
  v
 [t 1:A]
    |
    v
 [h 2:A]
    |
    v
 [e 3:A]
    |
    v
 [_ 4:A]
    |\
    | \  concurrent insert after "the "
    |  \
    v   v
 [d 5:A] [r 5:B]
    |       |
    v       v
 [o 6:A] [e 6:B]
    |       |
    v       v
 [g 7:A] [d 7:B]
            |
            v
           [_ 8:B]

logical text: the red dog

At the branch under [_ 4:A], [r 5:B] sorts before [d 5:A], so the
concurrent insertion "red " appears before "dog".

node label: [visible text, Lamport ID]
_: a space character
arrow: parent pointer
```

The change is that we allow the parent reference to be updated, so that text can be moved around, using a 'last write wins' policy for the parent reference.

```text
Because parent pointers are versioned, moving text is a CRDT update:
we change the parent of the first moved character.

before

block B1
  |
 [t] -> [h] -> [e] -> [_] -> [d] -> [o] -> [g]

split before d

block B1                       block B2
  |                              |
 [t] -> [h] -> [e] -> [_]       [d] -> [o] -> [g]
                                 ^
                                 |
                                 d.parent := B2

The character IDs stay the same. Only the parent reference changes.
```

A naive approach, updating the parent of the char where you want to split, would work in the trivial case where text was all inserted in sequence, but breaks when the character sequence is actually a tree, due to insertions happening either concurrently or out of order.

```text
Naive split: only reparent the character at the split point.

before

block B1
  |
 [t]
  |
 [h]
  |
 [e]
  |
 [_]
  |\
  | \
 [r] [d]
  |   |
 [e] [o]
  |   |
 [d] [g]
  |
 [_]

user splits before r, intending:

  block B1: "the "
  block B2: "red dog"

naive result

block B1              block B2
  |                     |
 [t]                  [r]
  |                     |
 [h]                  [e]
  |                     |
 [e]                  [d]
  |                     |
 [_]                  [_]
  |
 [d]        <-- "dog" was after the split in the rendered text,
  |             but it stayed behind because it was a sibling of r.
 [o]
  |
 [g]

This violates the user's "everything after the cursor moves right" intent.
```

-> I think we actually want a video of 'typing into a text editor and then pressing enter'


In order to faithfully split a block of text following user intent, we must also re-parent sibling nodes that fall after the split point, so that they also move to the new block.

```text
Correct split: reparent the split point and following sibling subtrees.

before

block B1
  |
 [t]
  |
 [h]
  |
 [e]
  |
 [_]
  |\
  | \
 [r] [d]
  |   |
 [e] [o]
  |   |
 [d] [g]
  |
 [_]

split before r

block B1   block B2
  |          |
 [t]        [r] -> [e] -> [d] -> [_]
  |                               |
 [h]                              v
  |                              [d] -> [o] -> [g]
 [e]
  |
 [_]

also move following sibling subtree:

block B2
  |
 [r] -> [e] -> [d] -> [_] -> [d] -> [o] -> [g]

Intuition: at each ancestor on the path to the split point, all siblings to
the right of that path move into the new block.
```

This gets us a split behavior that follows user intent, but it still fails in the presence of concurrent splits, as "last write wins" fails when "incidental reparent" wins over a concurrent "intentional split".

```text
Concurrent splits expose a conflict between intentional and incidental moves.

initial tree

block B1
  |
 [t]
  |
 [h]
  |
 [e]
  |
 [_]
  |\
  | \
 [r] [d]
  |   |
 [e] [o]
  |   |
 [d] [g]
  |
 [_]

Replica A: split before r
  - intentionally moves r under new block B2
  - incidentally moves following sibling d/o/g after the moved tail

Replica B: split before d in "dog"
  - intentionally moves d/o/g under new block B3

If all parent moves are just last-write-wins:

              later timestamp wins
                    |
                    v
block B2: [r] -> [e] -> [d] -> [_] -> [d] -> [o] -> [g]

block B3: empty

The split before "dog" got eaten by the incidental move from A.
```

In order to solve this problem, we need a way to indicate that the "sibling reparenting" was incidental, and should be overridden by a split that happened further to the right, even if it happened earlier. To this end, the "timestamp" associated with an incidental reparenting becomes richer, and tracks the "ancestor path" of the split position that initiated the incidental reparenting.

```text
Fix: mark sibling reparenting as incidental and attach the split path.

intentional move

  r.parent := B2
  ts       := "split A"

incidental sibling move

  d.parent := tail(B2)   // the "d" in "dog"
  ts       := {
      kind: "incidental split move",
      previous: old d.parent ts,
      splitPath: [B1, _, r],
      splitTs: "split A"
  }

Now compare two parent versions:

  intentional split before d in "dog"
        beats
  incidental move caused by split before r

when d lies further right than r in the ancestor path.

Result after merge:

block B1    block B2                 block B3
  |           |                        |
 [t]        [r] -> [e] -> [d] -> [_]   |
  |                                    |
 [h]                                   v
  |                                   [d] -> [o] -> [g]
 [e]
  |
 [_]

The incidental move preserves user intent locally, but yields to a concurrent
intentional split at a more specific/rightward position.
```

Next up: making rich text work!

We lean on Peritext for the initial implementation, with the notion of an `addMark` and a `removeMark` op, both of which are anchored to a start and an end character ID.

```text
Formatting marks are anchored to character IDs, not offsets.

characters

block B1
  |
 [t 1:A] -> [h 2:A] -> [e 3:A] -> [_ 4:A]
                                      |\
                                      | \
                                      |  [r 5:B] -> [e 6:B] -> [d 7:B] -> [_ 8:B]
                                      |
                                      [d 5:A] -> [o 6:A] -> [g 7:A]

raw mark records

 add bold M1
   start: before [r 5:B]
   end:   after  [_ 8:B]

 remove bold M2
   start: before [e 6:B]
   end:   after  [d 7:B]

resolved rendering, by traversing the current character order:

 t  h  e  _  r  e  d  _  d  o  g
             ===========           M1 add bold over "red "
                ======             M2 remove bold over "ed"

 resolved spans:

 [plain: the ][bold: r][plain: ed][bold: _][plain: dog]

When a mark crosses a split, it records the crossed split IDs so traversal can
distinguish "follow the split" from "stop at the split boundary".
```

In order to avoid surprising users as much as possible, and to avoid "losing work", we need to deal with cycles. Specifically, it would be great to be able to guarantee that split/join and block reparenting operations that happen concurrently will never create cycles.

```text
Concurrent block moves can create a raw parent cycle.

raw block order paths say:

  A.parent = B
  B.parent = A

raw graph

   [A]
    ^ \
    |  \
    |   v
   [B]

materialization ignores one raw edge:

   root
    |
   [A]     ignored: B -> A
    |
   [B]

The ignored edge is deterministic, so every replica breaks the cycle the same
way. The visualization should show the ignored edge, but the article probably
does not need to explain the full tie-break rule here.
```


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
