# Plan: Blog Visual Demo Gallery

## Goals

- Add a polished visual demo gallery to `examples/block-rich-text`.
- Show the gallery instead of the editor when the URL contains `?demos`.
- Convert the blog post's ASCII CRDT diagrams into high-fidelity inline SVG/HTML visuals inside the Vite app.
- Include lightweight interactivity where it clarifies before/after or staged concepts.
- Keep the existing editor experience unchanged for normal URLs.

## Decisions From Research

- Build a demo gallery only for now; do not replace diagrams in `src/block-crdt/Blog Post.md`.
- Use inline React SVG/HTML components in the Vite app, not standalone exported `.svg` files.
- Prefer a polished article-figure visual tone over an app/debugger tone.
- Static SVG is acceptable, but use lightweight controls where they improve comprehension.
- For the first diagram, show both parent-pointer relationships and rendered traversal order.
- For the cycle diagram, include a compact deterministic tie-break callout.

## Non-Goals

- Do not add video or full animation in this pass.
- Do not change the CRDT model or editor behavior.
- Do not introduce a router or asset pipeline dependency.
- Do not make the diagrams reusable outside `examples/block-rich-text` unless the implementation naturally allows it.

## Phase 1: App Entry And Gallery Shell

Purpose: introduce the `?demos` path with minimal risk to the existing editor.

Tasks:

- Add `examples/block-rich-text/src/BlogVisualDemos.tsx`.
- Add a top-level `?demos` branch in `App.tsx` using `URLSearchParams(window.location.search).has('demos')`.
- Render a gallery shell with:
  - page header,
  - one section per planned visual,
  - stable `aria-label`/heading text for tests,
  - placeholder figure components while the visual system is built.
- Keep all existing editor state and behavior on the default path.

Exit criteria:

- `/?demos` renders the gallery instead of `.editorPanel` editors.
- Default URLs still render the current two-editor app.

## Phase 2: Shared Figure System

Purpose: build reusable primitives so the diagrams are visually consistent and easier to tune.

Tasks:

- Add shared SVG helpers in `BlogVisualDemos.tsx` or `blogVisuals.tsx` if the file gets too large:
  - arrow marker definitions,
  - character nodes with optional Lamport labels,
  - block/root labels,
  - callout boxes,
  - rendered text strips,
  - stage tabs/buttons for lightweight interactivity.
- Add CSS in `style.css` for:
  - `.demoShell`,
  - `.demoHeader`,
  - `.demoGallery`,
  - `.demoFigure`,
  - SVG typography, colors, and responsive sizing.
- Keep dimensions controlled with `viewBox`, fixed internal coordinates, and responsive outer width.
- Use accessible SVG structure: `role="img"`, `<title>`, and `<desc>`.

Exit criteria:

- Shared visual language is in place before all diagrams are filled in.
- Figures scale down without text overlap in the main expected mobile width.

## Phase 3: Core Sequence And Split Visuals

Purpose: implement the diagrams that explain the base tree model and split semantics.

Tasks:

- Build the RGA/Causal-Tree visual for blog lines 13-54:
  - show block `B`,
  - show parent pointers,
  - show the concurrent `red ` branch under `_ 4:A`,
  - show rendered traversal order as a separate path or final strip.
- Build the parent-pointer update split visual for lines 58-78:
  - show `before`,
  - show `split before d`,
  - show stable character IDs and changed parent edge.
- Build the naive split failure visual for lines 82-130:
  - show intended result versus naive result,
  - emphasize that sibling subtree `dog` stayed behind.
- Build the correct split visual for lines 137-181:
  - show split point and following sibling subtrees moving,
  - use a staged control if it makes the before/after comparison clearer.

Exit criteria:

- The first four visuals are complete and legible.
- The split visuals use matching node/edge conventions so comparisons are easy.

## Phase 4: Conflict, Formatting, And Cycle Visuals

Purpose: implement the remaining advanced diagrams with compact explanatory callouts.

Tasks:

- Build the concurrent split conflict visual for lines 185-226:
  - show Replica A's intentional/incidental moves,
  - show Replica B's intentional split before `dog`,
  - show the LWW failure where `B3` becomes empty.
- Build the incidental metadata merge visual for lines 230-270:
  - show the metadata shape in a readable callout,
  - show intentional split before `dog` winning over incidental movement,
  - show the merged `B1`, `B2`, and `B3` result.
- Build the formatting mark visual for lines 276-312:
  - show characters with IDs,
  - show add/remove bold mark records,
  - show range overlays,
  - show resolved spans.
- Build the block cycle visual for lines 316-343:
  - show raw `A.parent = B` and `B.parent = A`,
  - show materialized `root -> A -> B`,
  - show ignored edge styling,
  - include a compact deterministic tie-break callout.

Exit criteria:

- All eight source diagrams have polished gallery equivalents.
- Interactive controls, if present, are keyboard-accessible buttons/tabs and do not hide essential content by default.

## Phase 5: Tests

Purpose: lock the route behavior and avoid regressions in the existing editor path.

Tasks:

- Add or update `examples/block-rich-text/src/App.test.tsx` coverage for:
  - default render still shows the two editor panels,
  - `/?demos` shows the visual demo gallery,
  - `/?demos` does not render the editor panels/history controls,
  - stage controls update the active visual state if lightweight interactivity is added.
- Reset `window.history` in test cleanup so query parameters do not leak between tests.

Exit criteria:

- Tests prove `?demos` is isolated from the normal editor UI.
- Existing editor tests still run without query-state leakage.

## Phase 6: Build And Visual QA

Purpose: verify type safety, test coverage, and figure polish.

Tasks:

- Run `npm run build --prefix examples/block-rich-text`.
- Run `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`.
- Start the Vite dev server for `examples/block-rich-text`.
- Inspect `/?demos` at desktop and mobile widths.
- Capture screenshots if useful for review.
- Fix spacing, text fit, contrast, and any overlapping nodes or labels.

Exit criteria:

- Build and relevant tests pass.
- `/?demos` is readable on desktop and mobile.
- Normal editor URL remains visually and behaviorally unchanged.

## Expected Files To Touch

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/BlogVisualDemos.tsx`
- `examples/block-rich-text/src/blogVisuals.tsx` if needed for organization
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

## Verification Commands

```sh
npm run build --prefix examples/block-rich-text
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```
