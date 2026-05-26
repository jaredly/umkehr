# Shared preview research

The current `when: 'preview'` behavior is intentionally local. It is useful for high-frequency UI feedback, such as dragging an element or hovering a color, because it updates the local visible state without creating CRDT updates, local undo entries, persistence writes, or network messages.

For the whiteboard use case, that local-only behavior leaves a gap: other collaborators cannot see an in-progress drag, resize, selection, or stroke until the final committed CRDT update is published.

## Current implementation

### React CRDT preview

`src/react-crdt/react-crdt.tsx` keeps preview state inside each provider instance:

- `queuedChanges`: draft patches queued until the scheduler frame;
- `activePreviewChanges`: the currently visible preview draft patches;
- `previewState`: materialized state from applying active preview patches over the visible committed history;
- `previewPaths`: normal umkehr paths touched by the preview, used for scoped notifications.

`ctx.$.path(value, 'preview')` calls `queuePreview`, which schedules an animation-frame-style task and later calls `recomputePreview`.

Preview updates are not passed to `applyLocalCommand`, so they do not produce `CrdtUpdate` values. `SyncedTransport.publish` is only called from committed local drafts, undo, and redo.

Remote durable updates already interact well with local preview:

1. `receiveRemoteUpdate` applies the remote CRDT update to committed history.
2. If a local preview is active or queued, it recomputes the preview over the new committed base.
3. It notifies both the remote changed paths and preview paths.

This means the local preview model is robust enough to keep; shared preview should add an ephemeral replication path rather than make previews durable CRDT events.

### Transport shape

The public React CRDT transport currently is:

```ts
export type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};
```

It only carries durable CRDT updates. The example transports mirror that shape:

- local simulator broadcasts or queues `CrdtUpdate[]`;
- PeerJS sends `updates` messages and host snapshots;
- server mode persists updates as branch events, acks them, broadcasts them, and materializes branch history;
- local-first mode is snapshot/batch oriented, not an obvious home for live ephemeral updates.

Server mode has presence, but only for online users/sessions and last-edit statuses. It does not currently carry arbitrary ephemeral per-app payloads.

### Status store

`StatusStore` is path-scoped and already exposed through `useStatuses`. Server mode uses it for remote last-edit metadata. A status can carry arbitrary `data`, but the store is local in-memory state. It needs a transport-side source for shared cursor/selection/preview statuses.

The status store is a good rendering target for remote shared preview data because preview UI usually attaches to a document path, such as `elements[id]`. It is not sufficient by itself as the network protocol.

## Design constraints

Shared preview should be:

- ephemeral: no CRDT metadata, no persistence, no undo/redo, no branch events;
- actor-scoped: every preview belongs to a session actor and can be replaced or cleared by that actor;
- branch/doc scoped: server mode must not leak previews across documents or branches;
- path-aware when possible: renderers should be able to subscribe at `elements[id]` or descendants;
- throttled/coalesced: dragging should send at most one recent preview per frame or a similar rate limit;
- self-clearing: pointer cancel, blur, disconnect, branch switch, and durable commit should clear stale previews;
- explicit by transport: every `SyncedTransport` should expose the ephemeral methods, with drop/no-op implementations for modes that do not have a live ephemeral channel yet.

The biggest API decision is whether shared preview should replicate draft patches or app-level preview payloads.

## Option 1: Broadcast draft preview patches

The most direct approach is to extend the React CRDT layer so `when: 'preview'` can optionally publish the same draft patches that power local preview.

Sketch:

```ts
type PreviewMessage<T, Tag extends string> = {
    kind: 'preview';
    actor: string;
    docId: string;
    branchId?: string;
    previewId: string;
    paths: Path[];
    patches: DraftPatch<T, Tag, Context>[];
};
```

Remote receivers would apply those draft patches over their own current committed state and expose the result as remote preview state.

Benefits:

- reuses existing `when: 'preview'` authoring API;
- whiteboard moves/resizes could be written once and shown locally/remotely;
- path notification can be computed from existing draft patch resolution.

Problems:

- `DraftPatch` can include nested update functions, which are not serializable;
- patch paths use normal state paths, which are less stable around arrays and deleted/recreated objects;
- remote previews would mutate the visible document-shaped state unless the runtime grows a layered preview model;
- multiple remote previews on the same path need deterministic layering and isolation;
- validation story is unclear because this is not a CRDT update and not a durable state replacement.

This is attractive ergonomically but too invasive for a first pass unless preview patches are restricted to serializable patch forms.

