# Research: Jigsaw Document Creation Options

## Goal

The jigsaw puzzle in `examples/react-crdt` needs document creation options. The first option is the number of pieces, matching the original jigsaw task's creation-time choices: `12`, `30`, `60`, or `120`.

This is broader than a jigsaw-only UI change because the document management modal is shared by all app/mode combinations, and the existing app model assumes every app has a static, parameterless initial document.

## Current Behavior

Relevant files:

- `examples/react-crdt/src/lib/crdtApp.ts`
- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- `examples/react-crdt/src/lib/artifacts/index.ts`
- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/schema.ts`

`AppDefinition` currently exposes a static `initialState`:

```ts
type AppDefinition<TState, ...> = {
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    artifacts?: ArtifactStore;
    // ...
};
```

The creation helpers in `crdtApp.ts` are parameterless:

```ts
createInitialHistory(app)
createInitialCrdtHistory(app)
```

Artifacts are also initialized without parameters:

```ts
type ArtifactStore = {
    createInitial?(): SerializedArtifact[];
};

initialArtifactsForStore(store)
```

The shared document modal only collects a title and calls:

```ts
onCreateDocument({docId, title})
```

Each runtime mode then creates a blank document independently:

- Solo: `createInitialHistory(app)`
- Local simulator: one `createInitialCrdtHistory(app)` per replica plus `initialArtifactsForStore(app.artifacts)`
- PeerJS host: `createInitialCrdtHistory(app)` plus `initialArtifactsForStore(app.artifacts)`
- Server: `createInitialCrdtHistory(app)` plus `initialArtifactsForStore(app.artifacts)`
- Local-first: `createInitialCrdtHistory(app)` plus `initialArtifactsForStore(app.artifacts)`

Each mode also auto-creates a document when its active document cannot be loaded. Examples:

- `loadOrCreateSoloDocument`
- `loadOrCreateLocalSimulatorDocument`
- `loadOrCreatePeerJsDocument`
- `loadInitialState` in server mode
- `loadInitialState` in local-first mode

For solo/local/PeerJS the active id is currently read with a fallback default:

```ts
readActiveDocIdFromSearch(window.location.search, defaultDocId)
```

Server and local-first similarly fall back to `runtime.docId`.

## Jigsaw State

Jigsaw stores board geometry as an artifact, not in CRDT state.

`JigsawState` is only:

```ts
type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

The board is a `JigsawBoardArtifact`, generated in `artifacts.ts`:

```ts
export type JigsawPieceCount = 12 | 30 | 60 | 120;

export function generateJigsawBoard(pieceCount: JigsawPieceCount): JigsawBoardArtifact;
```

Current default artifact creation always uses `DEFAULT_JIGSAW_PIECE_COUNT`, which is `12`:

```ts
createInitial() {
    loadedBoard = generateJigsawBoard(DEFAULT_JIGSAW_PIECE_COUNT);
    return [serializeBoard(loadedBoard)];
}
```

So the new `pieceCount` option must flow into artifact creation. It does not need to change `JigsawState` unless we decide the CRDT state should redundantly record the board choice. Existing export/import already persists the board artifact, so the option mainly matters at creation time.

## Suggested Design

Add a generic document initialization layer to app definitions rather than special-casing jigsaw in every runtime.

One possible shape:

