# Implementation Log: Inline Embeds

## 2026-06-23

- Started phase-by-phase implementation.
- Existing worktree already had unrelated modified/untracked files; leaving them untouched.
- Phase 1: added `inlineEmbeds.ts` with sentinel/model/plugin helpers and initial tests.
- Issue: focused helper test initially failed because DOM render helpers need `document`; fixed by using the existing `src/react/test-dom` setup in the test.
- Phase 2: added `insertInlineEmbed` and `setInlineEmbedDataByCharId` command helpers.
- Phase 2 tests cover insertion, selection replacement, atomic Backspace/Delete, and char-id update after preceding text shifts the embed offset.
- Issue: one command test initially reused a `range` helper that was not defined in `blockCommands.test.ts`; replaced it with an inline selection object.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/inlineEmbeds.test.ts` passes.
- Phase 3/4: preserved the existing DOM selection accounting and made embed DOM fit that model.
- Phase 4: render path now splits `\uFFFC` sentinel segments into atomic DOM embed nodes with block id, char id, offset, type, and retained-selection metadata.
- Phase 5: added a toolbar Date action plus date embed popover that updates by CRDT char id.
- Issue: build check found two additional `RichTextEditableSurface` call sites that needed `charIdsByOffset`; fixed table row headers and annotation bodies.
- Verification: `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passes.
- Issue: the first DOM-selection implementation rewrote offset accounting recursively and regressed retained selections, multi-cursor tests, footnote sentinels, and trailing code newline behavior.
- Workaround/fix: reverted `domSelection.ts` to the existing text-node walker and changed embed rendering to include one hidden `\uFFFC` text node for logical width; the visible embed label is wrapped in `data-offset-sentinel="true"` so it does not affect editor offsets.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passes.
- Phase 6: extended custom clipboard payloads with `embed` mark ranges, plugin plain-text rendering, and readable HTML fallback for copied embeds.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/inlineEmbeds.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/App.test.tsx` passes.
- Verification: `npm exec vitest -- run examples/block-rich-text/src` passes.
- Manual smoke testing skipped at user request after automated checks passed.
