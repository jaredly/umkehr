# Rich notes example plan

## Goal

Add a rich-text notes app to the existing `examples/react-crdt` demo harness.

Target behavior from the answered open questions:

- Implement the app under `examples/react-crdt/src/apps`, not as a separate `examples/rich-crdt` package.
- Let the existing harness provide sync modes, persistence, undo/redo, and document hosting.
- Keep selected note as local UI state reflected in `location.hash`, not shared CRDT state.
- Derive each note title from the first line of the rich-text body.
- Support create, select, rich-text edit, and archive.
- Include the app in examples documentation and root example typechecking.

## Phase 1: Define the rich notes app model

Add a new app directory, probably `examples/react-crdt/src/apps/rich-notes/`.

1. Create `schema.ts`.
2. Define the document state around notes keyed by id:

```ts
type RichNote = {
    id: string;
    body: RichCollaborativeText;
    createdAt: string;
    updatedAt: string;
    archived: boolean;
};

type RichNotesState = {
    notes: Record<string, RichNote>;
};
```

3. Do not include `selectedNoteId` in CRDT state.
4. Import `RichCollaborativeText` and `richText()` from `umkehr/richtext`.
5. Use `typia.json.schemas<[RichNotesState], '3.1'>()` and `typia.createValidate<RichNotesState>()`.
6. Set a new stable doc id, for example `umkehr-react-crdt-rich-notes-v1`.
7. Seed at least two useful starter notes:
   - bodies should use `richText()` initially, or `richTextFromSpans()` if the existing document creation path accepts seeded snapshots directly.
   - if snapshots cannot be used in initial state, keep seed bodies empty and rely on app copy/placeholders rather than introducing unsupported initialization.
8. Export `initialRichNotesTimestamp = hlc.pack(hlc.init('seed', 0))`.

Acceptance check:

- The schema emits rich-text metadata for `body`.
- The initial state is valid according to `validateRichNotesState`.
- There is no shared selection field in state.

## Phase 2: Create providers and app definition

Follow the existing `todos` and `whiteboard` pattern.

1. Create `model.ts`.
2. Export:
   - `ProvideRichNotesHistory` / `useRichNotesHistory` from `createHistoryContext`.
   - `ProvideRichNotes` / `useRichNotes` from `createSyncedContext<RichNotesState>('type')`.
   - schema/state/doc-id exports from `schema.ts`.
3. Create `RichNotesApp.tsx`.
4. Export `richNotesApp: AppDefinition<RichNotesState>`.
5. Export `richNotesCrdtRuntime: CrdtRuntime<RichNotesState>`.
6. Export `richNotesHistoryRuntime: HistoryRuntime<RichNotesState>`.
7. Set app metadata:
   - `id: 'rich-notes'`
   - `title: 'Rich Notes'`
   - `schemaVersion: 1`
   - `tagKey: 'type'`
8. Render a `RichNotesPanel` from `renderPanel`.

Acceptance check:

- The new app compiles independently before registration.
- The app definition shape matches the existing registry types.

## Phase 3: Build local note selection with URL hash

Selection should be local-only but deep-linkable.

1. In `RichNotesPanel`, read active non-archived note ids from `editor.latest()` or `useValue`.
2. Initialize local selected id from `location.hash`.
   - Use a stable hash format such as `#note=<id>` or `#rich-note=<id>`.
   - If the hash id is missing, archived, or unknown, select the first active note.
3. On selection change, update local state and `location.hash`.
4. Listen for `hashchange` so browser back/forward can move between notes.
5. If the selected note becomes archived or deleted, select the next active note and update the hash.

Acceptance check:

- Different replicas/browser panes can select different notes.
- Reloading with a note hash selects that note when it exists.
- Selection never writes to CRDT document state.

## Phase 4: Implement notes sidebar

Create a sidebar component or keep it inside `RichNotesPanel` if it stays simple.

1. Render active notes sorted by `updatedAt` descending.
2. Render archived notes separately or behind a compact toggle.
   - Minimum required behavior: archived notes should no longer appear in the main active list.
   - Prefer a small "Archived" section/toggle so archive remains demonstrable and reversible if practical.
3. Derive each title from the first line of the rich-text plain text:
   - trim leading/trailing whitespace;
   - split on newline;
   - use `Untitled` for an empty first line.
4. Show a last modified date using local formatting.
5. Add a create-note button.
   - Create a new note with `body: richText()`, current ISO timestamps, and `archived: false`.
   - Select the new note locally after creation.
6. Add archive control for the selected note or each sidebar row.
   - Set `archived: true` and update `updatedAt`.
   - If an archived section is implemented, support unarchive by setting `archived: false`.
