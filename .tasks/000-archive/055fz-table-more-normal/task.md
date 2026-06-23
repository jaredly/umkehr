examples/block-rich-text: Currently, the representation of "table" blocks has some custom quirks. There's a "row parent" that is a virtual block that is used to group rows together. Rows have their own "row block type". Cells can technically have children, but they aren't rendered.
I want to simplify and standardize things.
- rows are just normal block children of tables
- rows can have any block type (although having a row that is itself a table will require careful rendering)
- cells can have children. these children should be rendered below the main cell block content, but probably not indented for the first level.
