I'd like to extend our peritext implementation with support for blocks. I can imagine a couple of ways to do this.
1. use a quill/delta approach where a block is defined by a formatting mark on the `\n` newline at the end of a line. adjacent blocks with the same formatting are treated as the same block, albeit separated by newlines.
2. extend the current "mark applies to a span of text" to include logical block-level tags such as `<p>`, `<div>`, or `<blockquote>`. This might lend itself better to nested blocks (a blockquote inside of a <ul> for example), but might be less ergonomic for splitting/joining blocks.
There are likely other approaches that I haven't considered.
