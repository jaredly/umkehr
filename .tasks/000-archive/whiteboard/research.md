# Collaborative whiteboard research

This document maps what would go into adding a collaborative whiteboard as a new app under `examples/react-crdt/src/apps`, with sticky notes, freehand vector drawing, and emoji stamps.

## Current example architecture

The React CRDT example is set up around app definitions, not hard-coded Todo behavior.

Relevant files:

- `examples/react-crdt/src/lib/crdtApp.ts` defines the app contract:
  - `AppDefinition<TState>`: id, title, tag key, typia schema, state validator, initial state, optional initial timestamp, and `renderPanel`.
  - `CrdtRuntime<TState>`: CRDT document id plus the React CRDT provider/hook.
  - `HistoryRuntime<TState>`: local history provider/hook for solo mode.
- `examples/react-crdt/src/apps/todos/model.ts` shows the app model pattern:
  - define state types;
  - generate a typia JSON schema and validator;
  - create a history context with `createHistoryContext`;
  - create a synced context with `createSyncedContext`;
  - export initial state and initial HLC timestamp.
- `examples/react-crdt/src/apps/todos/TodoApp.tsx` adapts the app model to the generic runtime contract.
- `examples/react-crdt/src/lib/appRegistry.ts` currently registers only Todos and exports it as the default app.
- `examples/react-crdt/src/App.tsx` always renders `defaultApp` in the selected sync mode. There is no app picker yet.

The reusable editor context already gives app panels enough to build a whiteboard:

- `useValue(editor.$.some.path)` for path-scoped rendering;
- `editor.$` typed patch builder for updates;
- `dispatch(...)` for explicit batched/nested patches;
- `undo`, `redo`, `canUndo`, `canRedo`;
- CRDT sync through server, local simulator, PeerJS, and local-first modes;
- path-scoped status metadata through `useStatuses` when a status store is available.

## Recommended app shape

Add a new app folder:

- `examples/react-crdt/src/apps/whiteboard/model.ts`
- `examples/react-crdt/src/apps/whiteboard/WhiteboardApp.tsx`
- `examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx`
- optional split files later: `geometry.ts`, `tools.ts`, `rendering.tsx`, `ids.ts`

Then register it in `examples/react-crdt/src/lib/appRegistry.ts`.

To make it usable, the shell also needs either:

- a simple app picker in `App.tsx` / app registry, or
- making whiteboard the new `defaultApp` while developing.

Without that shell change, the new app can exist in `src/apps` but will not be reachable from the demo UI.

## State model

Use one CRDT document for the board. Keep durable collaborative content in the document and keep transient UI state local.

Suggested durable state:

```ts
export type WhiteboardState = {
    background: string;
    elements: Record<string, WhiteboardElement>;
};

export type WhiteboardElement =
    | StickyNoteElement
    | StrokeElement
    | EmojiStampElement;

export type BaseElement = {
    type: 'note' | 'stroke' | 'emoji';
    id: string;
    x: number;
    y: number;
    rotation: number;
    zOrder: string;
    createdBy: string;
    createdAt: string;
    archived: boolean;
    archivedBy?: string;
    archivedAt?: string;
};

export type StickyNoteElement = BaseElement & {
    type: 'note';
    width: number;
    height: number;
    color: string;
    text: string;
};

export type StrokeElement = BaseElement & {
    type: 'stroke';
    color: string;
    width: number;
    points: StrokePoint[];
};

export type StrokePoint = {
    x: number;
    y: number;
    pressure?: number;
};

export type EmojiStampElement = BaseElement & {
    type: 'emoji';
    emoji: string;
    size: number;
};
```

Notes:

- Use `type` as the discriminant to match the existing app contexts.
- Store elements in a record keyed by app-level element id. This makes element updates stable across layering changes and avoids repeatedly resolving a visible element back to its current array index.
- Keep `id` on the element value too. It is redundant with the record key, but useful for React keys, serialized element payloads, selection, hit testing, and future import/export.
- Use each element's `zOrder` field as the draw order. The value should be a fractional-index string produced by the same `fractionalIndexBetween` machinery used by CRDT arrays, without keeping a separate array of ids.
- Archive elements instead of deleting them. Archived elements stay in `elements` with their `zOrder` intact and can be recovered by clearing `archived`, `archivedBy`, and `archivedAt`.
- Keep viewport, selected tool, selected element id, drag handles, in-progress stroke, and hover state outside the CRDT document. Those are per-client UI concerns.

## Rendering architecture

Use an SVG-based board for the first implementation.

Why SVG:

