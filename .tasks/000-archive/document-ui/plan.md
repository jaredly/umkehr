# Document UI Plan

## Goal

Make `examples/react-crdt` use one coherent top bar for the global demo controls:

- app selector: Todo vs Whiteboard
- architecture selector: Solo, Local, PeerJS, Local-first, Server
- document selector for the active app/architecture
- document import/export actions

The result should replace the current mix of app buttons, mode buttons, per-mode document toolbars, and per-mode import/export placement without changing the underlying document persistence, seed, sync, or archive behavior.

## Current State

- `src/App.tsx` renders `AppPicker` and `ModeTabs` above the active architecture shell.
- `src/lib/AppPicker.tsx` and `src/lib/ModeTabs.tsx` are button groups, not dropdowns.
- `src/lib/useHashMode.ts` currently stores app and architecture in `window.location.hash`, while documents are stored in the search query as `?doc=...`.
- `src/lib/documentArchive/index.tsx` already contains reusable `DocumentPicker` and `DocumentArchiveControls`, but every architecture wires them differently.
- `src/lib/seed/SeedDocumentPicker.tsx` is separate from the active document picker. Seeds are currently imported via an "Open seed" action, not represented as normal document options.
- `SoloApp`, `LocalSimulatorApp`, `PeerJsApp`, `LocalFirstApp`, and `ServerApp` each own their active doc id, document summary loading, seed import, archive adapter, and document switching.
- `ServerApp` is the outlier: server document choices come from `src/lib/server/documents.ts` and `ServerControls`, and server seed state is managed by `ServerClientSeedControls`.
- `LocalFirstControls` currently renders its import/export controls inside the side panel even though the task wants import/export in the top bar.

## Design Direction

Keep document lifecycle ownership inside each architecture shell, but let each shell register its current top-bar document controls with a shared app-level chrome.

This avoids forcing all architectures into one document-management abstraction before their behavior is actually uniform. The top bar becomes the single visual home for controls, while each architecture still supplies the document list, selected doc, switch handler, import/export adapter, and disabled/loading state it already knows how to compute.

## Proposed Structure

Add a small UI shell layer under `src/lib/chrome`:

```text
src/lib/chrome/
  DemoTopBar.tsx
  TopBarContext.tsx
```

`DemoTopBar` renders:

- App `<select>` from `apps`.
- Architecture `<select>` from a central mode option list.
- Document slot supplied by the active architecture.
- Import/export slot supplied by the active architecture.

`TopBarContext` exposes a registration API:

```ts
export type TopBarDocumentControls = {
    documentPicker?: React.ReactNode;
    archiveControls?: React.ReactNode;
    seedControls?: React.ReactNode;
    statusMessage?: React.ReactNode;
};
```

Architecture shells call a hook such as `useTopBarControls(...)` after they have enough state to render their controls. The provider clears controls when the active app/mode changes or when the registering component unmounts.

Move top-level selection into the search query while doing this work. The canonical URL shape should become:

```text
/?app=whiteboard&mode=local-first&doc=whiteboard-many-events
```

Defaults can still be omitted, so the default Todo/local/default-doc state may remain `/` or `/?doc=todos-small` depending on the selected document. The hash should no longer be read or written for app or architecture selection.

## Implementation Steps

1. Move app/mode routing from hash to search params

Replace `useHashMode.ts` with a search-param based selection hook, or rename it to `useUrlSelection.ts`:

- parse `mode`, `app`, and existing `doc` from `window.location.search`;
- write app and mode changes through `window.history.pushState`;
- preserve unrelated query params such as PeerJS invite `peer`;
- omit default `app` and `mode` values when serializing;
- listen for `popstate` instead of only `hashchange`;
- remove the old hash parsing and serialization helpers.

2. Add mode metadata

Create one shared mode option list next to `useHashMode.ts` or in a new `modeOptions.ts`:

- `value: AppMode`
- `label`
- optional `description`

Use it in the new top bar and retire hard-coded labels from `ModeTabs`.

3. Build the shared top bar

Create `DemoTopBar` with native dropdowns:

- app select value is `app.id`, `onChange` calls `setAppId`
- architecture select value is `mode`, `onChange` calls `setMode`
- document area renders the current registered document picker
- action area renders registered import/export controls

Replace `AppPicker` and `ModeTabs` usage in `src/App.tsx` with:

```tsx
<TopBarProvider resetKey={`${app.id}:${mode}`}>
    <DemoTopBar ... />
    <ActiveArchitecture />
</TopBarProvider>
```

The reset key prevents stale controls from the previous architecture from lingering while the next shell loads.

4. Move existing document controls into the top bar

