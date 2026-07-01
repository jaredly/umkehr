# Plan: Jigsaw Connection Stats

## Decisions From Research

- Show the stat only when the puzzle is complete.
- Use currently valid solved connections as the denominator.
- Compare exact session actor ids, not grouped user ids.
- Render the completion stat in the existing jigsaw header.
- Treat missing or non-primitive connection metadata as credited to another session.
- Undo/redo does not need special attribution handling.

## Phase 1: Add Pure Stats Helpers

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Add a small attribution type:

   ```ts
   export type ConnectionAttribution = {
       key: string;
       actor: string | null;
   };
   ```

2. Add `connectionStatsForActor`.
   - Inputs: valid solved connections, attribution records, current actor.
   - Output: `{madeByActor, total, percent}`.
   - Denominator: `connections.length`.
   - Missing attributions or `actor: null` should not increment `madeByActor`.

3. Add focused tests in `jigsaw.test.ts`.
   - Counts only keys present in the valid connection list.
   - Ignores invalid/stale attribution keys.
   - Counts exact actor matches only.
   - Handles zero connections with `percent: 0`.

## Phase 2: Read CRDT Metadata In The Panel

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/lib/crdtApp.ts` only if type exports need adjustment.

Tasks:

1. Update `JigsawPanel` props to destructure and use `actor`.

2. Change the editor type from `AppEditorContext` to the CRDT-capable context type.
   - Preferred: import `CrdtEditorContext` from `../../lib/crdtApp`.
   - Use `CrdtEditorContext<JigsawState, 'type', JigsawEphemeralData>`.
   - This is appropriate because jigsaw is backed by `createSyncedContext`, and the implementation needs `useCrdtMeta`.

3. Add a small stats component in `JigsawPanel.tsx`.
   - Suggested name: `JigsawCompletionStats`.
   - Props: `editor`, `actor`, `connections`, `complete`.
   - Render nothing unless `complete` is true.
   - Keep the hook calls inside this component rather than inline in a conditional branch of `JigsawPanel`.

4. Add a per-connection metadata reader component or stable hook structure.
   - For each valid connection key, read:

     ```ts
     const meta = editor.useCrdtMeta(editor.$.connections[key]);
     ```

   - Convert metadata to attribution:

     ```ts
     const actor = meta?.kind === 'primitive' ? hlc.unpack(meta.ts).node : null;
     ```

   - Import `hlc` from `umkehr/crdt`.

5. Sort valid connections by key before rendering metadata readers.
   - This keeps render order deterministic.
   - Avoid changing hook call order inside a single component based on array length; using a child component per connection is the safer React shape.

## Phase 3: Render Header Copy

File:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`

Tasks:

1. Keep the existing header progress copy:

   ```tsx
   {board.title} · {solvedConnections}/{totalConnections} joins
   ```

2. Add the completion-only stat near that existing header text.
   - Recommended copy:

     ```txt
     You made X of Y connections (Z%).
     ```

   - `Y` should be the current valid solved connection count from the helper result.
   - `Z` should be rounded to the nearest whole percent.

3. Avoid showing the stat before completion.
   - Completion condition:

     ```ts
     solvedConnections === totalConnections && solvedConnections > 0
     ```

4. Keep styling minimal.
   - Reuse the existing header paragraph style if possible.
   - Add a small class only if spacing or hierarchy needs it.

## Phase 4: Verification

Commands:

1. Run the focused jigsaw unit tests:

   ```sh
   cd examples/react-crdt
   pnpm exec vitest run src/apps/jigsaw/jigsaw.test.ts
   ```

2. Run typecheck or the project’s normal test command if available and reasonably scoped.
   - Check `examples/react-crdt/package.json` for the exact scripts before running broader commands.

3. Optional UI check:
   - Start the Vite dev server.
   - Open the jigsaw app.
   - Complete a small puzzle in local sync mode.
   - Confirm the header shows the completion stat only at the end.

## Implementation Notes

- Use `layout.connections` as the valid connection list in `JigsawPanel`; it already comes from `validConnections`.
- Do not count raw `connections` object entries.
- Do not parse user ids out of actor strings; exact `hlc.unpack(meta.ts).node === actor` is the desired comparison.
- Treat `undefined` metadata, tombstone metadata, and non-primitive metadata as `actor: null`.
- Keep all changes local to the jigsaw app unless typing requires a small app-context adjustment.