- freehand drawing is naturally rendered as `<path>` data or `<polyline>`;
- sticky notes and emoji can be positioned in the same coordinate space;
- individual elements remain addressable for pointer events, selection outlines, and accessibility labels;
- it avoids a canvas invalidation layer while the app is still an example/demo.

The panel can render:

- a toolbar for select, note, pen, emoji, undo, redo;
- a full board surface with CSS-managed size;
- one SVG layer for strokes and selection affordances;
- absolutely-positioned HTML sticky notes if text editing needs normal inputs/textareas;
- SVG or HTML emoji stamps depending on hit-testing convenience.

Coordinate handling should convert pointer client coordinates into board coordinates through the board element's bounding rect. If zoom/pan is added, introduce a small `screenToBoard` helper early so future transforms stay contained.

## Operation design

Sticky notes:

- Add: generate an id, choose a fractional `zOrder` after the current top element, and add `elements[id] = note`.
- Move: update `x` / `y` fields.
- Resize: update `width` / `height`.
- Edit text: update `text` on commit or debounce while typing.
- Archive: set `elements[id].archived = true` plus archive metadata. Keep the element's `zOrder` so recovery preserves layering.
- Recover: clear the archive fields for that element.

Emoji stamps:

- Add: generate an id, choose a fractional `zOrder` after the current top element, and add `elements[id] = emoji`.
- Move/resize/archive/recover use the same element operations as notes.
- Emoji picker can start with a small fixed palette.

Freehand vectors:

- During pointer drag, store the active stroke only in local React state for immediate visual feedback.
- On pointer up, simplify/smooth if desired, then add one `stroke` element to the CRDT document with a fractional `zOrder` after the current top element.
- Do not append every pointer sample directly to the CRDT document as it arrives. That would create many CRDT updates, many undo entries, and a lot of array metadata.
- Store points as JSON arrays initially. If large strokes become a problem, switch to a compact encoded path string or SVG path data.

Element lookup:

- Element field updates can address `editor.$.elements[id]` directly.
- Layering operations update the target element's `zOrder` field. Bring-forward/send-backward can compute a new fractional index between neighboring visible elements.
- Rendering should derive visible ordered elements from `Object.values(elements).filter((element) => !element.archived).sort(byZOrderThenId)`.
- A recovery/trash view can list `Object.values(elements).filter((element) => element.archived)` in archived-at order.

## CRDT fit

The existing CRDT model is a good fit for object-level whiteboard collaboration.

Works well today:

- adding elements in a record by stable id;
- archiving/recovering elements through ordinary field updates;
- layering elements through ordinary `zOrder` field updates;
- independent field edits on the same object, such as one user moving a note while another edits its color;
- undo/redo of local commands;
- offline/local-first/server/PeerJS transport reuse;
- schema validation through typia;
- path-based rendering and status subscriptions.

Expected conflict behavior:

- primitive fields are last-writer-wins by HLC timestamp, so concurrent edits to the same note text or same `x` coordinate resolve to one winner;
- concurrent edits to different fields of the same element merge;
- concurrent element inserts with different ids both survive in the `elements` record;
- concurrent `zOrder` edits on the same element are last-writer-wins; concurrent additions at the same layer can be rendered deterministically by sorting by `zOrder` and then `id`;
- archiving an element while another user edits it preserves the element record; field-level last-writer-wins still applies if users concurrently edit archive metadata or the same element field.

This is acceptable for a demo whiteboard, but not equivalent to Figma-level collaborative editing.

## Missing or insufficient APIs

### App selection

The app registry supports multiple registered apps, but the shell always renders `defaultApp`. A whiteboard app needs an app picker, route/hash parameter, or temporary default switch.

### Preview-driven high-frequency input

The existing `when: 'preview'` API is the right fit for high-frequency local interactions. The app can dispatch many preview updates during pointer movement, render them through the normal `useValue` path subscriptions, and then dispatch one committed update on pointer up.

Recommended use:

- moving/resizing elements can update `x`, `y`, `width`, and `height` with `when: 'preview'` during drag, then commit the final values once;
- pen strokes can keep raw pointer samples local while drawing, or preview a draft stroke element if rendering through document-shaped state is useful;
- tool hover states such as color previews can use the same mechanism already demonstrated by the Todo color picker.

Remaining gaps:

- live collaborative in-progress strokes would need an ephemeral channel rather than document updates;
- preview state is local only and should not be treated as remote presence;
- the app must explicitly clear previews on cancel/escape/pointer-cancel and commit final values on pointer-up.

### Live presence payloads

The status store can render path-scoped metadata, and server mode already has last-edit presence statuses. It does not expose an app-level way to publish arbitrary ephemeral cursor, selection, or in-progress drawing data.

Impact:

