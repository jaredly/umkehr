examples/block-rich-text: I find myself needing some 'config option menus' for various block types. right now the poll block types, but we already ahve a config option thing for code, so it makes sense to generalize.
- the answer poll should let you customize the display mode (all in a line, as current, or in a list) and the (select all vs select one)
- the matrix poll should let you customize the (select all vs select one)

and this customization should happen through a three-dots menu in the top right of the block, in the same way the code block has one. and we should reuse infrastructure around this where possible.
