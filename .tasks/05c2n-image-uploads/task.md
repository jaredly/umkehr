examples/block-rich-text: let's support image uploads! let's have it be a block type unto itself, where the block meta has an 'attachment id' (and maybe a presentation size small/medium/large/original), and the block contents acts as a description rendered under the image.
Then the actual management of the image file would be outside of the CRDT state.
