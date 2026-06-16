# Implementation Log: Markdown Shortcuts For Lists

## 2026-06-16

- Note: the task directory had been removed from the working tree before this follow-up. Recreated only this log file and did not restore deleted research/plan/task files.
- Follow-up change: `# `, `## `, and `### ` now convert paragraph blocks into heading levels 1, 2, and 3. `#### ` remains literal.
- Verification:
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts` passed: 98 tests.
  - `npm --prefix examples/block-rich-text run build` passed, including `tsc --noEmit` and Vite build.
