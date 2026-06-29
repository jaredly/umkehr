# Implementation Log: Collaborative Jigsaw

## 2026-06-29

- Started implementation from `plan.md`.
- Phase 1 in progress: scaffolding `examples/react-crdt/src/apps/jigsaw` and wiring app/runtime files.
- Added initial schema/model/app/panel scaffold and a jigsaw artifact store with rectangular board generation.
- Added pure jigsaw helper module for connection validation, weighted depth, anchor selection, derived placement, snap candidates, patch helpers, and local unplaced layout.
- Test issue: reciprocal offset test compared `0` and `-0` with exact object equality. Updated the test to use numeric closeness for offsets.
- Wired the jigsaw app into the app registry.
- Replaced the placeholder panel with a rectangular-piece drag/drop UI, local reshuffle, anchor-position drop writes, and all-eligible correct-neighbor snap connection dispatch.
- Added jigsaw styles and a CSS-rendered approximation of the fixed `stock:hue` image.
- Build issue: TypeScript did not retain narrowing for `input.pieces` inside artifact validation. Fixed by assigning `input.pieces` to a locally narrowed variable.
- Verification: focused `jigsaw.test.ts` passes.
- Verification: `npm run build` passes. The shell printed `Error connecting to agent: Operation not permitted` before the build, but TypeScript and Vite completed successfully. Vite also emitted the existing large chunk warning.
- Added HLC-based z-order for positioned components when CRDT metadata is available, with deterministic fallback ordering for history/solo contexts.
- Visual smoke issue: `npm exec playwright -- screenshot` failed because the Playwright browser binary is not installed. A system Chrome headless screenshot attempt hung and had to be killed by URL-specific `pkill`; no screenshot was produced.
- Verification: dev server is running at `http://127.0.0.1:5173/?app=jigsaw`, and `curl -I` returns HTTP 200 for the jigsaw route.
- Rendering correction: replaced CSS-generated piece fills with real HTML canvas rendering. The app now generates the fixed `stock:hue` image into a source canvas, draws the solved-image preview from that canvas, and renders each puzzle piece by clipping to `piece.mask` and sampling the matching source-image rectangle. This should make adjacent rectangular pieces visually match edge-to-edge.
- Verification after canvas rendering: focused `jigsaw.test.ts` passes and `npm run build` passes with the same SSH agent warning and Vite large-chunk warning as before.
