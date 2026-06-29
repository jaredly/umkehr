examples/react-crdt: Let's make a collaborative jigsaw puzzle!

- similar to the word search, the 'board' will be an artifact
- the CRDT state will be piece positions and connections

```ts
type Coord = {x: number, y: number}
type PathSegment = 
| {type: 'Line', to: Coord}
| {type: 'Cubic', control: Coord, to: Coord}
| {type: 'Quadratic', control1: Coord, control2: Coord, to: Coord}

type Board = {
    image: artifactId,
    pieces: {
        center: Coord,
        mask: PathSegment[],
        neighbors: {piece: number, offset: Coord}[]
    }[],
}

type State = {
    // keyed by 'piece index'
    positions: Record<number, Coord>,
    // key = `${piece index}:${piece index}`
    connections: Record<string, true>,
}
```
Our initial board type will be plain rectangles, but our data model should account for more interesting shaped pieces.

On document creation:
- generate a board (the user should be able to select the number of pieces, i.e. 12, 30, 60, 120)
- create an empty initial state

When rendering:
- calculate the current position of all 'placed pieces' (pieces that have an entry in `positions` or that are part of a graph of pieces)
- for any 'unplaced pieces', arrange them uniformly around the border of the user's screen. users should have a button to 'reshuffle unplaced pieces', which rearranges those unplaced pieces for themselves only (local, transient state)

How to calculate placed piece positions:
- first process all connections to generate the components of the directed graph. connections are of the form `${A}:${B}`, with the direction A -> B
- each component is a 'set of connected puzzle pieces', and can be placed, as soon as we decide which piece has the 'authoritative position' (known as the 'anchor piece'), relative to which all other pieces in the component should be placed.
- calculating the anchor piece is as follows: number each node in the graph by traversal depth. Roots have depth 0. A node that is reachable at two different depths from different roots gets the max() of the two depths. For cycles, all nodes in the cycle get the same depth (1 greater than the highest-depth node that points to the cycle). Then you take the node with the greatest depth that has a `position` in `state.positions`. If there are multiple with the same depth, do a tie breaker based on the largest 'piece idx'.
- once the anchor piece is found, place all other pieces using the `neighbors.offset`s. Note that any connections that don't correspond to "neighboring pieces" as declared in board.pieces.neighbors are invalid connections that should be discarded.

Interactions:
- the user can click & drag any piece. Drag state is local-only (not broadcast). When the user finishes a drag, a state.position is added and broadcast. If the piece is correctly positioned (within a few pixels) with respect to any currently-unconnected "neighbor" pieces on the user's board, suitable `connection`s are created, where the dropped piece is the first idx, and the neighbor piece is the second idx.
- when dragging a piece that is part of a component, the other pieces in the component should be dragged along, but no updates to position are required. However, new `connections` should be detected and created, where appropriate.

NOTE that neighbor detection should not try to do any "border to border proximity" detection or calculation. It is solely based on the `neighbor.offset` calculated at board creation. This should dramatically simplify the process, as only the known neighbors of a given piece need to be checked, and only a single distance calculation per pair is needed.




Hmmm placed position might need some kind of 'depth' to be persisted.
Like if you drag a component over to another piece, the 'connection' should be 'stronger' than any connections in the current component. So that the 'depth' of 'peice we snapped to' should dominate, and the snapped-to's position should be authoritative.
