examples/block-rich-text: now that we have a json `documentFormat`, let's make some "fixtures" documents. And the UI should have a dropdown for "replace document from fixture".
There should be fixtures for:
- simple document with a few block types
- a few long blocks (4 blocks, 400 words each)
- a long block with lots of marks (600 words, a mark every 10 words that lasts for 1-3 words. mix of bold, italics, link, popover, etc.)
- a large table (5 x 7) with a few words in each cell
- a sparse table (some rows are missing a few cells)
- a large complex table, with some rows being tables themselves, and some cells being table themselves.
- a doc with deep (5) nesting, lists of lists of lists of lists
- a doc with a ton of blocks (200 blocks, 10 words in each)
- ... anything else you think would be helpful.
