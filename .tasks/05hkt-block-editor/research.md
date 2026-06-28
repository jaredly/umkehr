# Research: Extract Block Rich Text Editor

## Goal

Refactor the reusable "block rich text editor" out of `examples/block-rich-text` into a new package folder, `src/block-editor`, so `examples/react-crdt` can use it in the `block-notes` app.

The target should be a React editor component and supporting editor utilities that can edit the existing `BlockRichText` leaf value from `umkehr/block-richtext`, while keeping demo-only replication and history UI in the example app.

## Current State

There are already two related layers in the repo:

- `src/block-crdt`: low-level block CRDT state, ops, formatting, traversal, undo planning, and helpers.
- `src/block-richtext`: leaf CRDT wrapper for embedding a `block-crdt` state inside the generic `umkehr/react-crdt` document model. It exports `BlockRichText`, `blockRichTextLeafPlugin`, `blockRichTextBuilderExtension`, materializers, and simple leaf commands such as `$block.insertText`, `$block.deleteRange`, `$block.splitBlock`, `$block.joinBlocks`, `$block.moveBlock`, `$block.setBlockMeta`, and `$block.ops`.

`examples/react-crdt/src/apps/block-notes` already uses `src/block-richtext`:

- `schema.ts` stores `body: BlockRichText`.
- `BlockNotesApp.tsx` registers `blockRichTextLeafPlugin` and `blockRichTextBuilderExtension`.
- `BlockNotesPanel.tsx` currently materializes the body to text and exposes a placeholder "Insert actor" button.

`examples/block-rich-text` contains the full rich editor implementation, but it is example-shaped rather than library-shaped:

- `EditorApp.tsx` is about 10k lines and contains both the demo shell and most editor UI/rendering/event code.
- The whole example source is about 45k lines including tests.
- `blockEditorRuntime.ts` defines the two-replica demo runtime (`left`/`right`, queues, HLC clock, replay support) and applies local/remote ops.
- `history.ts`, `undoHistory.ts`, `editorAppUtils.ts`, `KeyPerfMonitor.tsx`, fixtures, import/export, and the top-level history controls are demo tooling.
- Core editor behavior is spread across many modules: `blockCommands.ts`, `multiSelectionCommands.ts`, `selectionModel.ts`, `selectionSet.ts`, `retainedSelection.ts`, `domSelection.ts`, `clipboard.ts`, `inlineMarks.ts`, `inlineEmbeds.ts`, `annotations.ts`, `blockMeta.ts`, `blockTypeHelpers.ts`, `mediaBlocks.tsx`, `floatingPopovers.tsx`, `slashCommands.tsx`, `Toolbar.tsx`, `useBlockReorder.ts`, and related helpers.

The editor already has substantial behavior that should not be reimplemented from scratch:

- retained selections based on character/block ids,
- multi-selection commands,
- inline mark sessions,
- markdown shortcuts,
- block moves and drag/drop,
- tables, columns, slides, polls, annotations, previews, media blocks, code/math rendering,
- clipboard serialization for block-rich-text payloads,
- undo/redo support at the demo layer.

## Important Mismatch

The reusable editor should not depend on the example's `Replica` type.

Current `BlockEditor` in `EditorApp.tsx` takes:

- `replica: Replica`, where `Replica` includes `id`, `actor`, `state: CachedState<RichBlockMeta>`, `selection: RetainedSelectionSet`, online status, queued ops, and a mutable HLC clock.
- callbacks that accept `(replica: Replica) => MultiCommandResult`.
- demo-only props such as online toggle, undo status, key performance sampling, and user ids.

`block-notes` has a different ownership model:

- The source of truth is `editor.$.body`, a `BlockRichText` leaf inside the generic CRDT document.
- Changes should go through the react-crdt editor context, likely using `editor.$.body.$block.ops({ops})` for advanced rich editor commands rather than the current simple placeholder commands.
- Actor/session/timestamp generation is owned by the generic CRDT runtime, not by `blockEditorRuntime.ts`.
- The app can already call `editor.undo()` / `editor.redo()` at the document-history level.

