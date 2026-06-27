Let's expand our block-rich-text example to have actual block metadata, inspired by notion and also the plim-block-crdt example.
I'm thinking:
- list (ordered, unordered)
- checkboxes
- headings (h1, h2, h3)
- blockquote
- code blocks (with syntax highlighting, configurable lang)
- tables, where each cell is a block. we'll need to think carefully about how to represent the cells so that split & join operations work correctly, as well as dragging a block into or out of a table cell. Maybe we have row headers as children of the table block, and each cell is a child of the corresponding row header? Although that would prevent nesting things under the table block. Which is maybe fine.
- callouts (info,warning,error)
- comments (rendered in a sidebar)
- footnotes (rendered in a popover, or maybe at the bottom of the page)
