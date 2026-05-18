# Manual Testing Checklist

## Setup

1. Build the root package:

   ```sh
   npm run build
   ```

2. Start the Bun sync server:

   ```sh
   cd examples/react-crdt-server
   bun install
   bun run dev
   ```

3. Start the React example in another terminal:

   ```sh
   cd examples/react-crdt
   pnpm install
   pnpm dev
   ```

4. Open the React app, choose the `Server` tab, and keep
   `http://localhost:8787/debug` open in another tab.

## Basic Server Checks

- `http://localhost:8787/health` returns `{"ok":true,"port":8787}`.
- `http://localhost:8787/debug` renders an HTML page.
- The debug page shows connected clients when browser clients are on the Server tab.
- The debug page shows document/message counts after edits sync.

## Single Client

- Create, edit, complete, reorder if applicable, and delete todos.
- Refresh the browser.
- Confirm the document state is still present.
- Confirm the history scrubber still lists changes by timestamp.
- Click several history timestamps and confirm preview state changes without mutating the live document.
- Confirm pending upload count returns to `0` while online.

## Two Clients Online

- Open two browser windows or profiles on the Server tab.
- Make an edit in client A.
- Confirm client B receives it without refresh.
- Make an edit in client B.
- Confirm client A receives it without refresh.
- Confirm each client’s own edits are not echoed back as duplicate history entries.
- Confirm the debug page message count increments.

## Offline/Reconnect

- In client A, click `Go offline`.
- Make several edits in client A.
- Confirm those edits appear locally and in the history scrubber.
- Confirm pending upload count increases.
- Make different edits in client B while client A is offline.
- Click `Go online` in client A.
- Confirm client A uploads its pending edits.
- Confirm client A receives client B’s edits.
- Confirm client B receives client A’s offline edits.
- Confirm both clients converge to the same final todo state.

## Restart Persistence

- With at least one synced document, stop the Bun server.
- Start the Bun server again.
- Refresh both clients.
- Confirm server-backed remote changes are still available.
- Confirm `/debug` still shows persisted documents/messages.

## Duplicate/Reconnect Safety

- Go offline, make edits, then go online.
- Quickly refresh during or just after reconnect.
- Confirm the same local HLC-timestamped updates do not create duplicate server messages.
- Confirm pending uploads eventually clear.

## Multiple Documents

- Open the app with a custom doc id, for example:

  ```text
  http://localhost:5173/?doc=manual-test-a#server
  ```

- Open another custom doc id:

  ```text
  http://localhost:5173/?doc=manual-test-b#server
  ```

- Make edits in both.
- Confirm edits do not cross between documents.
- Confirm `/debug` shows both documents.

## Expected Limitations

- History scrubbing is preview-only.
- Scrubber labels are timestamps only.
- There is no migration, compaction, or snapshot recovery yet.