For each architecture, keep the existing state and handlers, but register controls instead of rendering them in local `documentToolbar` blocks:

- `SoloApp`: register `DocumentPicker`, `SeedDocumentPicker`, and `DocumentArchiveControls` from `SoloDocument`.
- `LocalSimulatorApp`: register `DocumentPicker`, `SeedDocumentPicker`, and `DocumentArchiveControls` when histories are loaded.
- `PeerJsApp`: register document controls only when `role === 'host'`; clients should show no document import/export actions or show a disabled/status message.
- `LocalFirstApp`: register `DocumentPicker`, `SeedDocumentPicker`, and the local-first `DocumentArchiveControls` currently nested inside `LocalFirstControls`.
- `ServerApp`: move the server document picker out of `ServerControls` into the top bar. Keep server sync status, login/logout, presence, and offline controls in `ServerControls`.

During this step, remove now-empty `documentToolbar` containers from architecture shells.

5. Normalize document picker behavior

Make the document dropdown read as one coherent control across architectures:

- local modes should use the existing `DocumentPicker`.
- server mode can either adapt `ServerDocumentSummary` to `LocalDocumentSummary` or keep a server-specific option renderer behind a shared `DocumentSelect` component.
- seed documents should be included in the document dropdown where practical, because the task asks for "the document" dropdown and seeds are now the common demo documents.

Recommended first pass:

- merge branch-free seed summaries into each architecture's document list before passing to `DocumentPicker`;
- when a selected seed doc is not persisted yet, switching to it should continue to trigger the existing `loadOrCreate...` seed path;
- keep explicit seed scenario controls only for server client state, because that is not just document selection.

Document switching should use the same search-param writer as app/mode selection instead of each architecture constructing URLs independently. Keep current `?doc=` compatibility, but move helper ownership out of `documentArchive` if the URL helpers become general app routing utilities.

6. Rework import/export controls

Keep `DocumentArchiveControls` as the functional import/export implementation, but make it visually fit the top bar:

- allow compact labels or icon-like button styling through CSS/classes if needed;
- keep the hidden file input inside the component;
- surface archive error messages in the top bar without shifting the whole layout.

For `LocalFirstControls`, remove the nested archive controls and rely on the registered top-bar controls.

7. Update CSS

Replace `.appPicker`, `.modeTabs`, and scattered `.documentToolbar` layout rules with top-bar styling:

- sticky or fixed-height top bar at the top of the viewport;
- responsive wrapping for narrow widths;
- labels remain accessible but compact;
- app, architecture, and document dropdowns have stable widths;
- import/export actions stay aligned and do not overlap status text.

Adjust shell top padding/min-height calculations where they assumed the old two-row button navigation.

8. Tests and verification

Add/update focused tests:

- URL selection tests: search-query parsing/serialization for app, mode, and doc; default omission; unrelated query param preservation; hash clearing on writes.
- A small component test for `DemoTopBar` if a React test harness already exists; otherwise keep this to integration coverage.
- Playwright coverage should replace the placeholder external Playwright tests with local app checks:
  - app selector switches Todo/Whiteboard;
  - architecture selector switches at least Solo/Local;
  - document selector can switch to a seeded document;
  - import/export buttons are visible in the top bar for modes that support them;
  - PeerJS client mode does not expose host-only document controls.

Run:

```sh
cd examples/react-crdt
pnpm build
```

If Playwright is made local in this task, also run the example E2E suite.

## Acceptance Criteria

- A single top bar contains app, architecture, document, import, and export controls.
- App and architecture controls are dropdowns, not separate button rows.
- The active document dropdown works for Todo and Whiteboard across supported architectures.
- Seed documents remain easy to open through the document flow.
- Import/export remains archive-format compatible and still validates app/payload kind.
- Server-specific controls still work, but document selection is no longer buried in `ServerControls`.
- Local-first import/export is no longer buried in the side panel.
- The canonical URL uses search params for `app`, `mode`, and `doc`; old hash-based routing is removed.
- Existing invite/query parameters, especially `peer`, remain compatible.
- `pnpm build` passes for `examples/react-crdt`.

## Risks and Notes

- Server mode has the most special document flow because it combines remote summaries, local replicas, branch-aware seed data, login state, and server client seed scenarios.
- Local-first switches documents by reloading the page. The top bar should not hide that behavior; it can register the same switch handler initially.
- Import/export adapters are often created inside provider/editor contexts. For modes like Solo, the archive controls may need to stay in a child component that has editor access and register into the top bar from there.
- Avoid a large persistence refactor in this task. The top bar should consume existing architecture-level state instead of becoming the owner of all document state.
