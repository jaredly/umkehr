So we've got this plan for preventing block parenting cycles in [prevent-block-cycle](.tasks/04vi3-prevent-block-cycle/plan.md), but I don't love how it will require retaining an immutable log of all block moves ever performed, and I had an alternative idea I'd like you to explore.
What if, for `block:move` operations (and block.order.parent), we store the whole "target ancestry path" instead of just the immediate parent? For the base (local & synchronous remote edit) case, things would be trivially resolved. For the interleaved concurrent edit case, we might see "ancentry paths" that don't fully line up with local state, requiring a materialization-time reconciliation -- and at that point we could detect and resolve any potential cycles.

So if we had
- A
- B
- C
- D

And user 1 indents B under A, and user 2 indents C under B, then B would have ancestry path A/B, and C would have ancestry path B/C, and we would have the materialization step reconcile C's path to be A/B/C. So that's the normal case.
But in the case of a cycle, where user 1 undents B under A, and user 2 indents A under B, then A would have ancestry path B/A and B would have ancestry path A/B. We would detect first that reconciliation needed to happen (same as the previous case), but in this case there's a cycle. So we'd use some deterministic rule to decide which one wins (earlier lamport maybe, to match split resolution), and A would be materialized as having the root path A, whereas B gets to keep the path A/B.
