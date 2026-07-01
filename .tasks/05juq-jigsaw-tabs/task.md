examples/react-crdt: Let's make a jigsaw board mode that looks more like a jigsaw puzzle.
Here's how it works:
- we start with the same grid with perturbations as the voronoi method
- then we compute the voronoi shapes
- then for each voronoi edge, we place a dot at the midpoint of the edge
- we then draw the largest circle possible from each dot, without it overlapping any other dots (with some small margin)
- these dots are the tabs. for each edge, it's coin flip which half of the circle is used (sticking in or out)
For now we'll have pretty simple 'line-semicircle-line' edges. we can get fancy with bezier curves later.

We can also do this 'tab creation' method with the rectangles board layout. maybe 'tabs' should be a checkbox during board creation, and it can apply to any of the board layouts?
