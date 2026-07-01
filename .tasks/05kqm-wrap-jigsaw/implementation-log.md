# Implementation Log: Wrapping Jigsaw Board Surface

## 2026-06-30

- Started implementation from `plan.md`.
- Initial inspection found the current worktree already contains prior jigsaw changes for 1000-piece
  boards, uploaded image artifacts, Voronoi generation, tabbed masks, and dense packing. Torus
  support will be layered onto those existing abstractions.
- No implementation code changed before creating this log.
- Added the `JigsawSurface` model, optional `surface` board artifact field, generation option,
  artifact validation/defaulting, and model exports.
- Added a document-creation `Surface` selector and validation plumbing. Plane remains the UI default,
  while generated plane artifacts still omit the optional `surface` field.
- Began shared wrap geometry support: rectangular torus seam edges, shortest wrapped neighbor
  offsets, periodic Voronoi cell scaffolding, and seam-aware tab edge matching.
- Issue encountered: the first periodic helper draft used grid-period counts as shifts; corrected it
  immediately to use pixel offsets before using it further.
- Added rectangular torus coverage for omitted plane surfaces, torus artifact output, four-neighbor
  rectangular torus topology, seam offsets, seam validation, and tabbed seam geometry.
- Added periodic Voronoi torus coverage for finite geometry, reciprocal neighbors, seam-crossing
  neighbor relations, and tabbed periodic masks.
- Added wrap-aware piece image sampling in `PieceCanvas` by splitting source crops across image tile
  boundaries with modular coordinates. This is used for all boards so plane behavior remains on the
  same rendering path.
- Added snapping/layout tests showing rectangular torus seam snaps and unwrapped component positions
  past the base image bounds.
- Verification:
  - `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passes with 58 tests.
  - An initial `npm run build` passed before the final artifact-normalization test was added.
  - A later `npm run build` failed in unrelated block-editor code:
    `src/block-editor/BlockRichTextEditor.tsx(3959,5)` reports that the implementation object is
    missing fields from `BlockEditorSlideRenderServices`. The relevant type change is in the
    pre-existing modified file `src/block-editor/plugins/types.ts`, outside the jigsaw task. I did
    not modify or revert it.
  - Started the Vite dev server with `npm run dev -- --host 127.0.0.1 --port 5174`; ports 5174-5176
    were occupied, so Vite selected `http://127.0.0.1:5177/`. `curl -I` returned `200 OK`.
