# Implementation Log

## Phase 0: Baseline And Safety

- Inspected current task plan and local status.
- Existing relevant user change: `examples/block-rich-text/src/App.test.tsx` has a new performance test for selecting a block in the many-blocks fixture. This must be preserved.
- Existing task docs: `research.md` includes inline answers; `plan.md` was newly added before implementation.
- Baseline `pnpm build` failed before refactoring in `src/useBlockReorder.ts` with `NO_DROP_TARGET`/`DropTarget | null` TypeScript errors. This appears unrelated to the App split because `useBlockReorder.ts` is not modified in the current status.