- "Alice is currently drawing this stroke" is not currently supported as a first-class API;
- remote selection rectangles would need new server protocol/status messages;
- local simulator and PeerJS modes would need equivalent ephemeral transport behavior if parity matters.

Potential API:

```ts
transport.publishPresence({kind: 'whiteboard:cursor', data})
usePresence(kind)
```

or an example-only server extension that writes these into a `StatusStore`.

### Collaborative text inside sticky notes

Sticky note `text: string` will be last-writer-wins. That is fine for simple notes committed on blur, but simultaneous character-level editing in the same note is not supported.

If collaborative rich text is a requirement, this needs either:

- a text CRDT type/API, or
- treating note text as line/paragraph arrays with app-level merge limitations.

### Record key and z-order ergonomics

Using a record for `elements` makes element field addressing straightforward: `editor.$.elements[id].x(...)`, `editor.$.elements[id].text(...)`, and `editor.$.elements[id].archived(true)`.

Impact:

- record keys must be valid property names in the patch builder path model; generated ids should be strings without surprising characters, even though the path segment type supports string keys generally;
- adding an element should assign a fractional `zOrder` value as part of the element payload;
- archiving does not need to update `zOrder`; preserving the value makes accidental recovery restore the same layer position;
- the app should reuse the existing fractional-index helper for "top", "bottom", "between these two neighbors", "bring forward", and "send backward";
- statuses and remote selections can target `elements[id]` stably, including layer/order indicators at `elements[id].zOrder`.

Potential helper:

```ts
addElement(editor, element)
archiveElement(editor, id, actor)
recoverElement(editor, id)
moveElementLayer(editor, id, placement)
orderedElements(state)
```

These can live in the whiteboard app without changing core APIs. The existing `fractionalIndexBetween` helper is currently implemented under `src/crdt/fractionalIndex.ts` but is not exported from `umkehr/crdt`; exporting it would let the example reuse the exact array-order machinery instead of duplicating it.

### Document size and compact vector storage

CRDT values are JSON. A long stroke as hundreds or thousands of point objects is valid but expensive.

Possible mitigations:

- simplify points before commit;
- store points as `[x, y, pressure?][]` tuples instead of objects;
- store SVG path data string;
- add a compact/binary attachment story later if whiteboard drawings become large.

### Archive/update UX semantics

The whiteboard should prefer archiving over hard deletion so accidental deletion can be recovered without relying only on undo history.

UI decisions:

- archiving hides an element immediately for everyone but leaves the record in the document;
- recovery should be a visible trash/archive action, not only undo;
- edits to archived elements should probably be disabled in the main board, but a recovery view can show previews;
- a future hard-delete/compact action could permanently remove old archived elements, but that should be separate from normal deletion.

## Testing and validation

Suggested implementation checks:

- Typecheck/build: `pnpm --dir examples/react-crdt build` or the repo's equivalent package command.
- Solo mode:
  - add note/stamp/stroke;
  - edit note text;
  - move/resize/archive/recover;
  - undo/redo each operation.
- Local simulator mode:
  - create elements in both panels while sync is enabled;
  - create elements while sync is paused, then resume;
  - concurrent moves of the same element;
  - archive in one panel while editing/moving in the other;
  - recover an archived element and confirm it returns at its prior layer.
- Server/local-first modes:
  - reload persistence;
  - validate schema migration behavior if the app doc id changes;
  - confirm large strokes do not make the UI sluggish.
- Visual/browser checks:
  - pointer coordinates are correct after scrolling and resizing;
  - touch and mouse input both work;
  - text does not overflow toolbar/buttons;
  - strokes render nonblank and stay aligned with hit targets.

## Open questions

- Should the first version include an app picker, or should whiteboard temporarily become the default demo app?
  - app picker & location.hash update
- Should sticky note text update live while typing, on debounce, or only on blur/Enter?
  - let's go with blur/enter for now
- Should moves/resizes commit continuously for remote live movement, or only on pointer up to keep undo history clean?
  - pointer up
- Are in-progress remote cursors/strokes required for v1, or is final committed content enough?
  - final committed is enough
- Should strokes be stored as point arrays, SVG path strings, or a compact tuple format?
  - point arrays, but let's simplify before saving
- Should erasing archive whole stroke objects only, or should the app support partial stroke erasing?
  - whole stroke
- Should selection be local only, or visible to other collaborators?
  - extending the presence api for selection broadcast would be great
- Does v1 need zoom/pan and an infinite canvas, or a fixed-size board surface?
  - yes please with a minimap
- Should emoji stamps use native emoji text rendering, or image/SVG assets for cross-platform consistency?
  - native emoji is fine
- What scale should the example target: tens of elements, hundreds of elements, or dense drawing sessions?
  - at least hundreds of elements
