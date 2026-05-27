# Shared preview implementation plan

This plan implements shared whiteboard preview as typed ephemeral presence data, not as CRDT updates and not as `when: 'public-preview'`.

The target is:

- keep existing `when: 'preview'` local-only;
- add a typed `EphemeralMessage<Data>` channel beside durable CRDT updates;
- support server mode and local simulator first;
- make PeerJS a follow-up and leave local-first unsupported until it has a live ephemeral channel;
- render local and remote drags as overlays rather than mutating document-shaped preview state;
- validate inbound ephemeral payloads at every network boundary.

There are unrelated worktree changes in the repo right now. Implementation should inspect current diffs before editing shared files and avoid reverting user work.

## Target API shape

Core/shared type:

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
```

Whiteboard data should be a concrete union, not `unknown`:

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

Transport capability:

```ts
publishEphemeral<Data>(messages: EphemeralMessage<Data>[]): void;
subscribeEphemeral<Data>(
    receive: (message: EphemeralMessage<Data>) => void,
): () => void;
```

Runtime validation:

```ts
type EphemeralConfig<Data> = {
    validateEphemeralData(input: unknown): input is Data;
    maxEphemeralBytes?: number;
};
```

## Phase 1: Shared types and local preview store

Add the shared type surface and a small in-memory store for active ephemeral messages.

Current repo note:

- `src/statuses.ts` already has a path-indexed in-memory `StatusStore` with `add`, `clear`, `clearAll`, exact queries, and descendant queries, and it is exported from `umkehr/react-crdt`.
- Existing whiteboard selection presence already writes remote selections into per-replica/server `StatusStore`s.
- The missing part is TTL/staleness, actor-wide clear, and the typed `EphemeralMessage<Data>` lifecycle; do not duplicate the existing path subscription/indexing unless the TTL semantics make a separate store cleaner.

Likely files:

- `src/react-crdt/react-crdt.tsx`
- `src/react-crdt/index.ts`
- possibly `src/statuses.ts` or a new small helper module if the store should be reusable

Work:

- Export `EphemeralMessage<Data>`.
- Extend `SyncedTransport` with required `publishEphemeral` and `subscribeEphemeral`; transports that do not have a live channel yet should implement explicit drop/no-op behavior.
- Add a preview/presence store helper that indexes messages by `id`, `actor`, and optional `path`, either by extending `StatusStore` carefully or by adding a separate `EphemeralStore`.
- Support `clear: true`.
- Support clearing all messages for an actor so `presenceLeave`, branch switches, and simulator resets can remove session overlays.
- Track receipt time and compute staleness:
  - normal for the first 15 seconds;
  - stale/partially transparent after 15 seconds;
  - removed after 30 seconds.
- Keep ownership session-level via `actor`.
- Keep payload rendering separate from `ctx.latest()` and `useValue`.

Acceptance:

- Existing CRDT update transports continue typechecking after adding explicit drop/no-op ephemeral methods.
- Store tests cover add, replace by id, clear by id, clear by actor, actor/path lookup, stale state after 15 seconds, and removal after 30 seconds.
- No durable CRDT history, undo/redo, or persistence code sees ephemeral messages.

## Phase 2: React helper surface

Expose a small helper from `react-crdt` so app code does not talk directly to transport internals.

Candidate API:

```ts
ctx.publishEphemeral(messages);
ctx.useEphemeral(query);
```

Do not make these method-level generics. `ctx.publishEphemeral<WhiteboardEphemeralData>(...)`
is not type-safe because the caller can supply any type argument. Bind the ephemeral data type
when creating the synced context/runtime instead, so the returned `ctx` has one fixed payload type:

```ts
const [ProvideWhiteboard, useWhiteboard] = createSyncedContext<
    WhiteboardState,
    'type',
    WhiteboardEphemeralData
>('type', equal, {
    validateEphemeralData: validateWhiteboardEphemeralData,
});

