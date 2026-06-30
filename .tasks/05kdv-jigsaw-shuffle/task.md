examples/react-crdt: The 'reshuffle' placement of unplaced tiles is really shoddy. Let's do an actual packing algorithm. It is quite important for the pieces to be densely packed around the border of the board. Can you come up with some algorithm options, and we can benchmark them? Criteria:
- speed
- minimize the max distance away from the border of the board. an algo that gets most right but has one large outlier is worse than one that packs more loosely but doesn't have outliers. of course best would be packing all close.
- no piece can overlap more than 10% with another piece

For collision/overlap testing, we can treat pieces with tabs as plain polygons.
The algorithm should work for puzzles with 1000 pieces.
