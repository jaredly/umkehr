# Research: Convert `examples/react-crdt` to CSS Modules

## Goal

Convert `examples/react-crdt` away from a single catch-all `src/style.css` into CSS Modules colocated with the app/runtime areas that use them.

## Current State

`examples/react-crdt/src/App.tsx` imports one global stylesheet:

- `examples/react-crdt/src/style.css`

That file is 1,815 lines and mixes several concerns:

- Global reset/base element styling: `*`, `body`, `button`, `input`, `select`, `h1`, `p`.
- Demo chrome: top bar and document manager.
- Todo app panels, todo rows, color picker, reorder/drop indicators, presence cursors.
- Local simulator sync rail.
- Solo history tree.
- PeerJS/local-first controls and connection lists.
- Server toolbar, login, branch history, merge preview, stale review.
- Whiteboard panel, toolbar, canvas, overlays, notes, strokes, minimap.
- Shared responsive rules at the end of the file.

The project already uses Vite. CSS Modules should work without new dependencies by renaming files to `*.module.css` and importing them from TSX. The existing `src/vite-env.d.ts` references `vite/client`, which includes module CSS typing.

## Likely Module Boundaries

Recommended split:

- `src/styles/global.css`
  - Keep only global reset/base selectors and intentionally global element defaults.
  - Likely includes `*`, `body`, `button`, `button:hover`, `button:disabled`, `input/select font`, and maybe shared heading/paragraph reset if still wanted globally.
- `src/lib/chrome/DemoTopBar.module.css`
  - `demoTopBar`, `topBarGroup`, `topBarPrimary`, `topBarActions`, `topBarMessage`.
- `src/lib/documentArchive/DocumentArchive.module.css`
  - `documentManager`, modal, rows, badges, `dangerButton`, hidden archive input.
- `src/apps/todos/Todos.module.css`
  - Todo panels, add form, color picker, list, row, drag/drop modifiers, title/details/actions, priority/notes extras, todo presence cursors.
- `src/lib/local/LocalSimulatorApp.module.css` or `SyncControls.module.css`
  - `collabShell`, `syncRail`, `syncIndicator`, `queueCounts`.
- `src/lib/solo/SoloApp.module.css` and `HistoryView.module.css`
  - `soloShell`, history tree classes.
- `src/lib/peerjs/PeerJs.module.css`
  - `peerShell`, `peerControls`, peer facts/connect/invite/connection rows.
- `src/lib/local-first/LocalFirst.module.css`
  - `localFirstShell`, `localFirstControls`, stats, replay preview, compaction risk list.
- `src/lib/server/Server.module.css`
  - `serverShell`, `serverControls`, identity, roster, login, document, history, branch/merge/stale-review UI.
- `src/apps/whiteboard/Whiteboard.module.css`
  - Whiteboard panel, toolbar, archive, viewport, canvas, SVG/element styles, overlays, minimap, responsive behavior.

Some shared-looking selectors can be duplicated initially if they are small. A shared module is only worth adding if it prevents real churn, because cross-module class dependencies can recreate the coupling this task is trying to remove.

## Implementation Notes

Use CSS Module imports in each component:

```tsx
import styles from './Todos.module.css';

<section className={`${styles.todoPanel} ${styles.leftPanel}`}>
```

For modifiers, prefer arrays or small helpers over raw string concatenation:

```tsx
const className = [
    styles.todoItem,
    done ? styles.done : '',
    isDragging ? styles.dragging : '',
    dropPosition === 'before' ? styles.dropBefore : '',
    dropPosition === 'after' ? styles.dropAfter : '',
].filter(Boolean).join(' ');
```

For selectors that depend on descendants or modifiers, keep them within the same module where possible:

- `.todoItem:hover .dragHandle`
- `.done .todoTitle`
- `.whiteboardNote.selected`
- `.serverToolbarNotice.warning .serverToolbarNoticeIcon`

If a component needs to pass a styling slot to child components, prefer passing CSS module class names through props rather than falling back to global class names. Existing examples include todo panel slot classes and whiteboard element helper class names.

## Test Impact

Several Playwright helpers currently depend on global class names:

- `tests/helpers/todos.ts`
  - `.todoPanel`
  - `.todoItem`
  - `.titleInput`
  - `.todoTitle`
  - `.dropBefore` / `.dropAfter`
  - runtime animation recorder uses `closest('.todoItem')` and `closest('.todoPanel')`.
- `tests/helpers/whiteboard.ts`
  - `.whiteboardNoteHandle`.

After CSS Modules, these selectors will be hashed and should not be used as public test API. Recommended test updates:

- Add stable `data-testid` attributes for todo panel, todo row, title input, todo title, and drag/drop state where needed.
- Replace `toHaveClass(/dropBefore|dropAfter/)` with a stable attribute such as `data-drop-position="before|after"`.
- Update the todo animation recorder to use `data-testid`/attributes instead of class selectors.
- Replace `.whiteboardNoteHandle` with a test id or accessible role/name if the handle remains non-interactive.

Existing whiteboard tests already use many `data-testid`s, so the todo helpers are the bigger test migration.

## Risks

- CSS Module hashing will break any class selectors outside the owning component unless those selectors are migrated at the same time.
- Some current styles rely on generic global modifiers like `button.active`. Those need to become component-local `styles.active` usages, otherwise active state styling may disappear.
- Some current class names are shared across unrelated areas, especially `active`, `connectionActions`, `connectionRow`, `waitingPanel`, and `presenceAvatar`. Splitting modules will reveal whether those were intentionally shared or just convenient reuse.
- Responsive rules currently live at the bottom of the global file and affect multiple areas. They need to move with the modules they target, or be split into matching media queries across modules.
- Global `h1` and `p` styling may have hidden reach. Moving those into modules can cause small visual differences unless headings/paragraphs in each panel receive local classes or the global baseline is intentionally retained.

## Suggested Migration Sequence

1. Create `src/styles/global.css` and move only reset/base styles there. Update `App.tsx` to import it.
2. Migrate the smallest isolated area first, likely `DemoTopBar` or `documentArchive`, to establish import/class composition style.
3. Migrate todos and update todo Playwright helpers away from class selectors.
4. Migrate whiteboard and replace the remaining whiteboard class-based handle selector.
5. Migrate runtime shells/controls: local, solo, peerjs, local-first, server.
6. Run `pnpm build` and the relevant Playwright smoke suite from `examples/react-crdt`.

## Open Questions

- Should any base element styles stay global beyond reset and font inheritance, especially `button`, `h1`, and `p`?
  - yes
- Are Playwright helpers allowed to be changed from class selectors to `data-testid`/state attributes as part of this task?
  - yes
- Should visually shared primitives like `waitingPanel`, `presenceAvatar`, `connectionRow`, and `connectionActions` be duplicated inside feature modules, or extracted into a small shared module?
  - small shared module
- Is the preferred style one module per component file, or one module per feature area? Given the current stylesheet size, feature-area modules look like the lower-churn first pass.
  - feature-area sounds good
