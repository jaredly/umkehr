# Plan: Wordsearch PeerJS Ephemeral Chat

## Scope

Add a compact chat UI to the dedicated wordsearch PeerJS demo only. Messages are sent over the existing ephemeral/presence transport, kept for the current page session only, and never written to the CRDT document, host session storage, local storage, or artifacts.

Confirmed product decisions:

- Render chat only in `WordsearchPeerJsDemo`, not every `WordsearchPanel` usage.
- No read-only/history handling is needed for this demo.
- Keep chat history for the current page session.
- Cap messages at 280 characters.
- Display participants with deterministic random animal names derived from actor id hash.
- When disconnected, the chat area should be read-only.

## Phase 1: Extend Wordsearch Ephemeral Model

Files:

- `examples/react-crdt/src/apps/wordsearch/model.ts`

Tasks:

- Add a chat event variant:

```ts
export type WordsearchChatEvent = {
    type: 'chat';
    text: string;
    sentAt: string;
};
```

- Change `WordsearchEphemeralData` to include both selection and chat events.
- Add constants/helpers:
  - `wordsearchChatKind = 'wordsearch:chat'`
  - `WORDSEARCH_CHAT_MAX_LENGTH = 280`
  - `chatRootPath()`
  - `chatMessage({ actor, text, sentAt, id })`
- Keep selection helpers unchanged.
- Update `isWordsearchEphemeralData` so it accepts:
  - existing selection events
  - chat events with non-empty trimmed text, `text.length <= 280`, and non-empty `sentAt`

Notes:

- Chat message ids must be unique per message, for example `${wordsearchChatKind}:${actor}:${crypto.randomUUID()}`.
- Do not set `clear: true` for chat messages.
- Do not use a single id per actor for chat, because that risks replacing prior messages.

## Phase 2: Add PeerJS Chat Surface

Files:

- `examples/react-crdt/src/apps/wordsearch/WordsearchPeerJsDemo.tsx`
- Optional new file if the component gets large:
  - `examples/react-crdt/src/apps/wordsearch/WordsearchChat.tsx`

Tasks:

- Create a small `WordsearchChat` component that receives:
  - `editor: AppEditorContext<WordsearchState, 'type', WordsearchEphemeralData>`
  - `actor: string`
  - `disabled: boolean`
- Read remote chat records with:

```ts
editor.useEphemeral({
    path: chatRootPath(),
    kinds: [wordsearchChatKind],
});
```

- Keep locally sent messages in React state for local echo and page-session history.
- Merge local echoed messages with remote ephemeral records.
- Filter remote records from the local actor to avoid duplicate self messages.
- Sort messages by `sentAt`, with a stable id tiebreaker.
- Keep a bounded in-memory list, for example the most recent 50 messages.
- On submit:
  - trim the input
  - ignore empty messages
  - cap at 280 characters
  - create `sentAt = new Date().toISOString()`
  - append to local state immediately
  - call `editor.publishEphemeral([chatMessage(...)])`
  - clear the input
- Disable the input and send button when disconnected.

Integration:

- `WordsearchPeerJsDemo` already has access to `sync.stateStore` and `sync.connectionsStore`.
- A practical connected check is `state.kind === 'ready' && connections.some((connection) => connection.open)`.
- Pass `disabled={!isChatConnected}` into both host and client panels.
- Change `WordsearchHostPanel` and `WordsearchClientPanel` to render the wordsearch panel plus chat below it, rather than relying only on `wordsearchApp.renderPanel(...)`.

## Phase 3: Deterministic Animal Display Names

Files:

- `examples/react-crdt/src/apps/wordsearch/WordsearchPeerJsDemo.tsx`
- Optional helper in `WordsearchChat.tsx`

Tasks:

- Add a small fixed list of animal names.
- Hash the actor id to pick an animal name deterministically.
- Include a short suffix if needed to reduce collisions, for example `Otter 7F`.
- Use this display name in chat messages instead of raw actor ids.
- Use `colorForUserId(actor)` for a compact avatar/accent so chat identity matches existing wordsearch presence colors.

Important:

- The instruction says animal names by hash of ID, so avoid random names stored in state or persistence.
- The display name should be derived at render time from the actor id.

## Phase 4: Styling And Responsive Behavior

Files:

- `examples/react-crdt/src/style.css`

Tasks:

- Add styles for:
  - `.wordsearchChat`
  - `.wordsearchChatLog`
  - `.wordsearchChatMessage`
  - `.wordsearchChatComposer`
  - disabled/read-only state
- Keep the chat compact and visually subordinate to the board.
- Give the message log a bounded height with internal scrolling.
- On small viewports, reduce the log height so the puzzle remains playable.
- Ensure the composer controls have stable dimensions and text does not overflow.

Layout direction:

- Keep chat directly below the word bank/status inside the dedicated PeerJS wordsearch document area.
- Do not let chat force the board out of the available viewport on mobile.
- Use existing colors and border radius patterns from the wordsearch and PeerJS UI.

## Phase 5: Tests

Likely files:

- `examples/react-crdt/src/apps/wordsearch/wordsearch.test.ts`
- New focused test file if cleaner:
  - `examples/react-crdt/src/apps/wordsearch/model.test.ts`
  - `examples/react-crdt/src/apps/wordsearch/WordsearchChat.test.tsx`

Tasks:

- Add model/validator tests:
  - valid selection payload still passes
  - valid chat payload passes
  - empty chat text fails
  - over-280-character chat text fails
  - malformed `sentAt`/missing fields fail
- Add component tests if the existing test setup supports React rendering cheaply:
  - sending a message calls `publishEphemeral` with `kind: wordsearch:chat`
  - sent message appears locally without waiting for transport echo
  - remote message renders
  - local actor remote record is not duplicated
  - disconnected state disables composer

Avoid transport-level changes unless implementation reveals a real gap; local, PeerJS, and server transports already support generic ephemeral delivery.

## Phase 6: Manual Verification

Run targeted checks:

- `pnpm exec vitest -- run src/apps/wordsearch/...` from `examples/react-crdt`
- Broader relevant tests if needed:
  - `pnpm exec vitest -- run src/lib/peerjs/protocol.test.ts src/lib/local/useLocalDemoSync.test.ts src/apps/wordsearch/...`

Manual browser checks:

- Start the React CRDT dev server.
- Open the dedicated wordsearch PeerJS route.
- Host with no connected client:
  - chat composer is disabled/read-only
  - game remains usable
- Host and client connected:
  - host sends and client receives
  - client sends and host receives
  - local sent messages appear immediately
  - participant names are deterministic animal labels
- Disconnect:
  - composer becomes disabled/read-only
  - existing page-session chat remains visible
- Mobile viewport:
  - board remains playable
  - chat log does not crowd out controls or board

## Risks And Watchpoints

- `WordsearchEphemeralData` validation is required; without it, chat events may be dropped by the synced context.
- PeerJS host/client transports do not guarantee local echo, so local state must append sent messages.
- Unique message ids are required to keep multiple messages from one actor visible.
- Current-page-session history means no persistence; avoid writing chat to existing host session persistence.
- The dedicated PeerJS route has its own mobile CSS constraints; chat styling needs to be tested there, not only in the generic app shell.
