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
