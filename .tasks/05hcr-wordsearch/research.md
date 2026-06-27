# Research: React CRDT Wordsearch App

## Goal

Add a `wordsearch` app to `examples/react-crdt`. The app should initialize from an immutable 8x8 word-search puzzle artifact, show a word bank at the bottom, let users drag/select words on the grid, use presence/status to show in-progress selections from other users, and persist found words in CRDT state.

The important collaboration rule is: once a word is found, later finds of that same word should be rejected by the UI. If multiple users find the same word concurrently, the first finder wins.

The puzzle definition itself should not be CRDT state. Board contents and word locations are immutable artifact data; only collaborative finds need CRDT conflict resolution.

## Relevant Existing Structure

`examples/react-crdt/src/App.tsx` is only the shell. It reads the selected app from `lib/appRegistry.ts` and renders it in one of the supported modes:

- `solo`
- `local`
- `local-first`
- `server`
- `peerjs`

Existing app modules live under `examples/react-crdt/src/apps/*` and expose the same three exports:

- `AppDefinition<TState, ...>`
- `CrdtRuntime<TState, ...>`
- `HistoryRuntime<TState>`

Good reference apps:

- `examples/react-crdt/src/apps/todos/*`: simple persistent state, history/synced contexts, registry entry, app panel split into components.
- `examples/react-crdt/src/apps/whiteboard/*`: ephemeral messages and selection presence/status.
- `examples/react-crdt/src/apps/rich-notes/*`: simple Typia schema generation with `typia.json.schemas` and `typia.createValidate`.
- `examples/block-rich-text/src/attachments.ts` and image block metadata: the document stores stable attachment ids, while image bytes/object URLs live outside the CRDT document.

The new app should likely live in:

- `examples/react-crdt/src/apps/wordsearch/WordsearchApp.tsx`
- `examples/react-crdt/src/apps/wordsearch/WordsearchPanel.tsx`
- `examples/react-crdt/src/apps/wordsearch/model.ts`
- `examples/react-crdt/src/apps/wordsearch/schema.ts`
- `examples/react-crdt/src/apps/wordsearch/artifacts.ts`
- optional helper/test files such as `wordsearch.ts`, `selection.ts`, or `helpers.test.ts`

Then register it in `examples/react-crdt/src/lib/appRegistry.ts` by importing the app/runtime exports and adding a new `RegisteredApp<WordsearchState>` entry.

## App Contract

`lib/crdtApp.ts` defines the app surface:

```ts
export type AppDefinition<TState, EphemeralData = never> = {
    id: string;
    title: string;
    schemaVersion: number;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    renderPanel(props: AppPanelProps<TState, EphemeralData>): ReactElement;
};
```

For wordsearch, start with no custom ephemeral data and use the built-in status store for presence selection. The model can mirror the todo/whiteboard setup:

```ts
export const [ProvideWordsearchHistory, useWordsearchHistory] =
    createHistoryContext<WordsearchState, never, 'type'>('type');

export const [ProvideWordsearch, useWordsearch] =
    createSyncedContext<WordsearchState>('type');
```

## State Shape And Puzzle Artifacts

The task proposes:

```ts
type State = {
    board: string[][],
    words: {start: {x:number,y:number}, end: {x:number,y:number}}[],
    found: {[word: number]: {[userId: string]: number /* timestamp found */}}
}
```

Updated direction: keep only mutable finds in CRDT state. The document has exactly one immutable puzzle artifact whose artifact id is the literal string `"puzzle"`. The board and word placements are immutable artifact data, analogous to how block-rich-text image blocks refer to image attachments by id instead of embedding image bytes into CRDT text/block state.

Recommended CRDT state:

```ts
type WordsearchState = {
    found: Record<string, Record<string, number>>;
};
```

Recommended puzzle artifact:

```ts
type WordEntry = {
    text: string;
    start: GridPoint;
    end: GridPoint;
};

type WordsearchPuzzleArtifact = {
    id: string;
    title: string;
    board: string[][];
    words: WordEntry[];
};
```

Reasoning:

- The UI needs the displayed word text, board, and word placements, but those values never change once the puzzle is chosen. Giving them CRDT metadata wastes space and implies mutability that the app should not expose.
- The artifact id is fixed as `"puzzle"`, so the CRDT document does not need a `puzzleId` field. This matches the app constraint that each document has one puzzle.
- The initial app can ship a tiny in-memory artifact registry containing the `"puzzle"` artifact. That gives `examples/react-crdt` a first simple artifact mechanism without solving uploads, persistence, or binary storage yet.
- Use `Record<string, ...>` for `found` keys because JSON object keys are strings even when word indexes are numeric.
- Store timestamp as a number if we want the task shape literally, probably `Date.now()` from the client. If deterministic CRDT ordering is more important than wall-clock time, use HLC strings instead and update the type accordingly.

Initial state:

```ts
export const initialWordsearchState: WordsearchState = {
    found: {},
};
```

Artifact registry:

