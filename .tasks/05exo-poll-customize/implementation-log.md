# Implementation Log: Poll Block Config Menus

## 2026-06-25

- Started implementation from `plan.md`.
- Noted existing poll-related worktree changes from prior work; proceeding by editing only the task-relevant files and preserving existing behavior where possible.
- Phase 1 progress:
  - Added poll display and rating presentation metadata types.
  - Added validation for the new poll metadata.
  - Added helper logic to normalize multiple-choice answer/matrix votes back to single-choice votes.
  - Extended document import/export round trips for the new metadata.
  - Added focused unit tests for validation, normalization, and document format behavior.
- Issue encountered: the new document-format test used implicit paragraph child blocks, but export materializes them with `type: 'paragraph'`. Updated the test fixture to be explicit; no product code workaround needed.
- Phases 2-5 progress:
  - Replaced the code-specific block options menu component with a shared `BlockOptions` menu.
  - Moved callout kind and image size controls into the shared three-dots menu.
  - Added poll menu controls for choice mode, answer display mode, rating range, rating presentation, and `allowChange`.
  - Added answer poll list rendering and rating poll star labels.
  - Typecheck/build passed with `npm run build`.
- Issue encountered: `npm run build` printed an SSH agent warning from the shell environment, but TypeScript and Vite completed successfully.
- Phase 6 progress:
  - Added App tests for callout/image block menus, answer poll display and selection mode, matrix poll multi-select mode, rating range/presentation, and long-answer `allowChange`.
- Issue encountered: poll fixtures contain multiple same-kind poll blocks, so panel-wide Testing Library queries found duplicate controls inside closed `details` menus. Scoped tests to the opened `.blockOptionsMenu`.
- Issue encountered: the long-answer fixture includes a second poll with a disabled Submit button, so the long-answer assertion needed to scope to the first poll row.
- Final verification:
  - `npm exec vitest -- run src/pollBlocks.test.ts src/documentFormat.test.ts` passed: 25 tests.
  - `npm exec vitest -- run src/App.test.tsx` passed: 227 tests, 1 skipped.
  - `npm run build` passed.
  - The build continues to print the environment SSH agent warning noted above, but TypeScript and Vite complete successfully.
