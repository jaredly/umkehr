# Implementation Log: Empty Block Indicator

## 2026-06-16

### Phase 1: CSS Indicator

- Replaced the existing empty-block 1px caret pseudo-element with a shared `...` pseudo-element at 50% opacity.
- Kept the existing `.editableBlock[data-empty="true"]::before` hook so the behavior applies to every `RichTextEditableSurface`.

### Phase 2: Focus-State Styling

- Added a focused empty-block override that clears the pseudo-element content so existing focus styling replaces the indicator.

Issues/workarounds:

- CSS generated content cannot be asserted directly in jsdom, so regression tests will target the `data-empty` state that drives the visual indicator.
- Found an existing row-header-specific empty pseudo-element that rendered `data-placeholder` row numbers. Removed that generated-content override so table row headers use the same shared empty indicator as other editable surfaces, while leaving the `data-placeholder` attribute intact.

### Phase 3: Regression Tests

- Added UI tests asserting `data-empty="true"` on the initial empty block.
- Added coverage that typing removes `data-empty`, deleting the only character restores it, and whitespace remains non-empty.
- Added table coverage for empty table title, table cell, and row header editable surfaces.

Issues/workarounds:

- The whitespace regression initially used the test-only `typeText` input fallback after deleting back to an empty block. That left the assertion on a brittle jsdom path, so the test now refreshes the block reference and uses the editor's `beforeinput` helper like the rest of the contenteditable coverage.

### Phase 4: Visual Verification

- Started the example app with Vite. Port `5173` was occupied, so Vite served the app at `http://127.0.0.1:5174/`.
- Captured a real Chrome-rendered screenshot at `/tmp/054bv-empty-block-indicator.png`.
- Confirmed the initial empty editor surfaces render visible `...` indicators at the text insertion area.

Issues/workarounds:

- The in-app browser surface was unavailable in this session (`Browser is not available: iab`).
- Playwright imported successfully, but its bundled Chromium executable was not installed.
- Retrying Playwright with system Chrome failed because the launched browser closed immediately under the local process constraints.
- Used headless system Chrome from the shell instead for pixel-level screenshot verification. That command produced noisy updater logs and did not exit cleanly until the temporary Chrome profile process was stopped.
- The headless screenshot verifies the main empty-block visual. Table editable-surface behavior is covered by automated `data-empty` tests rather than browser interaction because scripted browser control was unavailable.

### Phase 5: Verification Commands

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed: 116 tests.
- `npm --prefix examples/block-rich-text run build` passed.
- Stopped the temporary Vite server after verification.

### Follow-up: Retained Cursor Overlap

- Fixed a visual issue where an empty block with a retained multi-cursor rendered the cursor after the generated ellipsis.
- Added `.editableBlock[data-empty="true"]:has(.retainedSelectionCaret)::before { content: ""; }` so the empty indicator is hidden whenever a retained cursor is present in that empty editable surface.
- Re-ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`: 116 tests passed.
- Re-ran `npm --prefix examples/block-rich-text run build`: passed.