```ts
export const WORDSEARCH_PUZZLE_ARTIFACT_ID = 'puzzle';

export const wordsearchPuzzleArtifact: WordsearchPuzzleArtifact = {
    id: WORDSEARCH_PUZZLE_ARTIFACT_ID,
    title: 'Starter 8x8',
    board: [
        // fixed 8x8 rows
    ],
    words: [
        // fixed placements
    ],
};
```

The panel should resolve `const puzzle = wordsearchArtifactStore.get('puzzle')` and render a missing-artifact fallback if the artifact is unavailable. The fallback is still useful because synced documents can outlive bundled artifact definitions if this example evolves.

This avoids the PRNG determinism problem. A seed-based generator would work, but then old documents depend on keeping every historical generator version bit-for-bit stable. A fixture artifact id is simpler and makes the puzzle definition inspectable in tests.

## Artifact Machinery

`examples/react-crdt` does not currently have a generic artifact layer. This task can introduce the smallest useful version:

```ts
type ArtifactStore<TArtifact extends {id: string}> = {
    get(id: string): TArtifact | null;
};
```

For the first implementation, this can be app-local in `apps/wordsearch/artifacts.ts`:

```ts
export const wordsearchArtifactStore: ArtifactStore<WordsearchPuzzleArtifact> = {
    get: (id) => (id === WORDSEARCH_PUZZLE_ARTIFACT_ID ? wordsearchPuzzleArtifact : null),
};
```

If this becomes shared later, possible integration points are:

- Extend `AppDefinition` with optional read-only artifact providers.
- Let app panels receive artifact access through `AppPanelProps`.
- Include artifact manifests in server/local-first document bootstrap metadata.

Do not build those broader APIs unless wordsearch needs them. The important architectural precedent is immutable puzzle data lives outside CRDT state as a named artifact, even when the artifact id is implicit for this one-puzzle document.

## Finding Words

The grid interaction should normalize a drag/select gesture into:

```ts
type WordsearchSelection = {
    start: GridPoint;
    end: GridPoint;
};
```

Selection validation uses the resolved puzzle artifact:

- Allow straight-line horizontal, vertical, and diagonal selections.
- Accept reversed selections so dragging from end to start still finds the word.
- Match against `puzzle.words[index].start/end` in either direction.
- Reject selections that do not exactly span a configured word.
- Reject a find if `Object.keys(found[wordIndex] ?? {}).length > 0`.

When committing a successful find:

```ts
editor.dispatch({
    op: 'add',
    path: [
        {type: 'key', key: 'found'},
        {type: 'key', key: String(wordIndex)},
        {type: 'key', key: actor},
    ],
    value: Date.now(),
});
```

If `found[wordIndex]` may not exist, do not assume a nested `add` creates missing parent records. Either initialize all word indexes in `initialState.found` for the puzzle artifact, or dispatch a patch that creates `found[wordIndex]` first and then sets the actor timestamp. Keeping `found` sparse is cleaner and avoids making initial CRDT state depend on the artifact's word count.

First-finder derivation:

```ts
function firstFinder(foundForWord: Record<string, number> | undefined) {
    return Object.entries(foundForWord ?? {}).sort(
        ([actorA, timeA], [actorB, timeB]) => timeA - timeB || actorA.localeCompare(actorB),
    )[0] ?? null;
}
```

This satisfies "first finder wins" after concurrent CRDT merges because concurrent actor entries can coexist in the nested record and the UI derives a single winner by earliest timestamp plus stable actor tie-break.

Risk: `Date.now()` is not globally authoritative. If users' clocks differ, "first" means earliest client-reported time, not causally first. See open questions.

## Presence And Status

There are two existing mechanisms:

- Ephemeral messages via `editor.publishEphemeral` / `editor.useEphemeral`, used heavily by whiteboard for live previews.
- Status records via `StatusStore`, surfaced with `useStatuses(path, {kinds})`, used for server/local selection and last-edit indicators.

The task specifically asks for "Presence & status", so status records are the right fit for in-progress selections.

Current limitation: `AppPanelProps` only exposes:

```ts
setPresenceSelection?(elementId: string | null): void;
```

The local/server plumbing currently interprets that `elementId` as a whiteboard element id and creates statuses with kind `presence:whiteboard-selection` at path `['elements', elementId]`.

Options:

1. Minimal reuse: encode a wordsearch selection as an element id string such as `wordsearch:0,0:3,0`. This is awkward because the server/local helper still stores it under `path: ['elements', encoded]`, which is not meaningful for wordsearch and cannot be consumed with cell paths.
2. Generalize presence selection: change `setPresenceSelection` to accept either a legacy element id or a typed selection payload/path. Add a new status kind such as `presence:wordsearch-selection` and helper `statusForWordsearchSelection`.
3. Use app-local ephemeral messages instead of status records. This avoids shared presence plumbing changes, but does not satisfy the "status" part as directly.

Recommended: option 2 if implementation budget allows. Add a typed presence selection model to the shared local/server plumbing, then keep the whiteboard behavior as one variant. Wordsearch can publish selections keyed to a stable board-level path or individual cell paths.

