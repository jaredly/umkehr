# Plan: Wordsearch PeerJS Mobile Friendly

## Decisions From Research

- Support down to `320px` wide phones.
- Avoid vertical scrolling entirely in the mobile layout.
- Keep the visual style close to the existing shared `style.css`.
- Fix mobile drag selection; this is not layout-only.
- Use manual browser/device-emulation verification rather than adding dedicated automated mobile tests.

## Phase 1: Establish Baseline And Constraints

1. Run the dedicated demo locally with the existing Vite config.

   Use the dedicated entrypoint, not the main app route:

   ```sh
   cd examples/react-crdt
   npm run dev -- --host 127.0.0.1 --port 5174
   ```

   Open:

   ```text
   http://127.0.0.1:5174/wordsearch-peerjs.html
   ```

2. Capture baseline behavior at these viewport sizes:

   - `320x568`
   - `390x844`
   - A desktop width, e.g. `1440x1000`

3. Confirm the existing failure modes:

   - Whether the page has vertical overflow at `320x568`.
   - Whether the board is left-aligned or visually cramped.
   - Whether the PeerJS controls wrap or overflow.
   - Whether touch-style dragging fails to find a word.

## Phase 2: Mobile Layout Without Vertical Scroll

Target files:

- `examples/react-crdt/src/style.css`

Implementation goals:

1. Make the dedicated shell fit the viewport.

   Update `.wordsearchPeerDemo` so mobile uses the real viewport height and compact spacing:

   - Use `min-height: 100dvh` or equivalent fallback.
   - Reduce mobile gutters from the current `calc(100vw - 32px)` behavior.
   - Reduce top/bottom padding and inter-section gap on small screens.
   - Avoid introducing horizontal overflow.

2. Make the PeerJS control strip compact on mobile.

   For the dedicated `.wordsearchPeerControls` area:

   - Keep the existing card-like styling.
   - Stack controls only when needed.
   - Let `.rolePicker` span full width on narrow screens.
   - Let role buttons share width evenly.
   - Let `Copy invite`, `New game`, and client `Connect` fit without overflow.
   - At the narrowest breakpoint, make `.peerConnect` a single column if the input/button pair is too cramped.

3. Size the Wordsearch panel and board from available viewport space.

   The board should not keep a purely width-first layout on phones. It needs to fit below the PeerJS controls and above the word bank.

   Suggested approach:

   - Add mobile CSS custom properties for compact spacing and board size.
   - Set `.wordsearchPanel` to a compact grid with smaller gap/padding.
   - Center `.wordsearchBoard`.
   - Use a viewport-height-aware board size, e.g. a `min()` expression combining width and an available-height estimate.
   - Keep the desktop `440px` cap for larger screens.

4. Compact the Wordsearch header and actions.

   - Reduce mobile heading size.
   - Keep title/progress readable.
   - Avoid a two-row header if it causes vertical overflow at `320x568`.
   - If needed, put Undo/Redo beside the title row with smaller button padding.

5. Compact the word bank.

   The puzzle has eight short words (`REACT`, `CRDT`, `STATE`, `LOCAL`, `MERGE`, `SYNC`, `UNDO`, `JOIN`), so the word bank can fit if chips are smaller.

   - Reduce chip padding and font size on mobile.
   - Reduce row gap.
   - Keep found styling legible.
   - Verify the bank does not push the page taller than the viewport at `320x568`.

6. Tune board visuals for small cells.

   - Reduce board gap below desktop `5px` on mobile.
   - Use responsive cell font size with fixed breakpoint values, not viewport-scaled typography.
   - Reduce cell radius if needed.
   - Reduce highlight border width and remove or lower the `min-height: 30px` constraint on mobile so highlights align with smaller cells.

7. Add comfortable waiting-panel layout.

   - Ensure `.waitingPanel` has padding.
   - Ensure waiting states fit without overflow on a `320x568` client view.

## Phase 3: Fix Touch Drag Selection

Target files:

- `examples/react-crdt/src/apps/wordsearch/WordsearchPanel.tsx`
- Possibly `examples/react-crdt/src/style.css`

Problem:

The current board updates the active cell with `onPointerEnter` on each cell. That is not reliable for touch dragging.

Implementation direction:

1. Keep the existing cell buttons and click/pointer affordance.

   Do not replace the board with canvas or SVG. The existing semantic button grid is useful and should remain.

2. Add board-level pointer tracking.

   - Add a `ref` to `.wordsearchBoard`.
   - On pointer down, start selection and capture the pointer.
   - On pointer move, calculate the cell from `clientX/clientY` relative to the board bounding box.
   - Clamp calculated `x/y` to `0..7`.
   - Update selection when the calculated cell changes.
   - On pointer up, finish selection and release capture.
   - On pointer cancel, clear local selection and release capture.

3. Avoid double updates.

   Once board-level pointer movement is in place, remove or reduce reliance on per-cell `onPointerEnter`.

4. Preserve mouse behavior.

   Desktop drag should still work. A mouse drag across a word should select and mark it found exactly as before.

5. Preserve ephemeral selections.

   The existing selection state drives local and remote highlights. The touch fix should continue using `setSelection`, `finishSelection`, and the existing ephemeral publish effect.

## Phase 4: Manual Verification

Run:

```sh
cd examples/react-crdt
npm run build:wordsearch-peerjs
```

Manual verification matrix:

1. Desktop sanity check at `1440x1000`.

   - Layout still resembles the current demo.
   - Board remains capped and readable.
   - Peer controls still work.

2. Mobile host at `390x844`.

   - No horizontal or vertical page scroll.
   - Peer controls fit.
   - `Copy invite` and `New game` are reachable.
   - Board is centered.
   - Word bank fits.
   - Dragging across a known word marks it found.

3. Mobile host at `320x568`.

   - No horizontal or vertical page scroll.
   - Board, header, controls, and word bank all fit simultaneously.
   - Cell letters remain readable.
   - Highlights align with cells.
   - Dragging across a known word marks it found.

4. Mobile client waiting state at `320x568`.

   - Host Peer ID input and `Connect` button fit.
   - Waiting text and card padding look intentional.
   - No page scroll.

5. Mobile client joined state if convenient.

   - Open a host and client against a local PeerServer or use invite flow.
   - Confirm client receives the snapshot.
   - Confirm a found word propagates between peers.
   - Confirm remote active/found highlights still align.

## Acceptance Criteria

- `wordsearch-peerjs.html` is usable at `320px` wide.
- At `320x568`, the dedicated demo has no page-level horizontal or vertical scrolling in host and client waiting views.
- The 8x8 board is centered and fully visible.
- The word bank is visible without scrolling.
- PeerJS controls remain reachable and do not overflow.
- Touch-style drag selection works on mobile emulation.
- Desktop presentation is not materially changed.
- `npm run build:wordsearch-peerjs` passes.

## Risks And Follow-Ups

- The no-vertical-scroll requirement is tight at `320x568`. If the PeerJS status text or browser UI consumes more space than expected on a real device, the mobile layout may need a more compact status treatment.
- `100dvh` support should be paired with a reasonable fallback because mobile browser viewport behavior varies.
- If coordinate-based pointer movement changes selection feel, verify diagonal selection carefully because word matching allows horizontal, vertical, and diagonal lines only.
