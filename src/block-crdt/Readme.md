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
