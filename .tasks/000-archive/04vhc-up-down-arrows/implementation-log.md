# Implementation Log: Up/Down Arrow Navigation

## Phase 1: DOM Caret Geometry Helpers

- Started by adding DOM-focused caret geometry helpers in `examples/block-rich-text/src/domSelection.ts`.
- Kept offsets in grapheme units to match the existing `segmentText` selection model.
- Added fallback measurement for collapsed ranges because browser range rect behavior is inconsistent and jsdom has no real layout.
- Workaround: the deepest fallback briefly inserts and removes a zero-width marker to measure a caret. This preserves text content, but it can split DOM text nodes, so the editor should still rely on the existing render/restore path after handled movement.

## Phase 2: Editor Vertical Intent and Key Handling

- Added an editor-level horizontal intent ref in `BlockEditor`.
- Reset vertical intent on mouse selection, non-vertical keyup capture, edit commands, horizontal cross-block moves, and editor blur.
- Added `ArrowUp` / `ArrowDown` handling only for plain collapsed carets.
- Preserved native behavior at the first and last blocks by only intercepting when a previous/next target block exists.
- Preserved native wrapped-line behavior by only intercepting `ArrowUp` on the first visual line and `ArrowDown` on the last visual line.

## Phase 3: Tests

- Added App integration tests for vertical movement, insertion after movement, repeated horizontal intent, wrapped-line fallthrough, shift-key fallthrough, and edge-block fallthrough.
- Test workaround: jsdom has no real layout, so the tests patch `window.Range.prototype.getClientRects` and `getBoundingClientRect` with deterministic caret coordinates.
- Issue encountered: `Range` is not defined as a global in this test setup, even though `window.Range` exists. Updated the shim to patch `window.Range.prototype`.

## Phase 4: Validation

- `npm exec vitest examples/block-rich-text/src/App.test.tsx` passed: 33 tests.
- `npm exec vitest examples/block-rich-text/src` passed: 70 tests across 6 files.
- `./node_modules/.bin/tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
- First attempt to start Vite inside the sandbox failed with `listen EPERM` on `127.0.0.1:5174`; reran with approval outside the sandbox.
- Started the block-rich-text dev server at `http://127.0.0.1:5174/`.
- `curl -I http://127.0.0.1:5174/` returned HTTP 200.
