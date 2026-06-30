# Implementation Log 14: Cleanup

## Completed

- Removed the editor-local `LEGACY_TOOLBAR_COMMAND_IDS` allowlist.
- Made toolbar command execution consistently depend on registry-derived command availability.
- Collapsed toolbar block-type execution onto the shared `runBlockTypeCommandEverywhere(...)` path, removing a duplicate hard-coded structural branch chain from `runToolbarBlockTypeCommand`.
- Removed the `legacyRichTextPlugins` compatibility alias and renamed the full preset module/CSS entrypoint to `defaultBlockEditorPlugins`.

## Deferred

The remaining direct feature imports and central render branches in `BlockRichTextEditor.tsx` are not
mechanical cleanup. They depend on follow-up API work already called out in the plan:

- command context services for attachments, focused blocks, preview fetch/render, and other editor
  services before image upload, link preview, and heavy structural command bridges can move fully
  into plugin-owned command handlers;
- block-scoped clipboard hook ownership before registry-derived clipboard feature filtering can be
  replaced by plugin serialization/deserialization hooks;
- renderer extraction before the editor can remove central feature render branches for annotations,
  polls, media, tables, columns, slides, code previews, links, embeds, and math.

## Verification

- `npm run typecheck`
- `npm exec vitest -- run src/block-editor/defaultBlockEditorPlugins.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/structuralPlugins.test.ts src/package-smoke.test.ts`
