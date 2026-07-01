# Research: Jigsaw Connection Stats

## Goal

At puzzle completion, show how many completed jigsaw connections were made by the current session versus the total completed connections. Example copy: `You made 25% of the connections.`

The requested implementation direction is feasible: each connection is a CRDT record entry under `connections`, and the metadata for that entry contains the HLC timestamp that created or last set the entry. Unpacking that HLC gives the actor/session node to compare with the current panel actor.

## Relevant Files

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/lib/crdtApp.ts`
- `src/react-crdt/react-crdt.tsx`
- `src/crdt/types.ts`
- `src/crdt/hlc.ts`

## Current State

The jigsaw state shape is:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

Connections are created by `connectionPatch(candidate)` in `jigsaw.ts`:

```ts
{
    op: 'add',
    path: [
        {type: 'key', key: 'connections'},
        {type: 'key', key: candidate.key},
    ],
    value: candidate.strength,
}
```

`JigsawPanel` already computes:

```ts
const totalConnections = board.pieces.reduce((sum, piece) => sum + piece.neighbors.length, 0) / 2;
const solvedConnections = validConnections(board, connections).length;
```

The header currently renders:

```tsx
{board.title} · {solvedConnections}/{totalConnections} joins
```

There is no explicit completion UI yet. The natural completion condition is:

```ts
solvedConnections === totalConnections
```

## Metadata Path

`createSyncedContext` exposes `useCrdtMeta(node)` on CRDT-backed editor contexts. The app-level type has this available as `CrdtEditorContext`, but `JigsawPanel` currently accepts the narrower `AppEditorContext`.

`useCrdtMeta` internally:

1. Converts the normal patch-builder path into a CRDT path with `crdtPathForExisting`.
2. Reads metadata through `getMetaAtPath`.
3. Returns `undefined` if the path does not exist.

For a connection entry, the likely call shape is:

```ts
const meta = editor.useCrdtMeta(editor.$.connections[connectionKey]);
```

For these connection values, the returned metadata should be `PrimitiveMeta`:

```ts
type PrimitiveMeta = {
    kind: 'primitive';
    ts: HlcTimestamp;
    value: JsonPrimitive;
};
```

The actor/session is:

```ts
hlc.unpack(meta.ts).node
```

The panel already receives `actor` from `renderPanel`, but `JigsawPanel` currently destructures only `editor`, `title`, `gridSlot`, and `readOnly`. That prop should be used as the current actor/session identifier.

## Proposed Implementation

1. Change `JigsawPanel` to accept a CRDT-capable editor type, or locally narrow the editor when metadata is available.
   - Since jigsaw is registered with `createSyncedContext`, the practical runtime has `useCrdtMeta`.
   - The clean type change is to import and use `CrdtEditorContext<JigsawState, 'type', JigsawEphemeralData>` instead of `AppEditorContext` if this panel is only intended for CRDT mode.

2. Add a small component or hook to count connection authorship.
   - Do not call `editor.useCrdtMeta` directly inside an arbitrary loop or conditional completion branch in `JigsawPanel`.
   - A child component like `JigsawCompletionStats` can receive a stable `connections: ValidConnection[]`, `totalConnections`, `actor`, and `editor`.
   - Inside that child, call a helper component per connection, or a custom hook whose hook calls are driven from a stable sorted list that is always rendered while the component is mounted.

3. Count only valid completed connections.
   - Use `layout.connections` or `validConnections(board, connections)`, not raw `Object.keys(connections)`.
   - This avoids counting malformed, stale, non-neighbor, or zero-strength entries.

4. Compare authorship using HLC node:
   - `meta?.kind === 'primitive'`
   - `hlc.unpack(meta.ts).node === actor`

5. Render the stat only at completion.
   - Completion: `solvedConnections === totalConnections && totalConnections > 0`
   - Copy options:
     - `You made 3 of 12 connections (25%).`
     - `You made 25% of the connections.`
   - The first form is more useful and still includes the requested percentage.

6. Add tests around pure counting logic if factored out.
   - A pure helper can accept valid connection keys plus a map of `{key -> actor}` and return `{madeByActor, total, percent}`.
   - Existing `jigsaw.test.ts` is a good place for this helper if it lives in `jigsaw.ts`.
   - A React test may be harder because metadata is exposed through hooks tied to CRDT history, but there are existing `react-crdt` tests if integration coverage is needed.

## Suggested Helper Shape

If we want to keep the React hook surface small, add pure helpers in `jigsaw.ts`:

```ts
export type ConnectionAttribution = {
    key: string;
    actor: string | null;
};

export function connectionStatsForActor(
    connections: ValidConnection[],
    attributions: ConnectionAttribution[],
    actor: string,
) {
    const validKeys = new Set(connections.map((connection) => connection.key));
    let madeByActor = 0;
    for (const attribution of attributions) {
        if (validKeys.has(attribution.key) && attribution.actor === actor) madeByActor++;
    }
    return {
        madeByActor,
        total: connections.length,
        percent: connections.length === 0 ? 0 : madeByActor / connections.length,
    };
}
```

The UI can then focus on reading metadata and formatting the result.

## Edge Cases

- A drag can create multiple connections in one dispatch. Each connection patch receives its own CRDT update timestamp, but all should have the same HLC node for the local actor.
- Undo/redo may change connection metadata. If undo deletes a connection, it is not counted because the connection is no longer valid/live. If redo restores it, its new metadata may belong to the actor who performed redo, not necessarily the original snapper. This may be acceptable but should be decided.
- Server/local-first actors are commonly formatted like `userId:sessionId`. Local demo actors may be simpler replica ids. Comparing against the `actor` prop should avoid hard-coding any session parsing.
- `useCrdtMeta` returns `undefined` before a path exists. The completion UI should tolerate missing metadata and count those as not made by the current actor, or exclude them from numerator only.
- The board total is based on neighbor references divided by two. This assumes reciprocal neighbor data, which the jigsaw tests already assert for generated boards.

## Open Questions

1. Should the denominator be all possible puzzle connections (`totalConnections`) or only currently valid solved connections? At completion they are equal, but copy like `3 of 12` should probably use `totalConnections`.
    - currently valid solved connections
2. For undo/redo, should credit belong to the original connection creator or the session that redid/restored the connection? The current HLC metadata approach will likely credit the latest live write.
    - it doesn't matter, undo is only valid for ones own moves anyway
3. Should stats compare exact actor/session, or should server mode group multiple sessions by user id? The task says current session id, so exact actor/session seems right.
    - exact session id
4. Should the completion message appear in the header, as an overlay, or as a small end-state panel? Header is lowest-risk; overlay is more noticeable but needs more styling/testing.
    - header is fine
5. If a connection entry has missing or non-primitive metadata, should it be treated as “other session” or omitted from percent calculations? Treating it as other session keeps the denominator stable and avoids misleading percentages.
    - other session is fine

## Recommended Path

Implement a small completion stats component in `JigsawPanel.tsx`, using `actor` and `editor.useCrdtMeta` for each valid connection. Factor percentage formatting into a pure helper if tests are added. Render `You made X of Y connections (Z%).` only when `solvedConnections === totalConnections`.
