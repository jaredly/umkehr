
# UNDO/REDO in a CRDT world

First, simple impl:

- instead of a tree, it's going to be a flat list of invertable Patches
- only include own changes, not remote changes

For changes A, B, C, D

Change List: A

# things I also want, which might impact the undo/redo implementation:

I want to be able to scrub back through history, with a scrubber UI. The ordering of changes would be based on the HLC ordering, *not* on the order in which items were received (b/c we could get older events from remotes). In order to enable this, I think we would need to hold on to the whole history (maybe with some snapshots at checkpoints).

I also want to be able to have the concept of "branches", although they wouldn't be tied to undo/redo in the crdt case, the way that they are in the non-crdt setup. I'm not sure the best way to represent this in a collaborative environment. Like, it would be nice to be able to have multiple parallel branches of work, exploring different possibilities, and also have collaborative editing work on each branch.
- have multiple parallel branches
- collaborative editing works on each branch
- you can merge branches together, 'importing' the changes from one branch onto another branch
  - would the merge be one-time?
    - that would be hard to mesh with the spirit of CRDTs, if there are events on branch A that you haven't received yet, but which are before some events you have seen
  - or would it be like "there's a piece of metadata on branch B that says 'all changes from branch A between ts x and ts y should also be applied to branch B'"
    - that could feel semantically weird, where you've merged in things you didn't know you were signing up for.
    - although here as well we could use the 'manual out-of-time change integration' UI to reduce the weirdness.
  
So, causal frontier / dotted version vector comes into play for me.
yeah I think one thing I want is the ability to confidently say that we haven't missed anything. So I think we refuse to process out-of-order events, leaving them queued up.

And then the 'merge' semantics can indicate causal ranges. like we're merging in A:1-10, B:1-2, and C:1-15. Actor change IDs would be sequential, and tied specifically to a branch. new branch, start the counter back at zero.

I want a setup where, when changes come in that are more than 5 minutes old, they don't get automatically incorporated -- you get a notification saying "review incoming changes" (with the option to just allow them without review). If you choose review, you see like a side-by-side diff of (your local state) and (the state w/ the remote changes merged in), and you get a git-like option to accept/reject changes. The result of "rejecting" an incoming change is that you create a new edit that is newer than the incoming one, with the previous values.
