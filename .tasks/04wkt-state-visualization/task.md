For the blog post I'm writing [about the block-crdt](src/block-crdt/Blog Post.md), I'd like to have a nice visualization of the crdt's internal state. I'm thinking something rendered with SVG, which could optionally be shown at the bottom of each editor in examples/block-rich-text.
It might want to support multiple levels of "granularity", from showing a detailed tree of an individual block's content chars, to a high-level visualization of the block structure, including splits, joins, and cycle breaking.
If formatting is present, we want to be able to represent it as well.
