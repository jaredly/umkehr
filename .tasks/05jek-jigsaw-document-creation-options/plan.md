# Plan: Jigsaw Document Creation Options

## Decisions From Research

- Required document init params apply to every runtime mode: solo, local simulator, PeerJS host, server, and local-first.
- A required-init app should show the document manager when either:
  - the URL has no explicit current `doc`, or
  - the selected/default document id has no persisted or seed-backed document.
- Creating a document from the modal should keep existing behavior: save the new document and leave switching/opening as a separate user action.
- Jigsaw piece count should live only in the board artifact, not in CRDT state.
- Seed documents can bypass blank-document init params because seeds already define their own state/artifacts.
- The jigsaw creation UI can default to `12` pieces.

## Phase 1: Add A Generic Document Init Contract

Update `examples/react-crdt/src/lib/crdtApp.ts`.

Add an app-level document initialization contract, keeping existing apps source-compatible:

```ts
export type DocumentInitParams = Record<string, unknown>;

export type AppDocumentInitializer<TState, TInit extends DocumentInitParams = DocumentInitParams> = {
    required?: boolean;
    defaultParams(): TInit;
    renderFields(props: {
        value: TInit;
        onChange(value: TInit): void;
    }): ReactElement;
    validate(value: TInit): {success: true; data: TInit} | {success: false; message: string};
    initialState(params: TInit): TState;
    initialArtifacts?(params: TInit): SerializedArtifact[];
};
```

Add `documentInit?: AppDocumentInitializer<TState, any>` to `AppDefinition`.

Update creation helpers:

- `createInitialHistory(app, initParams?)`
- `createInitialCrdtHistory(app, initParams?)`

Both helpers should use `app.documentInit.initialState(validParams)` when document init is present, otherwise keep using `app.initialState`.

Add a helper for initial artifacts at the app level:

```ts
initialArtifactsForApp(app, initParams?)
```

It should use `app.documentInit.initialArtifacts(validParams)` when available, otherwise fall back to `initialArtifactsForStore(app.artifacts)`.

Keep `initialArtifactsForStore` unchanged for callers that only have a store.

## Phase 2: Add Jigsaw Init Params

Update jigsaw files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/model.ts` if exports need to move through the existing barrel.

In `artifacts.ts`:

- Export a validator/type guard for `JigsawPieceCount` if useful.
- Add a pure helper that does not rely on module-level `loadedBoard`:

```ts
export function initialJigsawArtifacts(pieceCount: JigsawPieceCount): SerializedArtifact[];
```

This should serialize `generateJigsawBoard(pieceCount)`.

Keep the existing `jigsawArtifactStore.createInitial()` default behavior for compatibility, but route it through the new helper using `DEFAULT_JIGSAW_PIECE_COUNT`.

In `JigsawApp.tsx`, add `documentInit`:

- `required: true`
- `defaultParams(): {pieceCount: 12}`
- `renderFields`: render a labeled select or compact option control for `12`, `30`, `60`, `120`
- `validate`: accept only the four supported piece counts
- `initialState`: return `{positions: {}, connections: {}}`
- `initialArtifacts`: call `initialJigsawArtifacts(params.pieceCount)`

The rendered field should have a stable accessible label such as `Number of pieces` for Playwright coverage.

## Phase 3: Extend The Document Manager Form

Update `examples/react-crdt/src/lib/documentArchive/index.tsx`.

Add a creation config prop, likely:

```ts
createOptions?: AppDefinition<unknown>['documentInit'];
initialOpen?: boolean;
```

Update `onCreateDocument` to receive init params:

```ts
onCreateDocument(input: {
    docId: string;
    title: string;
    initParams?: unknown;
}): Promise<void> | void;
```

Document manager behavior:

- Keep the existing title input, label, button text, seed section, import/export behavior, and document rows.
- Initialize the create-options local state from `createOptions.defaultParams()`.
- Render `createOptions.renderFields(...)` inside the new-document form when present.
- Run `createOptions.validate(...)` before submit.
- Disable the `New document` button if title is blank or the init params are invalid.
- Surface validation/create errors through the existing modal message area.
- If `initialOpen` is true, start with the modal visible.

Do not auto-switch after create; keep the current "Document created" flow.

## Phase 4: Preserve "No Current Document" State

Update `examples/react-crdt/src/lib/useUrlSelection.ts`.

Add a helper that reads the explicit `doc` value without applying a fallback:

```ts
export function readOptionalActiveDocIdFromSearch(search: string): string | undefined;
```

Keep `readActiveDocIdFromSearch(search, fallback)` unchanged for existing behavior where appropriate.

Add tests in `useUrlSelection.test.ts` for the optional helper:

- no `doc` returns `undefined`
- blank/whitespace `doc` returns `undefined`
- present `doc` returns the trimmed value

## Phase 5: Runtime Creation Plumbing

Update all runtime wrappers so blank-document creation passes init params into state and artifact creation.

Files:

- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`