7. Respect `readOnly` by disabling create/archive/unarchive actions.

Acceptance check:

- The sidebar shows title and last modified date for each active note.
- Creating a note adds it and selects it.
- Archiving removes it from the active list and moves selection to another active note.

## Phase 5: Implement rich editor panel

The main panel should exercise `RichTextEditor` directly.

1. For the selected note, call `editor.useRichText(editor.$.notes[selectedId].body)`.
2. Render `RichTextEditor` in the main panel with an appropriate `ariaLabel`.
3. Wrap the rich-text binding commands so body edits also update `updatedAt`.
   - Wrap `insert`, `delete`, `mark`, `unmark`, and `replace`.
   - Touch the note with `editor.$.notes[id].updatedAt(new Date().toISOString())`.
   - Avoid touching on no-op command calls when possible.
4. The first line of the body is the title; do not add a separate title input.
5. Render a quiet empty-state when there are no active notes.
   - Include a create button unless `readOnly`.
6. Preserve undo/redo behavior by dispatching edits through the normal editor commands.

Acceptance check:

- Typing in the rich editor updates body content and sidebar title.
- Rich-text marks still work through the existing editor toolbar/shortcuts.
- Sidebar modified dates update after body edits and archive/unarchive changes.

## Phase 6: Style the notes app

Add scoped styles to `examples/react-crdt/src/style.css`.

1. Use a two-column layout:
   - sidebar around 280-340px;
   - main editor fills remaining space.
2. Keep the UI dense and app-like, not a marketing page.
3. Add stable classes for:
   - `.richNotesPanel`
   - `.richNotesSidebar`
   - `.richNotesList`
   - `.richNoteRow`
   - `.richNoteRowActive`
   - `.richNoteTitle`
   - `.richNoteDate`
   - `.richNotesEditorPane`
   - `.richNotesEditor`
4. Style the `contentEditable` editor area so it is clearly editable:
   - readable line height;
   - enough padding;
   - min height;
   - visible focus state.
5. Add responsive behavior for narrow widths:
   - sidebar can become a top list or narrower column;
   - editor and rows should not overlap.
6. Do not rely on visible instructional text; labels should be normal app UI labels only.

Acceptance check:

- The app is usable in the existing demo shell at desktop and narrow widths.
- Row text/date/buttons do not overlap.
- The editor does not visually collapse when empty.

## Phase 7: Register the app and update docs

1. Update `examples/react-crdt/src/lib/appRegistry.ts`.
2. Import `richNotesApp`, `richNotesCrdtRuntime`, and `richNotesHistoryRuntime`.
3. Add the app to `registeredApps`.
4. Confirm all harness modes that depend on `registeredApps` can select the new app.
5. Update `examples/react-crdt/README.md` to mention the rich notes app.
6. Update `examples/README.md` if it describes the React CRDT example scope.
7. Update root `package.json` `typecheck:examples` if the current script does not already cover the new files through `examples/react-crdt/tsconfig.json`.

Acceptance check:

- The app appears in the demo app selector as `Rich Notes`.
- Root example typecheck covers the new app.
- Docs mention that `examples/react-crdt` includes a rich-text shared notes app.

## Phase 8: Tests and verification

Add focused tests where they are low friction; otherwise rely on typecheck/build plus existing rich-text tests.

1. Add unit tests for pure helpers if introduced:
   - title derivation from rich-text plain text;
   - date sorting;
   - selected-id fallback.
2. Add a component test if existing test setup supports it cleanly:
   - render panel;
   - create a note;
   - select a note;
   - archive a note.
3. Run focused checks:
   - `pnpm --dir examples/react-crdt build`
   - `pnpm --dir examples/react-crdt test:e2e:smoke` if practical.
4. Run root example typecheck:
   - `pnpm run typecheck:examples`

Acceptance check:

- TypeScript passes for the example.
- The Vite build passes.
- The app can be opened through the existing demo and edited manually.

## Implementation notes

- Prefer reusing existing `AppDefinition`, runtime, and context patterns instead of creating a new harness.
- Keep note selection local and URL-backed; never add it to `RichNotesState`.
- Store only collaborative document data in CRDT state: note records, rich-text bodies, timestamps, and archive status.
- The first-line title should be derived from materialized rich-text `plainText`, not separately stored.
- `updatedAt` can be wall-clock ISO time; this app is a demo, not a strict conflict-free timestamp system.
- If creating seeded rich-text content is awkward with the current APIs, start with empty notes rather than forcing a new initialization path.
