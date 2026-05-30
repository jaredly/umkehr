It would be cool to support drag-to-reorder peritext blocks.
This is complicated in an architecture where blocks don't contain their contents directly, and instead have pointers into a single logical character stream.
Currently, blocks define a `start` anchor but no `end` anchor. This simpler representation reduces the number of edge cases we need to deal with.
However, if we are to support non-destructive (no delete/insert of text) block movement, a block will need to define its own `end` -- we can't just infer it from the "start of the next sibling", as the underlying text spans of sibling blocks might be far removed from each other.
This does introduce complexity that was previously avoided; now it's possible for there to be "orphaned text" that is claimed by no block, as well as "contested text" that is claimed by multiple blocks.
Proposed solution:
- orphaned text sticks to the "preceeding block" (the block whose `end` is where the orphan span begins)
- contested text is claimed by the block with the blockId that sorts lexically later (i.e. most likely more recent). The other block is clamped to avoid the contested text.