ctx.publishEphemeral(messages: EphemeralMessage<WhiteboardEphemeralData>[]);
ctx.useEphemeral(query): EphemeralRecord<WhiteboardEphemeralData>[];
```

For apps without ephemeral payloads, the default should be `never` or a similar disabled type,
forcing those apps to opt in explicitly before publishing typed ephemeral data.

Query shape can start simple:

```ts
type EphemeralQuery = {
    path?: Path;
    descendants?: boolean;
    kinds?: readonly string[];
};
```

Work:

- Add `publishEphemeral` to `SyncedContext`.
- Add `useEphemeral` or an exported hook that subscribes to the store.
- Bind the ephemeral data type on `createSyncedContext`/runtime creation rather than accepting a method-level generic on `publishEphemeral` or `useEphemeral`.
- Thread `EphemeralConfig<Data>` through the provider or context factory so receive-side validation has the same fixed data type.
- Ignore local actor messages on receive if the transport echoes them.
- Clear actor messages when a transport signals disconnect/leave, if available.
- Do not couple this to `when: 'preview'`.
- Keep `AppEditorContext` in `examples/react-crdt/src/lib/crdtApp.ts` in sync if whiteboard panels need the helper through the app abstraction.

Acceptance:

- React tests can publish an `EphemeralMessage<TestData>` and render it in another subscribed component.
- Type tests or compile-time examples show that a `SyncedContext<State, Tag, TestData>` cannot publish `EphemeralMessage<OtherData>`.
- Path-scoped subscription only rerenders for matching paths.
- Existing `when: 'preview'` tests still pass unchanged.

## Phase 3: Local simulator transport

Implement ephemeral messages in local simulator mode first because it is the fastest end-to-end test surface.

Current repo note:

- `examples/react-crdt/src/lib/local/useLocalDemoSync.ts` already has per-replica `StatusStore`s and a `setPresenceSelection` helper that broadcasts whiteboard selection while sync is enabled or disabled.
- Convert or bridge that selection helper to the generic ephemeral channel so selection, drag preview, and stroke preview use one path.
- Manual sync currently queues durable CRDT updates while disabled. Ephemeral events should be dropped while disabled, including selection changes, so disabled simulator sync behaves consistently for all presence-like data.

Likely files:

- `examples/react-crdt/src/lib/local/model.ts`
- `examples/react-crdt/src/lib/local/useLocalDemoSync.ts`
- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`

Work:

- Extend `DemoTransport` with ephemeral publish/subscribe/receive.
- Broadcast ephemeral messages while sync is enabled.
- Drop ephemeral messages while manual sync is disabled. Do not queue stale previews.
- Keep durable CRDT outbox behavior unchanged.
- Clear a replica actor's messages when appropriate, such as unmount/reset if the local simulator has that lifecycle.
- Retire the bespoke `broadcastPresenceSelection` path or make it a thin wrapper over typed ephemeral `selection` messages.

Acceptance:

- Two local simulator panels can exchange typed ephemeral messages without creating CRDT updates.
- Disabling sync drops new ephemeral messages and does not enqueue them.
- Re-enabling sync does not replay old preview positions.
- Existing local simulator selection presence behavior still works, but now follows the same sync-enabled/drop semantics as other ephemeral events.

## Phase 4: Server protocol and server runtime

Add server ephemeral presence events. These are broadcast-only and not persisted.

Current repo note:

- Client and server protocol versions are currently `3`.
- `presenceHello`, `presenceSelection`, `presenceSnapshot`, `presenceUpdate`, and `presenceLeave` already exist.
- Server mode already clears whiteboard selection statuses on `presenceLeave`; extend that clear to all ephemeral messages for the actor.
- `presenceSelection` can either remain as a compatibility/specialized message or be replaced by `presenceEvent` selection. Avoid keeping two divergent selection paths long-term.

Likely files:

- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt-server/src/protocol.ts`
- `examples/react-crdt-server/src/index.ts`
- `examples/react-crdt-server/src/types.ts`

Protocol shape:

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

Work:

- Bump protocol version if required by the existing protocol parser strategy.
- Parse and validate the message envelope.
- Validate actor/user/session exactly like `presenceHello`.
- Validate `docId` and branch scope.
- Validate `event.actor === actor`.
- Validate `event.data` using app-provided validator on the browser receive side. If the server cannot know the app schema, enforce envelope validity, payload byte limit, and allowed message size.
- Broadcast only to clients on the same `docId` and `branchId`.
- Do not persist ephemeral messages in `ServerStore`.
- On socket close, broadcast or synthesize clears for the leaving actor, or let clients clear all messages for that actor on `presenceLeave`.
- Expose current ephemeral counts in debug output only if cheap.

Acceptance:

- Server accepts valid `presenceEvent` and broadcasts it only to same doc/branch peers.
- Server rejects invalid actor/user/doc/branch envelopes.
- Server does not write ephemeral messages to branch events or persistence.
- Client clears session-level actor messages on `presenceLeave` and branch switch.
- Existing `presenceSelection` tests/flows either pass unchanged through a compatibility path or are migrated to assert equivalent `presenceEvent` selection behavior.

## Phase 5: Whiteboard payloads, validators, and preview store adapter

Add whiteboard-specific ephemeral data and validation.

Current repo note:

- The whiteboard app now exists in `examples/react-crdt/src/apps/whiteboard`.
- Durable whiteboard state validation already uses typia in `schema.ts`; put ephemeral payload validation beside the whiteboard app, likely in a new `ephemeral.ts`.
- Selection presence currently uses `whiteboardSelectionStatusKind` and `setPresenceSelection`; migrate this to the typed `selection` payload or keep a short compatibility adapter during the transition.

Likely files:

- `examples/react-crdt/src/apps/whiteboard/model.ts`
- `examples/react-crdt/src/apps/whiteboard/ephemeral.ts`
- `examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx`

Work:

- Define `WhiteboardEphemeralData`.
- Add a validator, preferably generated with the same typia pattern used for durable app state.
- Add helpers:
  - `elementPreviewMessage(actor, elementId, transform)`;
  - `strokePreviewMessage(actor, strokeId, points)`;
  - `selectionMessage(actor, elementIds, bounds)`;
  - `clearEphemeralMessage(actor, id)`.
- Adapt path-bearing messages into the local preview/status store.
- Keep remote preview rendering joined only by actor id; actor color/nickname should come from existing presence data if the UI wants it.
- Reuse the existing selection badge rendering where possible, but source its data through the generic ephemeral adapter.

Acceptance:

- Invalid whiteboard ephemeral data is ignored at receive boundaries.
- Messages use stable path targets like `elements[id]`.
- Selection is path-scoped.
- Session-level actor ids keep two tabs from clobbering each other.
- Existing remote selection badges still render in local simulator and server modes.

## Phase 6: Whiteboard interaction integration

Wire shared preview into whiteboard interactions.

Current repo note:

- Element move/resize currently uses local `when: 'preview'` patches during pointer move and commits on pointer up.
- Freehand drawing already keeps in-progress points in local React state and commits one durable stroke on pointer up.
- The first implementation can preserve these local paths and add remote overlay publication/rendering. Converting local drag to overlay rendering can be a follow-up unless symmetry is required for the initial acceptance check.

Work:

- For element drag/resize:
  - render the active local drag as an overlay;
  - publish throttled `element-preview` messages;
  - commit the durable `x`/`y`/size update only on pointer up;
  - send explicit clear on pointer up/cancel, or rely on a short TTL only where explicit clear is impossible.
- For freehand drawing:
  - keep local points outside CRDT during pointer movement;
  - publish throttled `stroke-preview` messages;
  - commit one durable stroke element on pointer up;
  - clear the stroke preview after commit/cancel.
- For selection:
  - publish path-scoped `selection` messages;
  - clear or expire selection on tool changes, branch switches, and disconnect.
- Render remote previews as overlays with pointer events disabled.
- Apply staleness visuals:
  - normal until 15 seconds;
  - partially transparent from 15 to 30 seconds;
  - hidden/removed after 30 seconds.

Acceptance:

- Dragging an element in one local simulator panel shows a remote overlay in the other panel without creating durable updates until pointer up.
- The final committed element position syncs through normal CRDT updates.
- Stale overlays fade after 15 seconds and disappear after 30 seconds.
- Local and remote drags both use overlay rendering, so the interaction model is symmetric.
- If local drag remains implemented with `when: 'preview'` initially, add a follow-up acceptance item to convert it to overlay rendering after remote overlays land.

## Phase 7: PeerJS follow-up

PeerJS should use the same typed message shape, but it can follow server/local simulator.

Likely files:

- `examples/react-crdt/src/lib/peerjs/protocol.ts`
- `examples/react-crdt/src/lib/peerjs/usePeerJsSync.ts`

Work:

- Add `ephemeral` peer message type.
- Validate envelope and data on receive.
- Host rebroadcasts client ephemeral messages to other clients.
- Do not include ephemeral messages in snapshots.

Acceptance:

- Host/client can exchange whiteboard ephemeral messages.
- Snapshots remain durable-document-only.

## Phase 8: Tests and verification

Core/react tests:

- `EphemeralMessage<Data>` type export compiles.
- required transport methods do not break existing test transports once they add explicit drop/no-op ephemeral implementations.
- publish/subscribe lifecycle works.
- clear and TTL behavior works.
- path-scoped subscriptions work.

Local simulator tests:

- sync enabled broadcasts ephemeral messages.
- sync disabled drops ephemeral messages.
- durable update outbox behavior is unchanged.

Server tests/manual checks:

- valid presence event broadcasts same doc/branch only.
- invalid envelope is rejected.
- actor/user mismatch is rejected.
- messages are not persisted.
- presence leave clears actor overlays.

Whiteboard browser checks:

- desktop and mobile pointer drag coordinates remain aligned.
- local and remote overlays do not block pointer events.
- stale opacity/removal behavior is visible.
- final durable commit clears or supersedes active overlay.

Suggested commands:

```sh
pnpm test
pnpm --dir examples/react-crdt test
pnpm --dir examples/react-crdt-server test
pnpm --dir examples/react-crdt build
```

Adjust commands to the repo's actual package scripts before running.

## Implementation order

1. Add shared `EphemeralMessage<Data>` types and required transport methods.
2. Add ephemeral store and React helper surface.
3. Implement local simulator ephemeral transport and tests.
4. Implement server protocol/runtime ephemeral forwarding and tests.
5. Add whiteboard ephemeral data types and validators.
6. Integrate element drag overlays.
7. Integrate stroke previews and selection.
8. Add PeerJS ephemeral forwarding if needed.
9. Promote any stable example-local helpers into `umkehr/react-crdt` only after the whiteboard API has settled.
