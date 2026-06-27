examples/block-rich-text: I want to improve & expand our selection story.

1. you need to be able to drag-to-select across multiple blocks.

This should be a normal text select. We currently support doing "shift-right" to extend the current selection over multiple blocks. Now we just need to support drag-to-select.

2. if you drag-to-select multiple blocks, and then grab the drag handle of one of those blocks, we should darg all the selected blocks together. On drop, the initial text selection should be preserved.

3. we need the concept of a 'block level selection'

This is most important for table ux, but can be applicable to other blocks as well. When tabbing through a table, the cursor should change to a 'cell selection' (a block selection of the cell block). This allows us to disambiguate the "tab to move through the table" intent from the 'tab inside a child block of a cell to indent/dedent'. Note that, if you tab/shift-tab in a cell block (not the child of a cell block) we should move you to the adjacent cell, and switch the selection type to a 'block selection'.
Block selections also allow us to 'select multiple cells of a table'. Ideally we should accommodate rectangular selections within a table.
Clicking a cell border should switch the selection to a block selection.
Clicking a blocks drag handle should switch the selection to a block selection.
Typing while in 'block selection mode' should switch to text selection mode at the end of the last selected block.

cmd-c and cmd-v should work in block selection mode, as well as drag-to-reorder.