Potential status data:

```ts
type WordsearchSelectionStatusData = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    start: GridPoint;
    end: GridPoint;
    cells: GridPoint[];
    receivedAt: string;
};
```

Potential path:

```ts
[
    {type: 'key', key: 'found'},
]
```

Because board cells are artifact data rather than CRDT paths, status should not be keyed to `board[y][x]`. Use one app-level CRDT path, probably `[{type: 'key', key: 'found'}]`, and put the selected artifact-space cells in the status payload. The panel can read all `presence:wordsearch-selection` statuses from that path and draw overlays on the artifact board.

## UI Shape

Suggested panel layout:

- Header with title, found count, undo/redo.
- 8x8 board as fixed grid buttons/cells.
- Word bank at bottom.
- Optional small status line for rejected selection or already-found word.

Interaction:

- Pointer down on a cell starts local selection.
- Pointer enter/move updates local selection if dragging.
- Pointer up commits if it matches an unfound word.
- Clear local and remote selection status when pointer drag ends, panel unmounts, or `readOnly` becomes true.

Rendering:

- Local in-progress selection gets the local actor color.
- Remote in-progress selections use presence/status colors.
- Found words use the winner's user color from first-finder derivation.
- Word bank entries show found/unfound state and first finder identity if available.

Color helpers already exist in `lib/server/presence.ts`:

- `colorForUserId`
- `initialForNickname`

Local simulator sessions use `replica-a` blue and `replica-b` green in `lib/local/useLocalDemoSync.ts`.

## Tests To Add

Focused unit tests:

- `cellsForSelection` handles horizontal, vertical, diagonal, and reversed selections.
- `matchingWordIndex` returns the correct index in either direction and rejects partial/nonlinear selections.
- `firstFinder` chooses earliest timestamp and stable tie-break.
- `canFindWord` rejects already-found words.

React tests if existing setup supports it easily:

- Selecting a valid word marks it found and updates the word bank.
- Attempting to select an already-found word does not add another finder.

Integration/e2e smoke might be useful after implementation, but the app registry and build/typecheck are the minimum verification.

Recommended commands:

```sh
cd examples/react-crdt
pnpm build
pnpm test:e2e:smoke
```

`test:e2e:smoke` has historically taken about a minute locally according to the README.

## Implementation Plan

1. Create `apps/wordsearch/schema.ts` with types, Typia schema/validator, deterministic initial state, and fixed timestamp.
2. Create `apps/wordsearch/artifacts.ts` with `WordsearchPuzzleArtifact`, `WORDSEARCH_PUZZLE_ARTIFACT_ID = 'puzzle'`, the puzzle artifact, and a minimal app-local artifact store.
3. Create `apps/wordsearch/model.ts` with history and synced contexts.
4. Create helper functions for selection cells, word matching against a puzzle artifact, first-finder derivation, and status paths.
5. Create `WordsearchPanel.tsx` with artifact resolution, board, word bank, pointer interaction, undo/redo, missing-artifact fallback, and read-only handling.
6. Create `WordsearchApp.tsx` and register it in `lib/appRegistry.ts`.
7. Add CSS to `src/style.css`, keeping it scoped under wordsearch class names.
8. Add focused helper tests.
9. If using generalized presence/status, update `lib/crdtApp.ts`, `lib/local/useLocalDemoSync.ts`, `lib/server/presence.ts`, `lib/server/types.ts`, `lib/server/protocol.ts`, and `lib/server/useServerSync.ts`.
10. Run typecheck/build and relevant tests.

## Open Questions

1. Should "first finder wins" use client wall-clock `Date.now()` numbers as requested, or CRDT/HLC timestamps for deterministic causality-aware ordering?
    - HLC is good
2. Should the first artifact store stay app-local for wordsearch, or should we introduce a shared `examples/react-crdt` artifact API now?
    - let's introduce an artifact API
3. Should artifact availability become part of document validation/bootstrap, or is a runtime missing-artifact fallback sufficient for the example?
    - fallback probably makes the most sense
4. Which directions should be supported? Standard wordsearch allows horizontal, vertical, and diagonal, forward and backward. The task does not explicitly say.
    - yeah let's do it all
5. Should in-progress selections be visible in every sync mode, including solo/history mode, or only CRDT-backed modes where status stores are available?
    - CRDT-backed modes
6. Should generalized presence selection replace the whiteboard-specific `setPresenceSelection(elementId)` API now, or should wordsearch initially use ephemeral messages plus a follow-up to generalize status?
    - presenceEvent looks like it should work fine
7. In server mode, should the protocol persist only the latest selection per actor, as whiteboard does now, or should it support multiple app-specific selection kinds per actor?
    - it's not a selection though ... just use presenceEvents
8. Should a losing concurrent finder remain in `found[wordIndex]` for audit/debugging while the UI displays only the winner, or should later losing entries be cleaned up by a follow-up command?
    - don't worry about cleaning it up
