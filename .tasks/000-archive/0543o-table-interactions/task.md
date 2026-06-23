Table interaction feedback:

- backspce in an empty cell at the start of a row when all cells in the row are empty should delete the row
- let's have cell drag behavior be more like google sheets. so no drag handle, but when a cell is focused, it's border is highlighted, and you can grab the border to start a drag.
    - the cell "drop locations" need to be much better. Vertical bars instead of horizontal.
- for rows, let's have the left gutter render row numbers, which you can grab to reorder them.
- the table drag handle should really be in the same placement as other block types, so off to the left instead of stuck in with the "table" label.
- instead of a table label, let's have the text contents of the table actually be editable, and have it function as a "table title" (so like smallcaps bold)
- splitting a table title should make a new paragraph-type block after the table, not another table-type block
- pressing enter in the last row, if all cells in the row is empty, should delete that row (if it's not the only row) and create a new paragraph block after the table.
