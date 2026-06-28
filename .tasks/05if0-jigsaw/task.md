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
    pieces: Record<number, {
        position?: Coord,
        // pieces that this piece has 'snapped' to
        connections: Record<number, true>,
    }>
}
```
Our initial board type will be plain rectangles, but our data model should account for more interesting shaped pieces.
