# CRDT undo metadata manual smoke tests

These checks are meant to verify the new metadata-derived CRDT undo/redo behavior in the React CRDT example.

## Setup

From the repo root:

```sh
npm run build
cd examples/react-crdt
pnpm install
pnpm dev
```

Open the Vite URL and use the local two-replica demo first.

## Local two-replica demo

### Basic local undo/redo

1. In the left replica, edit a todo title.
2. Confirm the right replica receives the edit when sync is enabled.
3. In the left replica, click undo.
4. Confirm the left title reverts.
5. Confirm the right replica also receives the undo as a normal synced CRDT update.
6. In the left replica, click redo.
7. Confirm both replicas show the edited title again.

Expected result:

- Undo/redo works locally.
- Undo/redo syncs remotely as normal CRDT updates.
- No remote-side undo button should become enabled just because it received the other replica's edit.

### Remote updates do not clear redo

1. Pause sync.
2. In the left replica, edit a title.
3. In the left replica, undo the edit.
4. Confirm redo is available on the left.
5. In the right replica, edit a different field or todo.
6. Resume sync.
7. Confirm the right-side remote edit arrives on the left.
8. Confirm redo is still available on the left.
9. Click redo on the left.

Expected result:

- The left redo survives incoming remote updates.
- The redo reapplies the original left edit unless the same target was superseded.

### Superseded undo blocks

1. Pause sync.
2. In the left replica, edit a title to `Left`.
3. In the right replica, edit the same title to `Right`.
4. Resume sync.
5. On the left, try undo.

Expected result:

- Undo should be unavailable or no-op because the local edit was superseded by the remote edit.
- The title should remain `Right`.

### New local edit clears redo

1. In the left replica, edit a title.
2. Undo the edit.
3. Confirm redo is available.
4. Make a different local edit on the left.
5. Confirm redo is no longer available.

Expected result:

- New local edit clears local redo.

### Array operations

1. Add a todo on the left.
2. Reorder todos on the right.
3. Let the replicas sync.
4. Undo the add on the left.

Expected result:

- The added todo is removed by item identity.
- The remote reorder is preserved for the remaining todos.

## Local-first mode

Use the local-first/PeerJS-backed mode if available in the example UI.

### Reload-derived undo/redo

1. Make a local edit.
2. Undo it.
3. Reload the page.
4. Confirm the document is still in the undone state.
5. Confirm redo is available for the same browser/session.
6. Click redo.

Expected result:

- Undo/redo state is recovered from retained CRDT updates, not from persisted command stacks.

### Different sessions do not share local undo

1. Open the same document in two browser tabs or windows that create different session actors.
2. Make an edit in tab A.
3. Let tab B receive it.
4. Confirm tab B cannot undo tab A's edit as a local undo.
5. In tab A, confirm undo is available.

Expected result:

- Undo is scoped to the exact HLC actor/session.
- Same-user-but-different-session edits do not become local undo entries.

## Server mode

If testing the server-backed mode, start the Bun server in a second terminal as described in `examples/react-crdt/README.md`.

### Server sync of undo metadata

1. Connect two browser sessions to the same server document.
2. Make an edit in session A.
3. Confirm session B receives it.
4. Undo in session A.
5. Confirm session B receives the reverted state.
6. Redo in session A.
7. Confirm session B receives the edited state again.
8. Refresh session A.

Expected result:

- Server transport preserves update metadata.
- Session A can recover undo/redo state from retained updates after refresh.
- Session B does not get local undo for session A's commands.

## Developer sanity checks

Run from repo root:

```sh
npm test
npm run typecheck
npm run typecheck:examples
npm run typecheck:tests
```

Expected result:

- All commands pass.