## Option 2: Broadcast typed app-level ephemeral presence payloads

Add an ephemeral channel beside CRDT updates. The runtime/transport carries preview or presence messages, and apps decide how to render them.

Sketch:

```ts
export type EphemeralMessage<Data> = {
    kind: string;
    id: string;
    actor: string;
    path?: Path;
    data: Data;
    expiresAt?: string;
};

export type EphemeralTransport<Data> = {
    publishEphemeral(message: EphemeralMessage<Data>): void;
    subscribeEphemeral(receive: (message: EphemeralMessage<Data>) => void): () => void;
};
```

Whiteboard can send messages such as:

```ts
{
    kind: 'whiteboard:element-preview',
    id: `preview:${actor}:element:${elementId}`,
    path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}],
    data: {elementId, x, y, width, height, rotation, color}
}
```

The important constraint is that `Data` should not stay as `unknown` at app boundaries. Each app/sync mode should supply a concrete payload union and a validator for messages received from the network.

For whiteboard:

```ts
type WhiteboardEphemeralData =
    | {
          type: 'element-preview';
          elementId: string;
          x: number;
          y: number;
          width?: number;
          height?: number;
          rotation?: number;
      }
    | {
          type: 'stroke-preview';
          strokeId: string;
          points: [number, number, number?][];
          color: string;
          width: number;
      }
    | {
          type: 'selection';
          elementIds: string[];
          bounds?: {x: number; y: number; width: number; height: number};
      };
```

The receiver stores this in a status/presence store. The whiteboard renderer reads remote preview statuses and overlays them on top of the committed board without changing the CRDT document.

Benefits:

- keeps CRDT document semantics clean;
- no serializable draft-patch problem;
- works for cursors, selection, in-progress strokes, drag ghosts, resize boxes, and tool-specific affordances;
- app controls payload shape and can optimize for rendering;
- strong app-level payload types make authoring and rendering safer;
- the same payload type can drive runtime validation in server, PeerJS, and browser receive paths;
- stale data can be cleared by id, TTL, actor disconnect, branch switch, or explicit clear messages.

Costs:

- app code must send both local preview patches and shared preview payloads during interactions;
- not every app gets shared preview automatically from `when: 'preview'`;
- each transport needs an ephemeral-message implementation if parity is required;
- remote previews are overlays, not part of `ctx.latest()` or `useValue`.

This is the chosen direction for whiteboard. It matches the fact that shared preview is presence-like UI, not collaborative document state, while still giving each app strong type guarantees for its ephemeral payloads.

## Option 3: Extend StatusStore into replicated statuses

Instead of adding generic ephemeral messages, make status replication the public API:

```ts
sharedStatuses.publish({
    id,
    path,
    kind: 'whiteboard:element-preview',
    data,
    ttlMs: 5000,
});
```

The transport maps replicated statuses to local `StatusStore.add` / `clear`.

Benefits:

- uses the existing path-scoped status rendering API;
- good fit for selection, last-edit, cursor-on-element, and element drag preview;
- remote preview can be queried with `useStatuses(editor.$.elements[id], {kinds: [...]})`.

Problems:

- not all ephemeral preview is naturally path-scoped, such as viewport cursors or minimap rectangles;
- `StatusStore` currently has no TTL, actor grouping, or batch replace-by-actor semantics;
- it may overfit network protocol to one local rendering primitive.

A practical compromise is to use generic ephemeral messages at the transport boundary and adapt path-bearing messages into a `StatusStore` for React rendering.

## Recommended direction

Keep `when: 'preview'` local and add a separate typed shared ephemeral channel for collaborative preview/presence. Use Option 2 as the implementation path.

Current repo adjustment: the whiteboard app and basic selection presence now exist. Whiteboard selection currently flows through bespoke `presenceSelection` messages and per-runtime `StatusStore`s, while local move/resize still uses `when: 'preview'` and active pen strokes use local React state. Shared preview should build on that foundation: generalize the existing selection/status path into typed ephemeral messages rather than adding a second long-term selection mechanism beside it.

For the whiteboard v1:

1. During drag/resize, continue to update local state with `editor.$.elements[id].x(nextX, 'preview')` and related field previews.
2. Also publish a throttled `EphemeralMessage<WhiteboardEphemeralData>` containing the element id and preview transform/size.
3. Render remote element previews as overlays above committed elements, keyed by actor and element id.
4. On pointer up, publish the durable CRDT update once, then send a clear message for that preview id.
5. On cancel/escape/pointer-cancel, clear local preview and send a clear message.
6. On disconnect/branch switch, clear that actor's remote ephemeral messages.

