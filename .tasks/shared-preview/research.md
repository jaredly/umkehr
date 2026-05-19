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
- optional by transport: durable CRDT sync should keep working when a transport does not implement ephemeral preview.

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

## Option 2: Broadcast app-level ephemeral presence payloads

Add an ephemeral channel beside CRDT updates. The runtime/transport carries preview or presence messages, and apps decide how to render them.

Sketch:

```ts
export type EphemeralMessage = {
    kind: string;
    id: string;
    actor: string;
    path?: Path;
    data: unknown;
    expiresAt?: string;
};

export type EphemeralTransport = {
    publishEphemeral(message: EphemeralMessage): void;
    subscribeEphemeral(receive: (message: EphemeralMessage) => void): () => void;
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

The receiver stores this in a status/presence store. The whiteboard renderer reads remote preview statuses and overlays them on top of the committed board without changing the CRDT document.

Benefits:

- keeps CRDT document semantics clean;
- no serializable draft-patch problem;
- works for cursors, selection, in-progress strokes, drag ghosts, resize boxes, and tool-specific affordances;
- app controls payload shape and can optimize for rendering;
- stale data can be cleared by id, TTL, actor disconnect, branch switch, or explicit clear messages.

Costs:

- app code must send both local preview patches and shared preview payloads during interactions;
- not every app gets shared preview automatically from `when: 'preview'`;
- each transport needs an ephemeral-message implementation if parity is required;
- remote previews are overlays, not part of `ctx.latest()` or `useValue`.

This is the best first version for whiteboard. It matches the fact that shared preview is presence-like UI, not collaborative document state.

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

## Option 4: Public preview CRDT updates over presence

Another possibility is to add a third timing mode:

```ts
ctx.$.elements[id].x(nextX, 'public-preview')
```

This would run most of the committed CRDT update pipeline, but publish the resulting `CrdtUpdate` values through a presence/ephemeral channel instead of the durable update channel. Other clients would receive those updates, apply them in preview mode, and clear or replace them when the actor sends a newer preview, commits, cancels, disconnects, or changes branch.

Sketch:

```ts
export type ApplyTiming = 'preview' | 'public-preview' | undefined;

type PublicPreviewMessage = {
    kind: 'crdt-public-preview';
    actor: string;
    previewId: string;
    docId: string;
    branchId?: string;
    updates: CrdtUpdate[];
    clear?: boolean;
};
```

This approach is interesting because it keeps the application authoring model very close to normal edits:

- local preview still uses the patch builder API;
- the runtime translates draft patches to CRDT paths, stable record keys, and schema-shaped updates;
- remote clients can reuse CRDT path translation to know which normal paths changed;
- moving an element can be represented as the same field updates that a final commit would use;
- app code would not need a parallel `whiteboard:element-preview` payload for every operation.

However, it needs a very careful separation between durable CRDT state and preview CRDT state.

### Max timestamp concern

The proposed special timestamps are not malformed timestamp strings. The idea is a sentinel "max timestamp" clock domain that always wins LWW comparison inside preview application, so remote previews naturally overlay committed state.

That does make the visible result intuitive: if Alice is dragging a note, her preview `x` and `y` should beat the committed `x` and `y` no matter how old the committed field timestamp is.

The risk is that current CRDT semantics rely on HLC timestamps for more than LWW field comparison. They also carry actor identity, duplicate detection, pending update handling, local clock receive behavior, update timestamp extraction, and server actor/timestamp validation. A max timestamp that is valid only for preview must therefore be impossible to confuse with a durable HLC timestamp.

If max preview timestamps are encoded directly into ordinary `CrdtUpdate.ts` fields, they can affect:

- CRDT validation;
- `hlc.unpack`;
- `latestCrdtUpdateTimestamp`;
- local clock receive logic;
- last-writer-wins comparisons;
- server actor/timestamp checks;
- branch event sorting if a preview accidentally enters the durable path.

A safer shape is to make the timestamp domain explicit rather than smuggling a sentinel into the existing HLC string:

```ts
type PublicPreviewMessage = {
    kind: 'crdt-public-preview';
    previewId: string;
    actor: string;
    sequence: number;
    updates: PublicPreviewUpdate[];
};

