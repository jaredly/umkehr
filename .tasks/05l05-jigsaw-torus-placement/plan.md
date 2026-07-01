# Plan: Jigsaw Torus Border Placement

## Decisions

- Store torus outer placement with the existing position shape plus `outer?: boolean`.
- Planar boards ignore `outer` completely.
- Torus positions with `outer === true` are outer-canvas positions.
- Torus positions without `outer === true` are torus-surface positions and are canonicalized modulo image size.
- Outer positions are collaborative/persisted.
- Connected components outside the torus still count as solved because solved progress remains connection-based.
- Dropping outside never removes placement or returns a piece to generated local auto-layout.
- Concurrent surface/outer moves use normal LWW behavior on the same `positions[piece]` value.
- Pointer location decides whether a drop is surface or outer; piece bounds do not.
- Outer placements may visually overlap the torus sub-canvas.
- Surface writes replace the whole position with plain `{x, y}` rather than writing `{outer: false}`.

## Phase 1: Position Model Helpers

Files:

- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

- Extend `Coord` to include `outer?: boolean`.
- Add helpers in `jigsaw.ts`:
  - `isOuterPosition(board, position)` returns true only for torus boards with `position.outer === true`.
  - `placementSpaceForPosition(board, position)` returns `'plane' | 'surface' | 'outer'`.
  - `positionPoint(position)` strips metadata and returns `{x, y}`.
  - `surfacePosition(point)` returns plain `{x, y}`.
  - `outerPosition(point)` returns `{x, y, outer: true}`.
- Update `positionPatch(...)` to accept the extended `Coord` shape and rely on callers to pass either plain surface/plane positions or `outer: true`.
- Replace code paths that directly use a stored position as a point with `positionPoint(...)` where the `outer` property must not leak into geometry math.

Tests:

- `{x, y}` remains valid.
- `{x, y, outer: true}` is valid.
- Planar boards treat `{x, y, outer: true}` as normal plane placement.
- Torus boards classify `{x, y}` as surface and `{x, y, outer: true}` as outer.

## Phase 2: Layout Spaces

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

- Add `ComponentPlacementSpace = 'plane' | 'surface' | 'outer'`.
- Extend `PuzzleLayout` with:
  - `componentSpaces: Map<number, ComponentPlacementSpace>`;
  - optionally `pieceSpaces: Map<number, ComponentPlacementSpace>` if it simplifies panel rendering.
- Update `buildPuzzleLayout(...)` so each connected component gets one interpreted placement space:
  - plane boards always use `plane`;
  - torus boards choose among stored positions by space;
  - preserve existing anchor selection by depth within the selected space;
  - use `positionPoint(...)` before deriving component positions.
- Define deterministic behavior if a torus component has both surface and outer stored positions from stale/non-anchor entries. Preferred rule:
  - choose the anchor with the highest existing anchor priority after grouping by interpreted space;
  - if priority ties, use the existing piece-index tiebreaker;
  - the chosen anchor's space becomes the component space.
- Ensure stale non-anchor positions remain harmless, as they are today.

Tests:

- Legacy torus surface components still derive positions across seams.
- Outer torus components derive connected piece positions on the outer canvas without modulo wrapping.
- Mixed stale surface/outer positions resolve deterministically.
- Plane layout output is unchanged except for ignored `outer` metadata.

## Phase 3: Rendering Split

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

- Split torus rendered positions into:
  - surface placed positions;
  - outer placed positions;
  - local-only generated unplaced positions.
- For torus boards:
  - render surface placed components inside `.jigsawTorusViewport` using `torusPieceCopies(...)`;
  - render outer placed components directly on `.jigsawCanvas`;
  - render local-only unplaced pieces directly on `.jigsawCanvas`.
- Keep planar rendering on the existing single branch.
- Update minimap inputs so:
  - surface positions are canonicalized inside the image rectangle;
  - outer positions are shown at their actual outer coordinates;
  - generated unplaced positions continue to appear.
- Keep solved progress as `validConnections(...).length`.

Tests:

- A torus piece with `{outer: true}` renders outside the clipped torus viewport.
- A torus surface piece still renders wrapped duplicate copies at edges.
- Planar render behavior is unaffected.
- Minimap content bounds include persisted outer placements.

## Phase 4: Drag And Drop Behavior

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

- Replace `DragState.mode: 'outer' | 'torus'` with drag-space state that can cross spaces during a drag:
  - `originSpace: 'outer' | 'surface'`;
  - `previewSpace: 'outer' | 'surface'`.
- During pointer move, use `pointerToTorusLocal(...)` plus `isInsideTorusViewport(...)` to decide preview space by pointer location.
- Ensure active dragged components render in the preview layer:
  - inside pointer: surface preview;
  - outside pointer: outer preview.
- On outside drop for torus boards:
  - dispatch `positionPatch(latest, drag.anchor, outerPosition(anchorPosition))`;
  - preserve existing connections;
  - allow multi-piece connected components.
- On inside drop for torus boards:
  - convert outer visual coordinates through `torusLogicalDropPosition(...)` when needed;
  - canonicalize;
  - dispatch a plain surface position with no `outer` property;
  - preserve/add snap connections.
- Delete or replace `outsideTorusDropPatches(...)`; outside drop should no longer remove/cancel placement.
- Keep pointer location, not piece bounds, as the only inside/outside decision.

Tests:

- Dragging an unplaced piece to the torus border persists `{outer: true}` and leaves it where dropped.
- Dragging a connected torus surface component outside persists an outer anchor and preserves connections.
- Dragging an outer connected component back inside stores plain `{x, y}` and removes `outer`.
- A component may overlap the torus sub-canvas while still being classified by pointer drop target.

## Phase 5: Snapping Rules

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

- For surface drops:
  - use logical torus positions;
  - compare only against surface placed components;
  - use `wrappedDistance(...)`.
- For outer drops:
  - use outer canvas positions;
  - compare only against outer visible positions if snapping should happen outside;
  - use normal Euclidean `distance(...)`.
- Do not let shelved outer pieces participate in wrapped seam snapping while the dragged component is dropped outside.
- Preserve existing planar snapping behavior.

Tests:

- Surface drops snap across torus seams.
- Outer drops do not snap through torus seams.
- Outer-to-surface drops can snap to surface components after coordinate conversion.
- Planar snap candidate tests still pass.

## Phase 6: Smoke Coverage And Verification

Files:

- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`

Tasks:

- Update the existing torus smoke test that currently expects outside drop to remove torus copies and return a piece to generated unplaced layout.
- Add/extend smoke coverage for:
  - unplaced piece dragged to border and staying there;
  - connected two-piece component dragged out and staying connected/visible outside;
  - same component dragged back into the torus and rendering wrapped copies;
  - planar jigsaw still opens and behaves normally.

Verification commands:

- `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts`
- `npm exec tsc -- -p tsconfig.json --noEmit`
- `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts`

Known context:

- `tsc` was recently failing in unrelated block-editor annotation files in the existing worktree. If still failing, record the unrelated errors and rely on focused jigsaw tests plus smoke tests for this task.

## Phase 7: Cleanup

Tasks:

- Remove dead outside-drop cancellation/removal helpers if no tests use them.
- Audit direct `position.outer` reads so planar boards ignore the field consistently.
- Audit direct `{...position}` spreads into geometry paths so `outer` metadata does not accidentally affect equality or rendering assumptions.
- Update comments/test names that describe outside torus drops as "removal."
- Run `git diff` and confirm changes are limited to jigsaw app/test files unless schema migration plumbing is explicitly added.
