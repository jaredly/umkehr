# Implementation Log: Self-Contained Jigsaw Canvas

## 2026-06-29

- Started implementation from `plan.md`.
- Phase 1 in progress: adding local viewport/canvas coordinate helpers while keeping CRDT positions in source-image coordinates.
- Phase 1/2 implemented in code:
  - added padded logical board space and image/canvas/screen conversion helpers,
  - replaced the overflow-visible jigsaw stage with a clipped viewport plus transformed canvas,
  - preserved CRDT positions in source-image coordinates.
- Phase 3 partially implemented:
  - empty-space drag pans,
  - normal wheel scroll pans,
  - Ctrl/Cmd wheel zooms around the cursor,
  - viewport state remains local.
- Phase 4 partially implemented:
  - added `JigsawMinimap` with authoritative placed-piece rectangles and recenter-on-click/drag.
- Issue/workaround: kept per-piece HTML buttons with internal canvases for this pass. This preserves accessibility and existing drag behavior; a single-canvas renderer remains future work if profiling shows DOM/canvas node count is the scaling bottleneck.
- Verification: `npm run build` from `examples/react-crdt` passed. The command printed `Error connecting to agent: Operation not permitted` before the npm script output, but TypeScript and Vite both completed successfully.
- Verification: `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passed.
- Issue found by Playwright: the minimap click test did not change the transform because the jigsaw viewport was too tall in the solo layout, placing the minimap below the default browser fold. Workaround/fix: reduced the desktop viewport height from a whiteboard-like `70vh` to `56dvh` with a smaller minimum so the minimap is reachable in the common viewport while still keeping the board self-contained.
- Verification: `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` passed after the viewport-height adjustment.
- Verification: second `npm run build` passed after CSS and Playwright test changes. The same pre-script `Error connecting to agent: Operation not permitted` line appeared, but the build completed.
- Visual verification: captured desktop and mobile screenshots from a local Vite server on port 5174. Pieces were clipped inside the jigsaw viewport and the minimap was visible/reachable on both sizes.
- Verification: `pnpm test:e2e -- tests/smoke/app-routing.spec.ts` passed.
- Follow-up fix: mouse/touchpad wheel over the jigsaw viewport still allowed the outer document to scroll in some cases. Replaced the React `onWheel` prop with a native `wheel` listener installed on the viewport with `{passive: false}` so `preventDefault()` reliably suppresses page scroll while the pointer is over the canvas.
- Verification: updated `tests/smoke/jigsaw-solo.spec.ts` to use a real `page.mouse.wheel(...)` over the viewport and assert `window.scrollY` does not change. `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` passed.
- Verification: `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passed after the wheel fix.
- Blocked verification: a final `npm run build` is currently failing in unrelated `src/block-editor/*` files, including missing `./tableSelectionPlugin` and selection type errors. The failing files were not touched by this jigsaw task.
