# Research: Wordsearch PeerJS Mobile Friendliness

## Goal

Make the dedicated `examples/react-crdt` Wordsearch PeerJS demo mobile friendly.

Task source: `.tasks/05hgb-mobile-friendly/task.md`

## Relevant Files

- `examples/react-crdt/wordsearch-peerjs.html`
- `examples/react-crdt/src/wordsearch-peerjs-main.tsx`
- `examples/react-crdt/src/apps/wordsearch/WordsearchPeerJsDemo.tsx`
- `examples/react-crdt/src/apps/wordsearch/WordsearchPanel.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsControls.tsx`
- `examples/react-crdt/src/style.css`
- `examples/react-crdt/vite.wordsearch-peerjs.config.ts`
- `examples/react-crdt/tests/peerjs/`
- `examples/react-crdt/tests/smoke/responsive-keyboard.spec.ts`

## Current State

The dedicated page already has the basic mobile viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

The dedicated entrypoint renders only `WordsearchPeerJsDemo`, so the mobile work can be scoped to the dedicated Wordsearch PeerJS shell and the shared Wordsearch panel styles without needing to account for the main demo top bar.

`WordsearchPeerJsDemo` renders:

- A top PeerJS control strip with `PeerJsControls` in `variant="bar"` mode.
- A host-only `New game` button.
- A host or client `WordsearchPanel`.
- Client waiting/loading panels.

`PeerJsControls` bar mode includes:

- Host/client role buttons.
- A compact connection status.
- A host-only `Copy invite` button.
- A client-only host Peer ID input and `Connect` button.

There is already a general responsive CSS block at `@media (max-width: 820px)` that affects the dedicated demo:

- `.wordsearchPeerDemo` switches to a single column, although it is already one column.
- `.wordsearchPeerControls`, `.peerControls`, and `.localFirstControls` become `position: static`.
- `.wordsearchPeerControls` stacks vertically.
- `.peerControlsBar` stretches its children.
- `.peerConnectBar` drops its `max-width`.

The Wordsearch board is currently fixed around an 8x8 layout:

- `.wordsearchBoard` width is `min(100%, 440px)`.
- It is square via `aspect-ratio: 1`.
- It uses `grid-template-columns: repeat(8, minmax(0, 1fr))`.
- It has a fixed `5px` grid gap.
- Cells use fixed `22px` type.
- Highlights assume 8 columns/rows with `12.5%` cell math.

The board disables native touch handling with `touch-action: none` and uses pointer events (`pointerdown`, `pointerenter`, `pointerup`, `pointercancel`) for drag selection.

## Likely Mobile Issues

1. The playable board is not explicitly centered.

   `.wordsearchPanel` is centered, but `.wordsearchBoard` does not use `margin: 0 auto` or justify itself. On a 390px viewport, the panel content width is roughly 334px after page and panel padding, so the board fits, but it will sit left-aligned within the panel.

2. The board can become tight on narrow screens.

   On a 320px viewport, `.wordsearchPeerDemo` leaves 16px gutters on each side and `.wordsearchPanel` adds 12px padding on each side. That leaves roughly 264px for the board. With 7 gaps of 5px, each cell is around 28.6px. This is usable, but below the commonly expected 40px+ touch target size.

3. Fixed cell typography may not scale gracefully.

   `22px` letters are fine at 440px but large for a 264px board cell. They probably still fit one character, but the proportions are not tuned for small viewports.

4. Highlight dimensions are tuned for larger cells.

   `.wordsearchHighlight` uses `height: calc(12.5% - 8px)` and `min-height: 30px`. On a small board, the min height can dominate the intended cell height. At about 264px board width, each cell is 33px before gaps and the highlight height minimum is nearly a full cell. This may look heavy or imprecise.

5. The header and action buttons are not responsive.

   `.wordsearchHeader` is always a single flex row. On narrow screens, the title/progress block plus Undo/Redo can crowd or wrap awkwardly. A mobile-specific stacked header would be more predictable.