For in-progress freehand drawing, do not stream point samples into CRDT. Send `whiteboard:stroke-preview` ephemeral messages with a simplified or sampled point list during drawing, then commit one durable stroke element on pointer up and clear the preview.

Selections can use the same channel:

```ts
kind: 'whiteboard:selection'
path: elements[id]
data: {elementIds: string[], bounds, tool}
```

Existing `presenceSelection` can be kept temporarily as a compatibility wrapper, but the target should be one whiteboard ephemeral selection path with the same sync, TTL, branch-switch, and actor-clear behavior as drag and stroke previews.

## Suggested core/API shape

The smallest core-facing change is to define required ephemeral methods on `SyncedTransport`:

```ts
export type EphemeralMessage<Data> = {
    kind: string;
    id: string;
    actor: string;
    path?: Path;
    data: Data;
    clear?: boolean;
    expiresAt?: string;
};

export type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
    publishEphemeral<Data>(messages: EphemeralMessage<Data>[]): void;
    subscribeEphemeral<Data>(
        receive: (message: EphemeralMessage<Data>) => void,
    ): () => void;
};
```

Then add a small React helper in `umkehr/react-crdt`. The helper should not use method-level
generics, because callers can lie with `ctx.publishEphemeral<WrongType>(...)`. Bind the data type
when creating the synced context/runtime:

```ts
const [ProvideWhiteboard, useWhiteboard] = createSyncedContext<
    WhiteboardState,
    'type',
    WhiteboardEphemeralData
>('type', equal, {
    validateEphemeralData: validateWhiteboardEphemeralData,
});

ctx.publishEphemeral(messages)
ctx.useEphemeral(query)
```

The returned context should expose `publishEphemeral(messages: EphemeralMessage<Data>[])` and
`useEphemeral(query): EphemeralRecord<Data>[]`, where `Data` is fixed by the context. Apps that do
not opt in can default `Data` to `never` or another disabled type.

or keep it example-local first:

```ts
sync.publishPresence(...)
sync.presenceStore / previewStore
```

Because `Data` is erased at runtime, each transport boundary still needs a validator. A concrete app can provide:

```ts
type EphemeralConfig<Data> = {
    validateEphemeralData(input: unknown): input is Data;
    maxEphemeralBytes?: number;
};
```

Given this is motivated by the whiteboard example, example-local is lower risk. Promote to core once the whiteboard proves the shape across cursor, selection, element drag, stroke preview, and validation.

The current `StatusStore` is already exported from `umkehr/react-crdt` and already supplies path-indexed subscriptions. Reuse it where possible for path-scoped rendering, but add the missing ephemeral semantics explicitly: replacement by message id, clear by actor, receipt time, stale/expired state, and expiry-driven notifications.

## Transport implementation notes

### Server mode

Add protocol messages such as:

```ts
type ClientServerMessage =
    | ...
    | {
          kind: 'presenceEvent';
          version: 4;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          event: EphemeralMessage<unknown>;
      };

type ServerClientMessage =
    | ...
    | {
          kind: 'presenceEvent';
          version: 4;
          docId: string;
          branchId: string;
          event: EphemeralMessage<unknown>;
      };
```

Server behavior:

- validate actor/user/session as strictly as `presenceHello`;
- validate the message envelope shape before broadcast;
- validate `event.data` with the app-provided ephemeral data validator;
- require matching `docId` and current `branchId`;
- broadcast only to clients on the same doc and branch;
- do not persist events;
- clear all ephemeral events for an actor on socket close;
- enforce a max payload size and accepted `kind`/`data.type` values.

The current protocol version is `3`. Adding message variants likely means bumping both client and server protocol types together.

Current server/client code already has `presenceHello`, `presenceSelection`, `presenceSnapshot`, `presenceUpdate`, and `presenceLeave`. `presenceEvent` should validate actor/user/doc/branch with the same strictness as those messages, and clients should clear all actor-owned ephemeral messages on `presenceLeave`, not just the existing selection status.

### Local simulator

Extend `createDemoTransport` with ephemeral listeners and have `useLocalDemoSync` broadcast ephemeral messages immediately when sync is enabled. Decide whether manual offline should queue ephemeral data. For preview, dropping while offline is more natural than queueing stale drag positions.

Current local simulator code already has per-replica `StatusStore`s and `broadcastPresenceSelection`. Convert that helper to a thin adapter over typed ephemeral selection messages, or remove it after whiteboard selection is migrated. Manual sync disabled should drop all ephemeral events, including selection changes, while retaining the current durable CRDT outbox behavior.

