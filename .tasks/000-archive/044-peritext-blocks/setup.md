split/join/move can be hashed out in a non-nested block context.

let's implement several options and compare them.
have some test doc w/ multiple blocks in a two-pane harness
try out move,split,join, and edit. and see how it plays.

also, formatting is irrelevant to the question at hand

# Implementations

## just newlines

a la quill. move does a delete + add. split/join is add/tombstone a newline

## ranges?



## multiple peritext documents

see multi-line.md

# Tests

- move + join to make a cycle
- edit + move
- edit (both sides) + split
- edit (both sides) + join
- split/join/split/join
- empty blocks
- edit at the start & end of a block
