# Implementation Log: Copy And Paste Marks

## Phase 1: Clipboard Types And Parsing

- Started with a new focused clipboard module and parser tests.
- Scope choice: keep the parser strict and non-mutating. It returns `null` for malformed custom data so paste can fall back to `text/plain`.
- Focused parser test passed. Note: the repo's Vitest config loaded the broader suite when run with the file path; all loaded tests passed.

## Phase 2: Serialization From Selection

- Added selection serialization to the clipboard module.
- Captures boolean marks, links, stacked annotation refs, annotation body blocks, block metadata, plain text, and best-effort HTML.
- Multi-selection serialization sorts by document order and emits separate fragments joined by newlines for plain text.
- Issue encountered: a test initially inserted `\n` with `insertText`, which does not create a new block. Switched the setup to `splitBlock`, matching the command layer's block behavior.
- Focused clipboard serialization tests passed.

## Phase 3: Rich Paste Command Helpers

- Exported `pastePlainTextDetailed` so rich paste can reuse existing insertion and destination-line mapping without invoking markdown shortcuts.
- Added `pasteRichClipboardEverywhere` in `multiSelectionCommands.ts`.
- Replays boolean marks, links, block metadata, and annotation refs over inserted ranges.
- Same-document annotation paste reuses an existing annotation id. Cross-document paste allocates a fresh annotation id and imports body blocks.
- Workaround: annotation body import is delayed until after reference marks are applied, because virtual annotation parents do not exist until a mark with that annotation id exists in state.
- Added command tests for rich marks, links, metadata, markdown-shortcut bypass, same-document annotation reuse, cross-document annotation import, and multi-fragment adjacent blocks.
- TypeScript check passed for `examples/block-rich-text`.

## Phase 4: React Clipboard Wiring

- Wired main editor copy to write the custom JSON MIME type, `text/plain`, and `text/html`.
- Wired main editor paste to prefer the custom rich payload and fall back to existing plain-text behavior, including the link-like paste shortcut and markdown shortcuts for plain text only.
- Wired table row-header editable surfaces into the same copy/paste path.
- Wired annotation body paste to accept rich payloads through the same command helper.
- Added annotation body copy support by passing the current CRDT state into annotation body block components and serializing their current DOM selection.
- Added UI tests for copy formats and rich-paste precedence.

## Phase 5/6: Verification

- `pnpm exec tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
- `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed before annotation body copy wiring.
- Combined focused test command loaded the broader suite due the repo's Vitest config. All functional tests passed, but `examples/block-rich-text/src/typingPerf.test.ts` failed twice on the timing-only assertion `elapsed < 120` with observed times around 124-127ms. This appears unrelated to the clipboard changes but remains a verification issue to call out.