6. The PeerJS control strip is partially responsive but not fully optimized.

   The existing `max-width: 820px` block stacks the outer controls. However, `.rolePicker` remains content-sized, `.peerStatusLight` is nowrap, and the client connect form still uses a two-column grid. On very narrow screens, the Peer ID input plus `Connect` button may be cramped.

7. Waiting panels likely need mobile padding.

   `.waitingPanel` receives border/card styling but no obvious padding in the inspected CSS near its base rule. If no later rule adds padding, the waiting states may appear cramped on mobile and desktop.

8. Touch drag behavior should be verified.

   The board relies on `pointerenter` during drag. Desktop mouse drag should work. Touch pointer movement may not fire `pointerenter` in the same way across browsers. If mobile testing shows missed cells, the implementation may need pointer capture plus coordinate-based cell lookup on `pointermove`.

## Suggested Implementation Direction

Keep the change mostly CSS-first unless mobile touch testing proves the pointer model is broken.

Recommended CSS changes:

- Add a small-screen rule for `.wordsearchPeerDemo` to use smaller gutters and padding, e.g. full width minus 16px instead of 32px.
- Center `.wordsearchBoard` and make its size explicitly viewport-aware, e.g. `width: min(100%, 440px, calc(100vw - 32px))`.
- Add mobile tuning for board gap, cell font size, border radius, and highlight stroke/height.
- Stack `.wordsearchHeader` on narrow screens and let `.wordsearchActions` fill or wrap.
- Make `.rolePicker`, `.copyInviteButton`, and `.newGameButton` stretch appropriately in the stacked mobile controls.
- At a narrower breakpoint, make `.peerConnect` one column so the Host Peer ID input and Connect button do not fight for width.
- Add or confirm comfortable `.waitingPanel` padding.

Recommended interaction changes only if testing exposes touch issues:

- Add a `data-x` and `data-y` or equivalent target metadata to cells, or keep a board ref.
- Use `onPointerMove` on the board and calculate the active cell from pointer coordinates during drag.
- Optionally call `setPointerCapture` on pointer down so the board continues receiving move/up events.
- Preserve the existing pointer button behavior for accessibility and mouse users.

## Verification Plan

Minimum checks:

- Run `npm run build:wordsearch-peerjs` from `examples/react-crdt`.
- Run or add focused Playwright coverage for the dedicated page at mobile viewport sizes, especially 320x568 and 390x844.
- Verify host view on mobile:
  - Peer controls are visible and not horizontally overflowing.
  - `Copy invite` and `New game` remain reachable.
  - Board is centered and fully visible without horizontal scrolling.
  - Word bank wraps cleanly.
- Verify client waiting view on mobile:
  - Host Peer ID input and `Connect` button fit.
  - Waiting text does not crowd the card edges.
- Verify touch-like selection:
  - Drag across a known word and confirm it is marked found.
  - Confirm remote/active highlights still align with cells after CSS sizing changes.

Existing test context:

- PeerJS e2e tests currently cover generic Todos PeerJS UI and sync.
- Wordsearch has unit tests for artifact and selection helpers.
- There does not appear to be a dedicated mobile or PeerJS e2e test for `wordsearch-peerjs.html`.
- `tests/smoke/responsive-keyboard.spec.ts` shows the repo already uses `page.setViewportSize({width: 390, height: 844})` for responsive smoke coverage.

## Open Questions

1. What is the minimum supported phone width for this task: 320px, 360px, 390px, or just modern iPhone/Android widths?

- 320px

2. Should the mobile layout optimize for no vertical scrolling above the word bank, or is vertical scrolling acceptable as long as there is no horizontal overflow?

- no vertical scrolling at all please

3. Should the dedicated Wordsearch PeerJS page remain visually consistent with the current shared `style.css`, or is a more app-like mobile treatment acceptable for this one-page game?

- let's not diverge too much

4. Is touch drag selection currently failing on real devices, or is the request primarily about layout? This determines whether we should keep the implementation CSS-only or update the pointer handling.

- yeah drag isn't working

5. Should mobile tests be added specifically for `wordsearch-peerjs.html`, or is manual screenshot verification plus the existing build enough for this task?

- I'd do the manual testing