```ts
export type DocumentInitParams = Record<string, unknown>;

export type AppDocumentInitializer<TState, TInit extends DocumentInitParams = {}> = {
    required: boolean;
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

Then `AppDefinition` can expose something like:

```ts
documentInit?: AppDocumentInitializer<TState, any>;
```

For existing apps, absence of `documentInit` means current behavior: static `initialState`, no extra fields, and auto-create is allowed.

For jigsaw:

- `documentInit.required` should be `true`.
- `defaultParams()` should probably return `{pieceCount: 12}`.
- `renderFields` should render a labeled `select` or segmented/radio control for `12`, `30`, `60`, `120`.
- `initialState(params)` should return `{positions: {}, connections: {}}`.
- `initialArtifacts(params)` should return the serialized board from `generateJigsawBoard(params.pieceCount)`.

This keeps the shared modal generic while letting each app own its initialization UI and validation.

## Creation Helper Changes

Introduce parameterized creation helpers in `crdtApp.ts`, for example:

```ts
createInitialHistory(app, initParams?)
createInitialCrdtHistory(app, initParams?)
```

These helpers should use:

- `app.documentInit.initialState(initParams)` when present
- `app.initialState` otherwise

Similarly, update artifact helpers:

```ts
initialArtifactsForStore(store, initParams?)
```

or move artifact initialization onto `app.documentInit` so the state and artifacts are created together:

```ts
initialArtifactsForApp(app, initParams?)
```

The second option is cleaner for jigsaw because the piece count is app-specific. Passing unknown init params through `ArtifactStore` would make a generic storage primitive know about app initialization.

## Document Modal Changes

Update `DocumentManagerModal` so `onCreateDocument` accepts the app-specific params:

```ts
onCreateDocument(input: {
    docId: string;
    title: string;
    initParams?: unknown;
})
```

The modal should receive a creation config from the active app, render its fields inside the existing "new document" form, validate before enabling/submitting, and pass the parsed params to the mode-specific create callback.

The current helpers/tests use the label `New document title` and button text `New document`; those can remain stable. Add a test helper path for selecting jigsaw piece count rather than changing the existing helper contract.

## Auto-Creation Changes

The task's second requirement is that loading the page without a current document should show the document manager instead of auto-creating a document when required params exist.

Current code usually erases the distinction between "no doc selected" and "default doc selected" by applying a fallback immediately. To support this requirement, each mode needs to preserve whether the URL/search state had an explicit `doc` param.

Suggested approach:

1. Add a shared helper, e.g. `readOptionalActiveDocIdFromSearch(search)`.
2. In each mode, compute:

   ```ts
   const explicitDocId = readOptionalActiveDocIdFromSearch(window.location.search);
   const requiresInit = app.documentInit?.required === true;
   const activeDocId = explicitDocId ?? (requiresInit ? '' : defaultDocId);
   ```

3. If `requiresInit && !explicitDocId`, do not call the mode's `loadOrCreate...` function. Render the normal app chrome with `DocumentManagerModal` forced open.
4. After the user creates or opens a document, switch to that document as usual.

The modal currently owns its internal `open` state and starts closed. It will need a controlled or initial-open option, such as:

```ts
initialOpen?: boolean;
forceOpen?: boolean;
onRequestClose?: () => void;
```

For this task, `initialOpen` may be enough if the app renders a "no document selected" shell with the document picker and no editor panel. If the user closes the modal without selecting/creating a document, the shell should still offer a visible document manager trigger or reopen it.

Important: the load/create functions should still auto-create for apps without required init params so existing examples keep their current behavior.

## Mode-Specific Implementation Notes

Solo:

- `loadOrCreateSoloDocument` currently creates a blank history when no persisted/seed document exists.
- Gate that behavior when `app.documentInit?.required` and there is no explicit doc id.
- `createBlankDocument` should pass init params to `createInitialHistory(app, initParams)`.

Local simulator:

- `initialReplicaHistories(app)` should accept init params and create each replica from the same initial state.
- `createBlankDocument` should use parameterized initial histories and parameterized initial artifacts.
- `loadOrCreateLocalSimulatorDocument` should not auto-create a required-init app without explicit params.

PeerJS:

- Only host mode has the document manager. Client mode follows the host snapshot and should not show creation options.
- Host `createBlankDocument` and `loadOrCreatePeerJsDocument` need the same gating/params.

Server:

- Server login can happen before the document is loaded. The "needs params" state should not bypass login.
- After login, if no explicit doc id and jigsaw requires params, show a document selection/creation state instead of creating `runtime.docId`.
- `createBlankDocument` should pass init params into the CRDT history and artifacts.

Local-first:

- `loadInitialState` currently acquires a tab lock for the default doc and creates a replica if none exists.
- For required-init apps with no explicit doc id, avoid taking a lock on `runtime.docId`; show the modal first.
- Once a user creates a document, switch/reload into that doc id as the existing code does.

## Jigsaw Implementation Notes

`jigsawArtifactStore` currently mutates module-level `loadedBoard` when `createInitial()` is called. For parameterized creation, prefer an explicit helper that serializes a generated board without relying on global store mutation:

```ts
export function initialJigsawArtifacts(pieceCount: JigsawPieceCount): SerializedArtifact[] {
    return [serializeBoard(generateJigsawBoard(pieceCount))];
}
```

`serializeBoard` is currently private, so it may need to be exported or wrapped.

When a new jigsaw document is created, the current store should also be loaded with the new board before the panel renders. Saving the serialized artifacts and then flowing through the existing document load path will do that. If the create action does not automatically switch to the new document, make sure the modal still shows it correctly and opening it loads the artifact.

The jigsaw panel reads `currentJigsawBoard()` at render time. That means artifact loading must happen before rendering the panel for the active document, as it already does in most load paths.

## Tests To Add

Focused unit tests:

- Jigsaw document init validates only `12`, `30`, `60`, `120`.
- Jigsaw initial artifacts use the requested `pieceCount`.
- Existing apps without `documentInit` still create their default initial state.

Playwright coverage:

- In jigsaw local mode with no explicit `doc`, the document manager opens instead of silently creating the default jigsaw document.
- Creating a jigsaw document with `30` pieces shows `30 piece hue puzzle` in the panel after opening/switching.
- Existing todo document creation still works with only a title.
- PeerJS client still does not show the document manager.

Regression tests may need updates in `tests/helpers/documents.ts` to optionally fill creation fields.

## Open Questions

1. Should the modal auto-open only when the URL has no `doc` parameter, or also when the selected/default document id has no persisted document? The task says "without a current document", but current code treats the default id as current even when no document exists.
    - both
2. After creating a document from the modal, should the app immediately switch/open it? Current create behavior saves the document and leaves switching as a separate user action.
    - leave as is
3. Should required init params apply to every mode, including server and local-first, or only local/solo flows for this task? The shared app model suggests every mode should honor it.
    - all
4. Should jigsaw's piece count live only in the board artifact, or should it also be stored in CRDT state for easier inspection/migration? Existing artifact export/import makes artifact-only sufficient.
    - artifact-only
5. How should seeded jigsaw documents interact with required params? Existing seed creation bypasses "blank document" params; that seems correct because the seed already defines its state/artifacts.
    - it's fine
6. Is `12` the desired default option in the UI, or should the user be forced to make an explicit piece-count choice before the "New document" button enables?
    - sure
