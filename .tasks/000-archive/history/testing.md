# Server branch history testing notes

## Local cleanup

The branch-history prototype stores server state in `examples/react-crdt-server/server-sync.sqlite`.
If a local run produced duplicate merge events before merge idempotency was added, reset the example
server state before manual QA:

```sh
rm examples/react-crdt-server/server-sync.sqlite
```

The browser replica is stored in IndexedDB. If browser state is stale, clear site data for
`http://127.0.0.1:5173` or bump the server replica storage version in
`examples/react-crdt/src/lib/server/persistence.ts`.

## Manual two-client flow

1. Start the server:

```sh
cd examples/react-crdt-server
npm run dev
```

2. Start the React example:

```sh
cd examples/react-crdt
npm run dev -- --host 127.0.0.1
```

3. Open two browser windows at `http://127.0.0.1:5173`.
4. Log in as two different users.
5. In client A on `main`, create a branch from the current event index.
6. Edit todos on the branch.
7. Verify client B on `main` sees branch metadata but does not see branch content edits.
8. Switch client B to the branch and verify branch edits appear.
9. Switch one client back to `main`, select the feature branch as merge source, and verify:
   - the merge preview updates the main Todo UI;
   - the source-through event index remains fixed while reviewing;
   - toggling changed paths updates the Todo UI preview;
   - accepting creates exactly one merge event;
   - reconnecting or refreshing does not create additional merge events.
10. Add, delete, and reorder todos during branch work. Array order/path revert behavior is the
    highest-risk area and should be checked manually until deeper UI semantics are decided.

## Automated coverage added

- `examples/react-crdt-server/src/store.bun.ts`
  - main branch auto-create;
  - contiguous update event indexes;
  - update idempotency by HLC timestamp;
  - branch creation/rename uniqueness;
  - merge idempotency by `mergeId`.
- `examples/react-crdt/src/lib/server/materialize.test.ts`
  - replay by server event index;
  - merge inclusion without copying source updates into target undo history.
- `examples/react-crdt/src/lib/server/protocol.test.ts`
  - browser-side branch message parsing for branch metadata and merge acks.
- `src/react-crdt/react-crdt.test.tsx`
  - `useLocalHistory()` returns preview history while `previewHistory()` is active.

## Remaining high-risk checks

- Browser-level automation for active vs non-active branch content delivery.
- Offline branch creation and reconnect flush ordering.
- Frozen merge branch creation. Current implementation freezes source-through for live merge,
  but does not yet create a separate frozen target branch.