This means the extraction needs an adapter boundary, not just moving files.

## Recommended Shape

Create `src/block-editor` with an exported React component and supporting types, for example:

```ts
export type BlockEditorValue<Meta = RichBlockMeta> = {
    state: CachedState<Meta>;
    selection: RetainedSelectionSet;
};

export type BlockEditorChange<Meta = RichBlockMeta> = {
    state: CachedState<Meta>;
    selection: RetainedSelectionSet;
    ops: Array<Op<Meta>>;
    label?: string;
};

export function BlockRichTextEditor(props: {
    value: BlockEditorValue<RichBlockMeta>;
    readOnly?: boolean;
    userId?: string;
    attachments?: AttachmentStore;
    undoState?: unknown;
    onChange(change: BlockEditorChange<RichBlockMeta>): void;
    onSelectionChange?(selection: RetainedSelectionSet): void;
    onUndo?(): void;
    onRedo?(): void;
}): ReactElement;
```

The exact prop names can change, but the key requirement is that the reusable component deals in `CachedState`, `RetainedSelectionSet`, and emitted block ops. It should not own replica queues, replay history, or document-level persistence.

For `block-notes`, add a thin adapter component that:

- reads `body` with `useValue(editor.$.body)`;
- converts it with `cachedBlockRichTextValue(body)`;
- keeps local retained selection state in React state;
- passes the cached state and selection to `BlockRichTextEditor`;
- applies emitted ops with `editor.$.body.$block.ops({ops})`;
- updates `updatedAt` after edit operations;
- wires `readOnly`, `editor.undo()`, and `editor.redo()`.

## Extraction Plan

1. Move pure editor domain modules first.

   Good candidates for `src/block-editor` are `blockMeta.ts`, `blockCommands.ts`, `multiSelectionCommands.ts`, `selectionModel.ts`, `selectionSet.ts`, `retainedSelection.ts`, `domSelection.ts`, `clipboard.ts`, `inlineMarks.ts`, `inlineEmbeds.ts`, `localTextOps.ts`, `markdownShortcuts.ts`, `virtualParents.ts`, `blockTypeHelpers.ts`, `blockDropTargets.ts`, `pollBlocks.ts`, `annotations.ts`, and focused render helpers.

2. Split `EditorApp.tsx`.

   Keep the demo shell in `examples/block-rich-text`, but extract the reusable `BlockEditor`, editable surface, block renderers, popovers, and toolbar wiring to `src/block-editor`. The extracted component should receive state and callbacks instead of a `Replica`.

3. Keep demo-only runtime in the example.

   `blockEditorRuntime.ts`, `history.ts`, `undoHistory.ts`, `editorAppUtils.ts`, `documentFixtures.ts`, `documentFormat.ts`, `KeyPerfMonitor.tsx`, and import/export history controls can stay in `examples/block-rich-text` initially. The example can import `BlockRichTextEditor` from `src/block-editor` and adapt its `Replica` to the new props.

4. Add package exports.

   Update root `package.json` exports with `./block-editor` and likely `./block-editor/*`, matching the existing `./block-richtext` and `./block-crdt` patterns.

5. Update TypeScript paths.

   `examples/block-rich-text/tsconfig.json` currently maps only `umkehr/block-crdt`. It will need paths for `umkehr/block-editor` during source development. `examples/react-crdt` may already resolve package exports through the repo build, but likely needs the same path or a root build before typechecking.

6. Integrate `block-notes`.

   Replace the placeholder `BlockNotesPanel` body view/button with the editor adapter. Keep the panel chrome from `react-crdt`, but let the actual document body be the reusable editor.

7. Preserve tests while moving.

   The existing block-rich-text tests are valuable. Move unit tests with the modules when practical, and leave integration tests in the example. Add at least one `block-notes` test that verifies typing through the extracted editor updates the `BlockRichText` leaf and participates in undo/redo.

## Likely Implementation Issues