type PublicPreviewUpdate = CrdtUpdate & {
    previewTs: {kind: 'max'; actor: string; sequence: number};
};
```

Conceptually, preview application would compare preview fields as:

1. public preview max timestamps beat durable HLC timestamps;
2. newer `sequence` wins over older `sequence` for the same actor/preview id;
3. if multiple actors preview the same path, the runtime should avoid pretending there is one canonical winner and expose layered previews instead.

The alternative is to keep contained `CrdtUpdate` values as ordinary real-HLC updates and have the preview applicator treat the entire preview layer as higher priority than durable state. That gets the same "preview wins over committed state" behavior without changing timestamp syntax, but it means the max behavior lives in the preview compositor rather than the CRDT update values.

Either way, preview timestamps must not advance durable document clocks. The conservative rule is:

- durable updates affect the transport/local HLC clock;
- public preview messages do not affect durable history or durable clock state, even if their preview fields compare above durable HLC fields;
- the sender's final commit mints fresh durable HLC timestamps.

That means max preview timestamps are only for overlay ordering inside the ephemeral preview layer, not for durable causality.

### Applying remote preview CRDT updates

Remote clients cannot simply call `applyRemoteHistoryUpdate(ctx.history, update)` because that would mutate durable history. They need a parallel preview application path:

1. Start from the current durable `ctx.history.doc`.
2. Apply one actor/preview id's public-preview updates to a temporary document.
3. Store the temporary document, changed normal paths, and preview metadata separately.
4. Render those changes as an overlay or a preview layer.
5. Rebase/recompute the preview document after durable remote/local updates.

The design becomes harder with multiple remote previews. A single `previewState` cannot represent two users dragging the same element to different locations. The runtime needs either:

- one preview document per `{actor, previewId}` and app-level overlay rendering; or
- a layered preview compositor that can combine multiple preview documents into one visible state with deterministic priority.

For whiteboard, per-preview overlay rendering is more honest. It can show two drag ghosts at once without pretending the document has one current value.

### Local public preview pipeline

A plausible local implementation:

1. Resolve the draft patch against durable state or local preview state.
2. Create CRDT updates with `applyLocalCommand`-like translation, but do not append to `ctx.history.localCommands` and do not mutate durable history.
3. Apply the draft locally as ordinary local preview so the local user gets immediate feedback.
4. Publish a `crdt-public-preview` message through the presence channel.
5. On final commit, clear the public preview and run the normal committed path with fresh durable CRDT updates.

The hard part is step 2. `applyLocalCommand` currently returns a new local history and updates intended to be durable. A public-preview implementation probably needs a lower-level helper that can translate a draft patch to CRDT updates against a document without recording local undo/redo history.

### Benefits

- Most ergonomic API for app authors: `when: 'public-preview'` is a natural extension of `when: 'preview'`.
- Uses CRDT path addressing rather than inventing app-specific payloads for every field update.
- Keeps preview update generation consistent with committed update generation.
- Could work for any app whose preview can be represented by serializable draft patches and overlay rendering.
- Avoids spamming durable CRDT history while still letting peers observe high-frequency interactions.

### Problems

- Preview CRDT updates must be impossible to persist accidentally.
- Max preview timestamps would need an explicit non-durable timestamp domain or a preview compositor rule; putting sentinel values into ordinary durable HLC fields is risky.
- The runtime needs a preview CRDT application path separate from durable history.
- Multiple simultaneous remote previews require layered rendering, not just `ctx.previewState`.
- Undo/redo must ignore public previews completely.
- Server validation must distinguish durable `clientUpdate` from ephemeral `crdt-public-preview`.
- Presence payload size can still become large for strokes or rapid multi-field updates.
- It is unclear whether preview CRDT updates should be accepted if their parent/path metadata references elements that have since been archived, deleted, or recreated.
- If public-preview CRDT updates are recomputed on every pointer move, they may still be relatively expensive even though they are not durable.

### Fit assessment

This is a strong medium-term API direction, but it is probably not the simplest whiteboard v1. It is best if the goal is a general shared-preview abstraction in `umkehr/react-crdt`, not just a whiteboard-specific overlay channel.

The most viable version is:

- `when: 'public-preview'` exists as a React CRDT feature;
- preview messages contain normal `CrdtUpdate[]` plus an ephemeral envelope;
- preview "max timestamp" behavior is explicit and cannot be mistaken for durable HLC causality;
- remote previews are exposed as layered preview records/statuses, not merged into `ctx.latest()`;
- final commit always generates fresh durable CRDT updates.

## Recommended direction

Keep `when: 'preview'` local and add a separate shared ephemeral channel for collaborative preview/presence.

For the whiteboard v1:

1. During drag/resize, continue to update local state with `editor.$.elements[id].x(nextX, 'preview')` and related field previews.
2. Also publish a throttled `whiteboard:element-preview` ephemeral message containing the element id and preview transform/size.
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

## Suggested core/API shape

The smallest core-facing change is to define an optional extension on `SyncedTransport`:

```ts
export type EphemeralMessage = {
    kind: string;
    id: string;
    actor: string;
    path?: Path;
    data?: unknown;
    clear?: boolean;
    expiresAt?: string;
};

