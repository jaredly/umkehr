
Things that I want to do today: wake up early, eat breakfast, visit frog, go for a walk

(-early +on time)
(a healthy breakfast)
(my friend frog)
(long walk)


Features I want to demo:
- cursor location retention in the presence of concurrent changes

More thinsg I want for "sharing this":
- keep a history record of all transactions, and allow (export/import/scrubbing)


-----

Things to buy: milk, eggs, and ham

(left: split into blocks)
(right: add "fresh milk", "green eggs", and "deviled ham")


-----

Edge cases to test:
- split contention (two clients split at the same point)
- join contention (two clients join at the same point, or same block to different blocks, or different blocks to the same block)

What about cycles?

- A
- B

Joining B to A and A to B at the same time would:
- create a cycle between A and B
- delete/archive both blocks containing A and B

How do we beat cycles?
- I could imagine keeping a "prevParent" for any char that gets reparented, and when we detect a cycle we deterministically decide on one link in the chain to break and revert it to the prevParent
- BUT that doesn't solve the problem of both blocks having been archived.
- should we change the model so that a block is archived only if it is empty? So a non-empty archived block isn't archived? that would be confusing because if you delete the characters it would delete the block weirdly.

or I could have like "fixit ops" that get automatically generated on each client when they see an issue. I don't like that.

OR I could have the client display cycles in a separate UI like "here's a cycle, you need to break it", and they can unarchive the block.

honestly that's probably the principle of least surprise right there.


#

Join loss bug fix -- we need to tombstone blocks
and then make a real char for the block ID, have it
be tombstoned, but parent relationships are all still retained.
That feels quite clean.