### PeerJS

Add a `presence` or `ephemeral` peer message. Host should rebroadcast client ephemeral messages to other clients, just like update batches. Messages should not be included in snapshots.

### Local-first

Local-first durable sync does not need shared preview for correctness. If shared preview is required in local-first mode, it needs a live connection concept separate from persisted batch exchange. It can be unsupported initially.

## Rendering model for whiteboard

Remote preview overlays should be separate from document rendering:

- committed elements come from `useValue(editor.$.elements)`;
- local active drag uses existing local preview state;
- remote active drags/strokes/selections come from ephemeral/status stores;
- render remote overlays with actor color/name, lower opacity, and pointer-events disabled;
- if a remote preview targets an element that no longer exists or is archived, ignore it and clear when its TTL expires;
- if a committed update arrives for the same actor/element, clear the matching preview id.

Avoid applying remote preview to `ctx.latest()` because multiple remote users can preview conflicting states simultaneously. The document-shaped visible state can only represent one value per path, but collaborative preview needs layered overlays.

## Open questions

- Should shared preview become a core `umkehr/react-crdt` API now, or should the first implementation be whiteboard/example-local?
  - Decision: start with the whiteboard/example path, but shape it so it can be promoted cleanly.
- Should ephemeral messages be generic transport messages, replicated `Status` values, or both with an adapter?
  - Decision: use generic typed transport messages and adapt path-bearing messages into a status/preview store for rendering.
- Should `when: 'preview'` grow an option that automatically publishes shared preview, or should apps explicitly publish shared preview payloads beside local preview updates?
  - Decision: apps explicitly publish typed ephemeral preview payloads beside local preview updates.
- What payload validation is expected for ephemeral messages?
  - Decision: `EphemeralMessage<Data>` is generic at the TypeScript boundary, and every network receive path must validate `data` with an app-provided validator before accepting it.
- Should shared preview be available in all sync modes for v1?
  - Decision: implement server and local simulator first. PeerJS can follow. Local-first can be unsupported until it has a live ephemeral channel.
- Should ephemeral messages be throttled by the core helper, by transports, or by whiteboard interaction code?
  - Decision: throttle in whiteboard interaction code first; transports should be allowed to enforce defensive rate/payload limits.
- What is the stale-preview timeout? A short TTL, such as 2-5 seconds, prevents stuck ghosts after lost clear messages, but in-progress strokes may need refresh semantics.
  - after 15 seconds the UI indicator should go partially transparent, and after 30 seconds it should disappear.
- Should manual offline mode drop ephemeral messages or queue them? Dropping seems right for preview, but selection presence might want different behavior.
  - drop of offline
- How should remote previews interact with branches? The current server presence tracks `branchId`; shared preview should probably be branch-scoped and cleared on branch switch.
  - yes branch scoped
- Should remote selection be represented as path-scoped statuses, board-level overlay data, or both?
  - path-scoped
- Should preview ownership be session-level actor identity or user-level identity? Session-level matches CRDT authorship and avoids two tabs clobbering each other.
  - session-level
- Should final durable commits automatically clear matching previews from the same actor, or should the app always send explicit clear messages?
  - we're no longer doing previews. ephemeral messages are entirely separate, and can either have explicit clear or an included TTL
- Do we need remote preview history/replay for debugging? The likely answer is no, but server debug tooling may want to show current ephemeral counts.
  - no
- Should the public API include actor color/nickname data, or should preview rendering join ephemeral actor ids with existing presence users?
  - just an actor id
- Should local previews continue to be document-shaped while remote previews are overlays, or should the whiteboard use overlay rendering for both local and remote drags to keep behavior symmetric?
  - for drags let's do overlay rendering for both local and remote

## Recommendation summary

Do not replicate `when: 'preview'` as durable CRDT updates. Keep it local for fast document-shaped feedback, and add a typed ephemeral preview/presence channel for shared whiteboard interactions.

For the first whiteboard implementation, build the shared preview path example-locally:

- server/local simulator `EphemeralMessage<WhiteboardEphemeralData>` transport;
- a whiteboard preview store or status adapter;
- explicit typed whiteboard preview payloads for drag, resize, stroke, and selection;
- app-provided runtime validators for inbound ephemeral data;
- clear-on-commit/cancel/disconnect/branch-switch behavior.

After that works, consider promoting the transport extension and React helper into `umkehr/react-crdt`.