- `RichBlockMeta` is richer than `src/block-richtext`'s current command type. `BlockRichTextSetBlockMetaChange` currently accepts `DefaultBlockMeta`, but the example editor uses `RichBlockMeta`. If `block-notes` should support the full rich editor, `src/block-richtext` should either become generic over meta or widen its exported leaf command types to accept JSON-compatible/custom block meta safely.

- The leaf plugin applies block ops with `applyMany(cachedState(blockStateFromJson(value)), [op])` and does not pass `richTextCrdtConfig`. The example runtime uses `richTextCrdtConfig(replica.state)` to support virtual parents and rich metadata merging. The reusable editor may need the leaf plugin to accept or embed equivalent config for annotations/tables/polls.

- Timestamp generation for advanced commands is currently done through `makeCommandContext(replica)` and `nextReplicaTs(replica)`. In `react-crdt`, timestamps are generated by the document editor when a command is submitted. For multi-op rich commands, using `$block.ops({ops})` means the editor component must generate internal block-crdt Lamport/HLC ids before sending the leaf command. That needs a session/timestamp source from the host or a new builder command that creates rich block ops inside the leaf plugin with the generic runtime timestamp.

- Selection is currently a first-class field on `Replica` but is not stored in `BlockRichText`. For `block-notes`, retained selection probably belongs in component state, not document state. Collaborative remote selection/presence is out of scope unless explicitly requested.

- Attachments are example-local object URLs. If the extracted editor supports image blocks in `block-notes`, it needs a host-provided attachment API or a reduced feature set until document/archive storage is designed.

- Several rich features are UI-heavy and may be too much for a first reusable surface: slides, polls, previews, annotations, image attachments, key performance monitor, fixture import/export, and blog visual demos. The extraction can either include them all as optional host capabilities or explicitly ship an initial "core editor" profile.

- CSS is currently one large example stylesheet. Extracted components need `src/block-editor/style.css` or exported class names plus documentation. `examples/react-crdt/src/style.css` will need to import or include those styles.

- `EditorApp.tsx` contains nested components and helper functions that are not currently exported. A mechanical move will be risky; it is safer to extract around the `BlockEditor` boundary first, then incrementally split render subcomponents.

## Open Questions

- Should `src/block-editor` expose the full feature set from `examples/block-rich-text`, or should the first pass target a smaller notes editor with paragraphs/headings/lists/todos/code/basic marks?

    - let's bring over the full feature set

- Should rich block metadata (`RichBlockMeta`) become the standard meta for `BlockRichText`, or should `src/block-editor` be generic over a host-provided metadata schema?

    - let's bring over the full features set for the src/block-editor for now. we can make it generic/plugin-based later

- How should the reusable editor get timestamps/session ids for multi-op commands when used through `umkehr/react-crdt`?

    - the connection layer needs to provide an HLC timestamp function I imagine

- Should the editor emit raw block ops (`$block.ops`) or should `src/block-richtext` grow higher-level commands for all editor actions?

    - raw os

- Do image attachments, previews, and import/export need to work in `block-notes` immediately? If yes, where should binary/blob attachment data live in `react-crdt` documents?

    - the attachment store should live outside of the crdt. see wordsearch app for artifact handling

- Should retained selection be local component state only, or should it be persisted/presenced somewhere so inactive panes or remote users can show selections?

    - there should be a presence API to communicate selection to connected peers. but not persisted

- Should `block-notes` use the same toolbar and feature controls as the demo, or a simplified toolbar that better fits the `react-crdt` app shell?

    - full feaetures

- Is backwards compatibility for existing serialized `BlockRichText` values required if the meta type or leaf plugin config changes?

    - no backwards compatibility needed

## Suggested First Milestone

Build a minimal but real integration:

- extract enough modules to render and edit paragraphs/headings/lists/basic marks in `src/block-editor`;
- keep selection locally in `BlockNotesPanel`;
- apply emitted ops through `editor.$.body.$block.ops({ops})`;
- leave demo-only two-replica history and fixture tooling in `examples/block-rich-text`;
- verify with `npm run typecheck:examples` and targeted React tests for `block-notes`.

After that works, migrate richer features one group at a time: clipboard, slash menu, tables, annotations, media/previews, slides/polls.
