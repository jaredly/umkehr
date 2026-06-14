We could also support "merged cells" with a "merged-cell" block type, with a number indicating the number of columns it spans.

I do want to support user-manipulated column widths. Here's how we do it: have a 'column-header' block type, which has a `width` setting which is an optional integer (null for auto). Users can decide to have a table with no column row, but then they don't get to set column widths.

I don't think I want to support user-manipulated row heights.
