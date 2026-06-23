# Implementation Log: Slash Insert Popover

## 2026-06-23

- Started phase-by-phase implementation.
- Phase 1/2/3 in progress: adding slash trigger state, popover UI, and char-id based slash deletion in the main editor path.
- Phase 1/2/3/4: implemented main editor slash state, popover UI, char-id based slash deletion, block type commands, table command plumbing, and date embed command plumbing.
- Phase 5 partial: normal blocks, table cells, and table row headers share the main editor slash path; syntax-highlighted code blocks insert `/` without opening the menu.
- Issue: annotation body editing uses a separate command path from the main document editor, so annotation body slash command support is not wired in this first pass.
- Verification: `npm --prefix examples/block-rich-text run build` passes.
- Phase 7: added App coverage for slash open/focus/Escape, filtering, Heading 2, Date embed, multi-cursor deletion/application, multi-cursor Date embeds, code-block exclusion, table cell/row header opening, and running a command after the slash is already deleted.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passes.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts` passes.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/inlineEmbeds.test.ts` passes.
- Verification: `npm --prefix examples/block-rich-text run build` passes after the full test pass.
- Verification: `npm exec vitest -- run examples/block-rich-text/src` passes.
- Manual/browser smoke check: started the local dev server at `http://127.0.0.1:5174/`, but the in-app browser surface was unavailable in this session.
- Follow-up: adjusted slash command popover positioning to use the collapsed caret rect, so it appears below the cursor instead of falling back to the editor's top-left area.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passes after the positioning fix.
- Verification: `npm --prefix examples/block-rich-text run build` passes after the positioning fix.
- Follow-up correction: live collapsed selection geometry was still not reliable at slash-open time, so the slash popover now remeasures the rendered block at the stored slash trigger offset in a layout effect.
- Workaround: jsdom does not provide the full range geometry API used by the real browser caret measurement path, so the remeasure helper catches missing-geometry failures and keeps the existing fallback position in tests.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passes after the trigger-offset positioning change.
- Verification: `npm --prefix examples/block-rich-text run build` passes after the trigger-offset positioning change.
- Follow-up: active slash command options now call `scrollIntoView({block: 'nearest'})` so ArrowUp/ArrowDown keeps the highlighted option visible.
- Workaround: jsdom does not implement `scrollIntoView`, so the call is guarded in tests.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passes after the active-option scroll fix.
- Verification: `npm --prefix examples/block-rich-text run build` passes after the active-option scroll fix.