For each mode:

- Pass `app.documentInit` to `DocumentManagerModal` as the creation config.
- Pass `initialOpen` when the app requires init and there is no usable current document.
- Change `createBlankDocument` callback types to accept `initParams`.
- Use `createInitialHistory(app, initParams)` or `createInitialCrdtHistory(app, initParams)`.
- Use `initialArtifactsForApp(app, initParams)` instead of `initialArtifactsForStore(app.artifacts)` for blank documents.
- Keep seed creation unchanged except where existing seed artifact handling is clearly wrong.

Mode-specific details:

- Solo: `loadOrCreateSoloDocument` needs a path that can report "needs document selection" instead of creating a missing required-init document.
- Local simulator: `initialReplicaHistories(app, initParams)` should create every replica from the same parameterized initial state.
- PeerJS: apply creation options to host mode only; client mode remains host-snapshot driven and should not show the document manager.
- Server: login/user selection still happens first. After identity exists, a missing required-init document should show document management rather than creating `runtime.docId`.
- Local-first: do not acquire a tab lock for `runtime.docId` when there is no explicit/usable document for a required-init app. Show document management first, then switch/reload into the created or opened doc as the existing flow does.

## Phase 6: Required-Init Missing Document Behavior

Implement the resolved behavior consistently:

- If the URL has no explicit `doc` and `app.documentInit.required` is true, do not auto-create a document.
- If a `doc` is selected but no persisted document or seed fixture exists for that id and `app.documentInit.required` is true, do not auto-create it.
- In both cases, render the app chrome with the document manager initially open.
- The user can create a document with required params, create a seed, import an archive, or open an existing document.
- Closing the modal without choosing a document should leave a visible document manager trigger and no broken editor state.

Implementation can use a small `LoadState` branch such as `needsDocument` in each mode instead of overloading `null` histories. Prefer explicit states over sentinel empty doc ids.

Existing non-required apps must keep auto-creating their default documents.

## Phase 7: Tests

Add or update unit tests:

- `crdtApp` helper coverage for default app initialization vs documentInit initialization.
- `initialArtifactsForApp` uses app-level initial artifacts when provided.
- `useUrlSelection` optional doc helper behavior.
- Jigsaw document init validation accepts only `12`, `30`, `60`, `120`.
- Jigsaw initial artifacts use the requested `pieceCount`.

Add Playwright coverage:

- Jigsaw local mode with no explicit `doc` opens the document manager and does not silently create the default jigsaw document.
- Jigsaw local mode with a missing explicit `doc` also opens the document manager instead of auto-creating.
- Creating a jigsaw document with `30` pieces shows the document row but does not auto-switch.
- Opening that document shows `30 piece hue puzzle` in the jigsaw panel.
- Todo document creation still works with only a title.
- PeerJS client still does not show the document manager.

Update `examples/react-crdt/tests/helpers/documents.ts` to optionally fill app-specific creation fields, preserving existing helper calls for todos/whiteboard.

## Phase 8: Verification

Run focused tests first:

```sh
cd examples/react-crdt
npm exec vitest -- run src/lib/useUrlSelection.test.ts src/apps/jigsaw/jigsaw.test.ts
npm exec vitest -- run src/lib
```

Run relevant Playwright tests:

```sh
cd examples/react-crdt
pnpm test:e2e -- tests/documents/document-manager.spec.ts tests/smoke/jigsaw-solo.spec.ts
```

If package scripts differ, use the closest existing Vitest and Playwright commands from `package.json`.

Manual checks:

- Open jigsaw without `doc`; modal appears instead of an editor backed by an implicit document.
- Create a `12`, `30`, `60`, and `120` piece document and verify each opens with the expected title/progress.
- Open an existing jigsaw document and confirm its artifact still determines piece count.
- Confirm todo/whiteboard/rich-notes/block-notes/wordsearch still auto-create as before.

## Risks And Watchpoints

- Artifact loading is global per app store. Make sure opening a document loads its serialized jigsaw board before `JigsawPanel` renders.
- The server and local-first flows have more load states than solo/local/PeerJS. Keep the "needs document" state explicit to avoid accidental default replica creation.
- Existing document-manager tests rely on stable labels and button names. Preserve `New document title` and `New document`.
- Do not migrate existing jigsaw documents; artifact-only piece count means imported or persisted documents should continue to use their saved board artifact.
