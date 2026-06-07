Let's make a basic "ui example" for our block rich-text crdt (src/block-crdt).
Here's what we should be able to do:
- type text
- "enter" splits at the current position, making a new block after (or before if we're at the start)
- bold & italicize selection
- backspace at the start of a block joins with the previous
- blocks should be drag-to-reorderable
- let's only do 1 level of blocks (flat list) for now, no block nesting.
