# Research: Blog Visual Demos

## Goal

Create high-fidelity SVG versions of the ASCII diagrams in `src/block-crdt/Blog Post.md`, add them to `examples/block-rich-text`, and show the visual demos instead of the editor when the URL has a `?demos` query parameter.

## Source Diagrams

`src/block-crdt/Blog Post.md` currently has eight fenced `text` diagrams that look like candidates for SVG replacement:

1. Lines 13-54: RGA/Causal-Tree character IDs, parent pointers, and concurrent insert ordering for `the red dog`.
2. Lines 58-78: parent-pointer update as a split/move operation, splitting `the dog` into `B1` and `B2`.
3. Lines 82-130: naive split failure where only `r` is reparented and the sibling `dog` subtree stays behind.
4. Lines 137-181: correct split by moving the split point and following sibling subtrees.
5. Lines 185-226: concurrent split conflict where LWW incidental movement causes `B3` to become empty.
6. Lines 230-270: incidental move metadata and the merged result where an intentional split before `dog` wins.
7. Lines 276-312: rich-text marks anchored to character IDs, including add/remove bold records and resolved spans.
8. Lines 316-343: concurrent block move cycle, raw graph, and deterministic ignored edge during materialization.

There is also an author note at line 132: `I think we actually want a video of 'typing into a text editor and then pressing enter'`. That note sits between the naive split diagram and the correct split diagram, so it may apply specifically to explaining split behavior.

## Current Example App

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/package.json`

The example is a React/Vite app. `App()` currently always renders the two-editor CRDT demo: top bar, history controls, keystroke log, and two `BlockEditor` panels.

The most direct routing point is near the top of `App()` after state/memo setup or before it if we factor the editor app into a child component:

```ts
const showDemos =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demos');
if (showDemos) return <BlogVisualDemos />;
```

Because `App.test.tsx` renders `<App />` directly in jsdom, tests can set `window.history.pushState({}, '', '/?demos')` before rendering and reset the URL in `afterEach`. No router dependency is present or needed.

## Recommended Implementation

Use inline React SVG components rather than generated raster images or external asset files. This keeps the demos inspectable, versionable, easy to style, and compatible with the existing TypeScript/Vite setup without adding an SVG loader.

Proposed new files:

- `examples/block-rich-text/src/BlogVisualDemos.tsx`
- `examples/block-rich-text/src/blogVisuals.tsx` if the SVG component list becomes too large for one file

Proposed app changes:

- Add a top-level `?demos` branch in `App.tsx`.
- Render a full-page `BlogVisualDemos` view instead of the editor shell when the query parameter is present.
- Keep the current editor path untouched for URLs without `?demos`.
- Add CSS classes in `style.css` for the demo gallery and SVG visual language.
- Add focused tests in `App.test.tsx` that assert `?demos` renders the visual demo view and the default URL still renders editor panels.

Suggested demo page shape:

- A constrained full-width page with a header and a scrollable sequence of diagram sections.
- One section per source diagram, each with a concise title matching the blog concept.
- SVGs sized with `viewBox`, `width: 100%`, and stable max widths so they are legible on desktop and still usable on mobile.
- Accessible labels via `<svg role="img" aria-labelledby="...">`, with `<title>` and short `<desc>` nodes.

Suggested SVG visual vocabulary:

- Blocks: light neutral containers with clear `B1`, `B2`, `B3`, or `root` labels.
- Characters: rounded rect nodes with visible text and smaller Lamport labels where relevant.
- Visible parent/next relationships: solid arrows.
- Incidental moves or ignored edges: dashed arrows.
- Intentional split/move edges: stronger accent arrows.
- Deleted/archived/empty states if needed: muted fill and dashed outlines.
- Mark ranges: bracket/ribbon overlays under the character sequence, with add/remove marks in distinct colors.

## Design Notes By Diagram

The first diagram is dense and should probably be a tree/sequence hybrid: show the block root, the main `the dog` chain, the concurrent `red ` branch under `_ 4:A`, and a final rendered text strip. This will communicate both parent pointers and rendered order better than a direct ASCII clone.

The split diagrams should share a consistent node style so users can compare the naive, correct, and concurrent outcomes. Consider using paired "before" and "after" panels inside the same SVG where the blog text currently has multiple stages in one fence.

The incidental metadata diagram can be half code-like callout and half graph. A small structured box for `kind`, `previous`, `splitPath`, and `splitTs` will likely be more readable than trying to draw every object field as graph nodes.

The formatting diagram should prioritize the resolved rendering. Show character IDs in a row, mark records as side callouts, and range overlays under the row. The resolved spans can be a final strip using the same plain/bold/plain segmentation as the text.

The cycle diagram should show both raw edges and materialized output in one SVG. The ignored edge should be visible but clearly styled as ignored; the blog text says the article probably does not need the full tie-break rule.

## Verification

For implementation, run:

- `npm run build --prefix examples/block-rich-text`
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

If visual polish is part of the implementation pass, also start the Vite dev server for `examples/block-rich-text` and capture desktop/mobile screenshots of `/?demos` to check legibility, spacing, and non-overlap.

## Open Questions

1. Should all eight fenced diagrams become SVGs, or should the naive/correct split sequence become an animation or video as hinted by the note at line 132?
    - either SVG or HTML, whichever is most appropriate. in future we might make them animate, but that can wait
2. Should the SVGs replace the ASCII diagrams in `src/block-crdt/Blog Post.md`, or should this task only add a visual demo gallery under `examples/block-rich-text/?demos`?
    - only make a demo gallery for now
3. Should the visuals be static SVG components, or should any of them include lightweight interactivity such as stage toggles for before/after states?
    - lightweight interactivity would be nice
4. What visual tone should the diagrams use: article-polished explanatory figures, or app-like CRDT debugger panels matching the existing editor UI?
    - lean toward polished
5. Are the diagrams intended for export/reuse outside the Vite app? If yes, standalone `.svg` files under a public/assets folder may be better than React-only inline SVG components.
    - no, they are intended for use in the Vite app only
6. For the first diagram, should arrows represent parent pointers only, or should rendered traversal order also be shown explicitly with a separate sequence path?
    - both would be great
7. For the cycle diagram, should the deterministic tie-break rule be omitted as the blog note suggests, or represented in a small callout for completeness?
    - adding a callout is great
