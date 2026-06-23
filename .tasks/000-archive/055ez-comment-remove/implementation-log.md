# Implementation Log: Comment Removal / Resolution

## 2026-06-16

- Started implementation from `plan.md`.
- Confirmed stacking annotation marks remove by exact `data` matching in `src/block-crdt/marks.ts`.
- Issue found: resolving an annotation must emit a remove mark for the original annotation data before adding a `{resolved: true}` replacement. Otherwise the unresolved and resolved annotation values can coexist in `stackedMarks`.
- Implemented annotation resolution helpers in `examples/block-rich-text/src/annotations.ts`.
- Implemented empty-body Backspace handling:
  - single remaining body resolves the annotation,
  - multi-body annotations delete only the active body block.
- Added a sidebar resolve button that uses the same `resolveAnnotation` command path.
- Added active annotation filtering in `App.tsx` so resolved annotation data does not keep highlights/triggers visible.
- Added focused tests for resolving, sync, overlap, exact-overlap recreation, and body Backspace behavior.
- Bug found during tests: `renderedAnnotations` and exact-overlap detection originally scanned raw non-remove marks. That is incorrect once remove marks exist, because removed raw marks remain in CRDT state. Workaround/fix: derive active annotations from effective formatted runs, then use raw marks only as representatives where needed for range lookup.
- Focused annotation suite passes: `npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts`.
- Broader regression suite passes: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/blockCommands.test.ts`.
- Example build passes: `npm run build` from `examples/block-rich-text`.
- Build note: the build command prints `Error connecting to agent: Operation not permitted` before running the npm script, but `tsc` and `vite build` complete successfully and the command exits 0.