export type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
    publishEphemeral?(messages: EphemeralMessage[]): void;
    subscribeEphemeral?(receive: (message: EphemeralMessage) => void): () => void;
};
```

Then add a small React helper in `umkehr/react-crdt`:

```ts
ctx.publishEphemeral(messages)
ctx.useEphemeral(query)
```

or keep it example-local first:

```ts
sync.publishPresence(...)
sync.presenceStore / previewStore
```

Given this is motivated by the whiteboard example, example-local is lower risk. Promote to core once the whiteboard proves the shape across cursor, selection, element drag, and stroke preview.

If `public-preview` is pursued instead, the same optional transport extension can carry it as one particular ephemeral message kind. That keeps server/local/PeerJS transport work reusable even if the first app uses app-level payloads and a later core API uses CRDT-shaped preview payloads.

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
          event: EphemeralMessage;
      };

type ServerClientMessage =
    | ...
    | {
          kind: 'presenceEvent';
          version: 4;
          docId: string;
          branchId: string;
          event: EphemeralMessage;
      };
```

Server behavior:

- validate actor/user/session as strictly as `presenceHello`;
- require matching `docId` and current `branchId`;
- broadcast only to clients on the same doc and branch;
- do not persist events;
- clear all ephemeral events for an actor on socket close;
- optionally enforce max payload size and accepted `kind` prefixes.

The current protocol version is `3`. Adding message variants likely means bumping both client and server protocol types together.

### Local simulator

Extend `createDemoTransport` with ephemeral listeners and have `useLocalDemoSync` broadcast ephemeral messages immediately when sync is enabled. Decide whether manual offline should queue ephemeral data. For preview, dropping while offline is more natural than queueing stale drag positions.

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
- Should ephemeral messages be generic transport messages, replicated `Status` values, or both with an adapter?
- Should `when: 'preview'` grow an option that automatically publishes shared preview, or should apps explicitly publish shared preview payloads beside local preview updates?
- Should the API be `when: 'public-preview'`, or should public/private preview be a separate option object so timing does not become an expanding string union?
- If public preview sends CRDT-shaped updates, should "max timestamp wins" live in an explicit non-durable timestamp/clock domain on the updates, or in a preview compositor that treats preview layers as higher priority than durable state?
- Should receiving public-preview CRDT updates advance any local clock, or should they be completely outside durable causality?
- What lower-level helper should translate a draft patch to CRDT updates without mutating durable local history or undo/redo stacks?
- How should multiple remote public previews on the same path be rendered: layered overlays, deterministic merge into one preview state, or app-defined resolution?
- What payload validation is expected for ephemeral messages? Generic `unknown` is flexible, but server mode probably needs size limits and either kind allowlists or app-provided validators.
- Should shared preview be available in all sync modes for v1? Server and local simulator are straightforward; PeerJS is moderate; local-first likely needs a separate live channel.
- Should ephemeral messages be throttled by the core helper, by transports, or by whiteboard interaction code?
- What is the stale-preview timeout? A short TTL, such as 2-5 seconds, prevents stuck ghosts after lost clear messages, but in-progress strokes may need refresh semantics.
- Should manual offline mode drop ephemeral messages or queue them? Dropping seems right for preview, but selection presence might want different behavior.
- How should remote previews interact with branches? The current server presence tracks `branchId`; shared preview should probably be branch-scoped and cleared on branch switch.
- Should remote selection be represented as path-scoped statuses, board-level overlay data, or both?
- Should preview ownership be session-level actor identity or user-level identity? Session-level matches CRDT authorship and avoids two tabs clobbering each other.
- Should final durable commits automatically clear matching previews from the same actor, or should the app always send explicit clear messages?
- Do we need remote preview history/replay for debugging? The likely answer is no, but server debug tooling may want to show current ephemeral counts.
- Should the public API include actor color/nickname data, or should preview rendering join ephemeral actor ids with existing presence users?
- Should local previews continue to be document-shaped while remote previews are overlays, or should the whiteboard use overlay rendering for both local and remote drags to keep behavior symmetric?

## Recommendation summary

Do not replicate `when: 'preview'` as durable CRDT updates. Keep it local for fast document-shaped feedback, and add an ephemeral preview/presence channel for shared whiteboard interactions.

For the first whiteboard implementation, build the shared preview path example-locally:

- server/local simulator ephemeral messages;
- a whiteboard preview store or status adapter;
- explicit whiteboard preview payloads for drag, resize, stroke, and selection;
- clear-on-commit/cancel/disconnect/branch-switch behavior.

After that works, consider promoting the transport extension and React helper into `umkehr/react-crdt`.

`when: 'public-preview'` is worth keeping on the table as the promoted API, especially if shared preview should become generic across apps. If it uses CRDT-shaped updates, model "max timestamp wins" explicitly in the ephemeral preview layer so it cannot leak into durable HLC causality.
