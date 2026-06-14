# Rich notes example research

## Scope

Build an example app in `examples/rich-crdt` that exercises the collaborative rich-text editor as a small shared notes app: a left sidebar with note title and last modified date, and a main editor panel with rich text editing.

The repo already has the CRDT demo infrastructure in `examples/react-crdt`, plus rich-text CRDT state and React bindings in the package source. The new example can either reuse that infrastructure directly or become a smaller standalone Vite app with only the notes experience.

## Relevant existing code

### Rich-text APIs

- `src/richtext/index.ts` exports the user-facing rich-text value helpers:
  - `richText()` creates an empty `RichCollaborativeText` value.
  - `richTextFromPlainText()` and `richTextFromSpans()` create import snapshots.
  - `materializeRichText()` reads a rich-text field from a CRDT document.
- `src/react-crdt/index.ts` re-exports `RichTextEditor` and `createSyncedContext`.
- `src/react-crdt/react-crdt.tsx` adds `ctx.useRichText(ctx.$.field)` to a synced context. The returned binding has:
  - `view` with `plainText` and `spans`.
  - `commands.insert/delete/mark/unmark/replace`.
- `src/react-rich-text/RichTextEditor.tsx` is a `contentEditable` editor that:
  - applies typed text, deletion, paste, bold, italic, and link commands through `RichTextBinding`.
  - supports HTML paste via `richTextSnapshotFromHtml`.
  - shows a selection toolbar for marks.

### Existing CRDT example structure

- `examples/react-crdt` is a Vite app that already supports solo, local simulator, local-first, server, and PeerJS modes.
- The app registry is in `examples/react-crdt/src/lib/appRegistry.ts`.
- Registered apps implement `AppDefinition` from `examples/react-crdt/src/lib/crdtApp.ts`, with schema, initial state, providers, and `renderPanel`.
- App-specific state modules follow this pattern:
  - `schema.ts` defines the state type, typia schema, validation, document id, and initial state.
  - `model.ts` creates `createHistoryContext` and `createSyncedContext`.
  - `*App.tsx` exports the `AppDefinition`, CRDT runtime, and history runtime.
  - a panel component renders the actual UI.
- Existing styling lives in `examples/react-crdt/src/style.css`, with a substantial demo shell already present.

### Typia and schema support

- `examples/react-crdt/vite.config.ts` uses `@typia/unplugin/vite`.
- Rich-text fields rely on the `RichCollaborativeText` type carrying typia JSON schema plugin metadata:
  - `x-umkehr-crdt: rich-text`
  - `x-umkehr-rich-text-version: 1`
- Any new Vite example that defines a rich-text state schema with typia will need the same plugin setup and TypeScript path aliases for `umkehr/richtext`, `umkehr/react-crdt`, and likely `umkehr/react`.

## Implementation options

### Option A: Add notes as another app inside `examples/react-crdt`

This is the smallest implementation path because the existing app shell already has providers, transports, document persistence, sync modes, undo/redo hooks, and e2e setup.

Expected work:

- Add `examples/react-crdt/src/apps/rich-notes/`.
- Define a state shape roughly like:

```ts
type Note = {
    id: string;
    title: string;
    body: RichCollaborativeText;
    createdAt: string;
    updatedAt: string;
};

type RichNotesState = {
    selectedNoteId: string;
    notes: Record<string, Note>;
};
```

- Use `richText()` for each note body in initial state.
- Register the app in `appRegistry.ts`.
- Render sidebar note rows from `editor.latest().notes`, with title fallback from body/plain text or an explicit `title` field.
- Render `RichTextEditor` with `editor.useRichText(editor.$.notes[noteId].body)`.
- Update `updatedAt` when title/body changes.

Tradeoff: the task specifically says `examples/rich-crdt`, so this may not satisfy the requested location unless the desired outcome is just an app that exercises the editor.

### Option B: Create a new standalone `examples/rich-crdt` app

This matches the task wording. It can copy the necessary Vite/typia setup from `examples/react-crdt`, but should avoid copying the whole multi-mode demo shell unless needed.

Expected work:

- Create `examples/rich-crdt` with `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, and `src/`.
- Depend on `umkehr: link:../..`, `vite`, `typia`, `@typia/unplugin`, React types, and React DOM if not inherited.
- Add TypeScript path aliases for local source use:
  - `umkehr`
  - `umkehr/crdt`
  - `umkehr/richtext`
  - `umkehr/react`
  - `umkehr/react-crdt`
  - possibly `umkehr/react-rich-text`
- Build a simpler local synced context, probably using `createSyncedContext<RichNotesState>('type')`.
- Either reuse the existing local simulator transport code from `examples/react-crdt/src/lib/local` or implement a minimal single-document local transport if the app only needs one browser session.

Tradeoff: this is cleaner as a purpose-built example, but copying transport/persistence code may create drift with `examples/react-crdt`.

## UI and behavior notes

- The app should start on the actual notes UI, not a landing page.
- A two-column app shell fits the request:
  - fixed-width left sidebar around 280-340px;
  - main editor flex panel;
  - compact top/title row;
  - rich editor area with a stable min height.
- Sidebar rows should show:
  - title, either explicit note title or first non-empty line of rich text;
  - last modified date, formatted for local display;
  - selection state.
- Basic note commands expected for this app:
  - create note;
  - select note;
  - edit title;
  - edit rich text body;
  - delete/archive note if in scope.
- The rich editor already covers bold, italic, links, and paste behavior. Styling will need to make the contentEditable area look like an editor rather than a raw div.

## Data model considerations

- `updatedAt` is easiest as a normal string field set from the UI when dispatching title changes or rich-text commands.
- Rich text commands currently happen inside `RichTextEditor`, so updating `updatedAt` on body edits is not automatic from outside unless the panel wraps commands or observes body changes.
- A wrapper around the binding can update `updatedAt` before or after each rich-text command:

```ts
const body = editor.useRichText(editor.$.notes[id].body);
const binding = {
    ...body,
    commands: {
        insert: (...args) => {
            touchNote(id);
            body.commands.insert(...args);
        },
        // same for delete, mark, unmark, replace
    },
};
```

- If `selectedNoteId` is part of shared CRDT state, collaborators will fight over the selected note. Selection should probably be local React state, not document state.
- If presence/cursors are later added, use ephemeral state rather than normal CRDT state.

## Testing and verification ideas

- Typecheck the new example with `tsc -p examples/rich-crdt/tsconfig.json --noEmit`.
- Add a focused component test if test tooling is added locally:
  - create note;
  - select note;
  - edit title;
  - type rich text;
  - verify sidebar title/date update.
- If Playwright is added, smoke test:
  - app loads with sidebar and editor;
  - typing into editor updates content;
  - creating a second note switches editor content.
- Existing rich-text behavior is already covered in `src/react-rich-text/RichTextEditor.test.tsx` and `src/react-crdt/react-crdt.test.tsx`; the example mainly needs integration coverage.

## Risks

- Creating a separate `examples/rich-crdt` may duplicate demo transport code from `examples/react-crdt`.
- `updatedAt` on rich-text edits needs an explicit command wrapper or another signal; otherwise sidebar dates may only update for title changes.
- Rich-text state schema depends on typia plugin metadata; missing aliases or plugin setup could make CRDT schema metadata fail.
- If note selection is stored in CRDT state, multi-user/shared scenarios will feel broken because all replicas share the selected note.
- The existing `RichTextEditor` is intentionally minimal. If the expected app should feel like Apple Notes, additional controls may be needed beyond the current selection toolbar.

## Open questions

- Should this be a brand-new standalone app at `examples/rich-crdt`, or should the rich notes app be registered inside the existing `examples/react-crdt` demo?
  - inside examples/react-crdt/src/apps
- Which sync modes should the example support: just local single-browser editing, local two-replica simulation, local-first persistence, PeerJS, or the server-backed mode?
  - the harness takes care of everything
- Should note selection be local-only UI state, or intentionally shared between collaborators?
  - local UI state / location.hash
- Should the note title be a separate text field, derived from the first line of the rich-text body, or both with a fallback?
  - let's do first line of body
- Is delete/archive required for notes, or is create/select/edit enough for this task?
  - archive
- Should the app persist notes across reloads, or is an in-memory example acceptable?
  - the harness takes care of this
- Do we want this example included in root `typecheck:examples` and examples documentation immediately?
  - yes
