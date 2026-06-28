# Research: Wordsearch Ephemeral Chat

## Goal

Add a small ephemeral chat UI below the `examples/react-crdt` wordsearch board, using existing presence/ephemeral transport only. Chat messages should not be stored in the CRDT document, local storage, host session persistence, or artifacts.

## Relevant Files

- `examples/react-crdt/src/apps/wordsearch/WordsearchPanel.tsx`
- `examples/react-crdt/src/apps/wordsearch/model.ts`
- `examples/react-crdt/src/apps/wordsearch/WordsearchApp.tsx`
- `examples/react-crdt/src/apps/wordsearch/WordsearchPeerJsDemo.tsx`
- `examples/react-crdt/src/lib/crdtApp.ts`
- `examples/react-crdt/src/lib/local/model.ts`
- `examples/react-crdt/src/lib/local/useLocalDemoSync.ts`
- `examples/react-crdt/src/lib/peerjs/usePeerJsSync.ts`
- `examples/react-crdt/src/lib/peerjs/protocol.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt/src/style.css`

## Current State

`wordsearchApp` is registered as an `AppDefinition<WordsearchState, WordsearchEphemeralData>` and renders `WordsearchPanel`.

`WordsearchPanel` already uses ephemeral messages for live word-selection overlays:

- Local drag state is kept in React state.
- Remote selections are read with `editor.useEphemeral({ path: foundRootPath(), kinds: [wordsearchSelectionKind] })`.
- Selection messages are sent with `editor.publishEphemeral(...)`.
- Clear messages use the same `id` per actor plus `clear: true`, so the ephemeral store replaces/removes a user's active selection.

`WordsearchEphemeralData` currently only allows selection data:

```ts
export type WordsearchSelectionEvent = {
    type: 'selection';
    start: GridPoint;
    end: GridPoint;
    cells: GridPoint[];
};

export type WordsearchEphemeralData = WordsearchSelectionEvent;
```

The synced context validates ephemeral payloads via `isWordsearchEphemeralData`, so a chat payload will be rejected unless this union and validator are extended.

## Transport Behavior

The app-level API is already generic enough:

```ts
publishEphemeral(messages: EphemeralMessage<EphemeralData>[]): void;
useEphemeral(query?: EphemeralQuery): EphemeralRecord<EphemeralData>[];
```

Local simulator mode:

- `createDemoTransport` exposes `publishEphemeral` and `subscribeEphemeral`.
- `useLocalDemoSync` broadcasts ephemeral messages only while sync is enabled.
- Ephemeral messages are not queued while sync is disabled.

PeerJS mode:

- `usePeerJsSync` sends messages with `kind: 'ephemeral'`.
- Clients send ephemeral messages to the host.
- The host broadcasts ephemeral messages to all other peers.
- The host currently does not deliver its own published ephemeral message back to its local listeners, so the sending UI should append its own chat message locally when sending rather than relying on receiving its own message from transport.
- Peer protocol validation requires every ephemeral message's `actor` to match the envelope actor and enforces `MAX_PEER_EPHEMERAL_BYTES = 16_384`.

Server mode:

- `useServerSync` wraps ephemeral messages as protocol `presenceEvent`.
- Incoming `presenceEvent` messages are delivered only for the active branch.
- `presenceLeave` clears ephemeral records for the leaving actor.
- Server protocol validation checks the generic ephemeral envelope, but app-level validation still needs to accept chat payloads.

## Suggested Model Shape

Add chat as a second `WordsearchEphemeralData` variant:

```ts
export type WordsearchChatEvent = {
    type: 'chat';
    text: string;
    sentAt: string;
};

export type WordsearchEphemeralData =
    | WordsearchSelectionEvent
    | WordsearchChatEvent;
```

Add constants/helpers near the existing selection helpers:

- `wordsearchChatKind = 'wordsearch:chat'`
- `chatRootPath()`, likely a stable path separate from `foundRootPath()`
- `chatMessage({ actor, text, sentAt, id })`

Chat messages should use unique ids, not one id per actor. Otherwise new messages from the same actor may replace prior ephemeral records depending on the underlying ephemeral store semantics.

The chat validator should enforce at least:

- `type === 'chat'`
- `text` is a string
- trimmed text is non-empty
- bounded text length, for example 280 or 500 characters
- `sentAt` is a non-empty string, preferably an ISO timestamp

The existing selection validator can remain unchanged.

## Suggested UI Placement

Place a compact chat component inside `WordsearchPanel`, after the word bank/status area, so it appears below the wordsearch and shares the same editor context in all modes. The UI can be hidden or space-constrained with CSS when screen real estate is tight.

Likely structure:

- Message log with recent local and remote messages.
- Single-line input.
- Send button.
- Optional empty state as placeholder text, not explanatory app copy.

The task says "with any extra screen real estate we have", so the chat should not push the puzzle off small screens. Practical CSS direction:

- Keep the board at its existing responsive size.
- Make chat a bounded-height panel with internal scrolling.
- On mobile, cap or collapse the log height so controls and board still fit.
- Avoid storing chat history; keep a small in-memory local list in component state and merge in remote ephemeral records from `useEphemeral`.

## Implementation Notes

Local echo is important. Because not every transport necessarily routes a sender's ephemeral event back to itself, the send handler should append the outgoing message to a local React state list at the same time it calls `editor.publishEphemeral`.

Remote reads can use:

```ts
editor.useEphemeral({
    path: chatRootPath(),
    kinds: [wordsearchChatKind],
});
```

Then filter out records from the local actor if local echo is used.

Use a unique message id such as:

```ts
`${wordsearchChatKind}:${actor}:${crypto.randomUUID()}`
```

An expiration can be useful to keep the ephemeral store from accumulating stale chat records during a long session. If supported by the underlying store, set `expiresAt` to a near-future ISO timestamp, for example 10 to 30 minutes. The UI can also keep only the most recent N messages locally, for example 50.

Names/colors:

- `colorForUserId(actor)` is already used for selection highlights and can color avatars or author labels.
- Actor strings are currently values like `host-xxxxxxxx`, `client-xxxxxxxx`, or local replica ids, so display may need a small formatter if raw actor ids feel too noisy.

## Testing Targets

Focused tests could cover:

- `isWordsearchEphemeralData` accepts valid chat messages and still accepts valid selection messages.
- Invalid chat payloads are rejected.
- The chat send flow calls `publishEphemeral` with `wordsearch:chat` and a unique id.
- Remote chat records render while local actor records are not duplicated when local echo is enabled.

Existing transport tests already cover generic ephemeral delivery, so this feature probably does not need new transport-level tests unless behavior changes there.

Manual verification:

- Local simulator: send between Replica A and Replica B.
- PeerJS wordsearch route: send host to client and client to host.
- Server mode if wordsearch is available there: verify `presenceEvent` delivery on the active branch.
- Small viewport: board remains usable and chat does not crowd out the game.

## Open Questions

1. Should chat appear in every wordsearch render mode, or only in the dedicated PeerJS wordsearch demo?
- just dedicated demo
2. Should read-only/history preview panels hide chat entirely, or show received messages with the composer disabled?
- the demo doesn't have read-only or history panels
3. How long should ephemeral chat messages remain visible: current page session only, fixed expiration, or most recent N messages while connected?
- current page session
4. What is the intended maximum message length?
- 280 chars
5. Should actor ids be displayed raw, shortened, or mapped to friendly labels like Host/Client/Replica A?
- Let's give clients random animal names by hash of the ID
6. Should chat messages be delivered while local simulator sync is disabled? Current ephemeral behavior drops messages while sync is off, unlike CRDT updates.
- while disconnected, chat area should be read-only
