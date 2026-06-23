# Phase 9 Plan: Syntax Highlighting And Polish

Goal: make the block-rich-text example feel complete after the structural block-type work is in place. This phase should improve visual quality, add syntax highlighting, compact the controls, and harden keyboard/selection behavior without changing the core CRDT data model.

## Current Baseline

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/package.json`
- root `package.json`

The example already has:

- typed `RichBlockMeta`
- block type menu and inline controls for code language/callout kind
- todo toggles, callouts, blockquotes, tables, annotations, footnotes, popovers
- retained selection decorations
- DOM selection restore for active editable surfaces
- table rows/cells rendered from virtual row parents
- table row/column creation and row drag controls
- keyboard branches for code blocks, table cells, multi-selections, and retained caret movement

Phase 9 should mostly refine these surfaces instead of introducing new CRDT primitives.

## Principles

- Keep syntax highlighting render-only. It must not mutate CRDT text, marks, block metadata, history, undo, or retained selection anchors.
- Rich-text marks and annotation affordances remain the source of truth for user-authored inline styling.
- Highlight token spans are lower priority than user marks. A highlighted token can add color/classes, but must not erase bold, italic, strikethrough, link, annotation, popover, footnote, retained-selection, or caret sentinel behavior.
- Preserve `data-block-id` on every text-editable surface.
- Keep controls compact but explicit. Controls should emit the same command paths already used by menu/select inputs.
- Do not make Phase 9 a broad refactor. Extract helpers only where they make highlighting/control/render tests practical.

## Workstream 1: Syntax Highlighting Dependency Decision

Decision criteria:

- Prefer a small, browser-friendly dependency that can synchronously highlight a string.
- Avoid async WASM/on-demand grammar loading for this example unless there is a strong reason.
- The dependency must work in Vitest/jsdom without browser-only globals.
- It should support at least JavaScript/TypeScript, JSON, HTML, CSS, Markdown, and plain text.
- Unknown language names should fall back to plain rendering without throwing.

Likely options:

- `highlight.js`: pragmatic default; broad language support, synchronous API, simple CSS class model.
- `prismjs`: also acceptable, but language loading can be more manual.
- `shiki`: probably too heavy for this phase because highlighting is async and theme-driven.

Recommended first implementation:

- Add `highlight.js` to `examples/block-rich-text` dependencies.
- Import the core library plus a limited language set if bundle size becomes noisy.
- Add a tiny example-local wrapper, probably `examples/block-rich-text/src/syntaxHighlight.ts`.

Proposed wrapper API:

```ts
export type SyntaxToken = {
    text: string;
    className: string | null;
};

export const highlightCode = (text: string, language: string): SyntaxToken[];
```

Wrapper requirements:

- Return a single plain token for empty text, unknown language, unsupported language, or highlight failure.
- Normalize common aliases: `ts` -> `typescript`, `js` -> `javascript`, `jsx`, `tsx`, `json`, `md` -> `markdown`, `html`, `css`, `plain`, `text`.
- Never return HTML strings to React/DOM. Convert highlighted output into token data or use a safe emitter API if the chosen library provides one.
- Unit test the wrapper independently so rendering tests do not depend on exact full DOM output.

## Workstream 2: Merge Syntax Tokens With CRDT Runs

Current renderer shape:

- `RichTextEditableSurface` calls `serializeRuns(...)`.
- It then replaces children with `renderRunNodes(...)`.
- `renderRunNodes(...)` uses `runRenderChunks(...)`.
- `runRenderChunks(...)` currently splits formatted runs only by retained-selection boundaries and caret offsets.
- `applyRunClasses(...)` applies user marks, links, annotations, and popover metadata.

Needed change:

- Extend the render chunk pipeline so code blocks can add syntax token boundaries without breaking existing run/selection boundaries.
- The merged chunks should represent the intersection of:
  - CRDT formatted run boundaries
  - retained-selection segment boundaries
  - retained caret offsets
  - syntax token boundaries
  - footnote reference end positions

Suggested implementation:

1. Pass optional syntax tokens into `RichTextEditableSurface`.
2. Compute token ranges for code blocks from the visible block text and current `meta.language`.
3. Include token boundaries in `runRenderChunks(...)`.
4. Add `syntaxClassName?: string` to `RunRenderChunk`.
5. Add classes such as `syntaxKeyword`, `syntaxString`, or the library class mapped through a stable local prefix.
6. Update `serializeRuns(...)` to include code language and token output, otherwise React will skip DOM updates when only the language changes.

Important details:

- Offsets must use the same unit as existing selection offsets. Existing code uses `segmentText(...)`, so token text must be converted through the same segmentation path.
- If the highlighter splits a grapheme cluster in a way that cannot map cleanly, fall back to plain rendering for that block.
- Trailing code newline sentinel must remain outside the highlighted token stream.
- Footnote references and popover triggers still render from annotation marks, even inside code blocks.
- Retained selection spans and carets must keep their `data-retained-selection` and `contentEditable=false` behavior.

Tests:

- A code block with `language="javascript"` renders syntax token classes.
- Changing code language emits a metadata op and rerenders token classes.
- Bold/italic/link/annotation classes still appear on highlighted code text.
- Retained selection highlight still wraps the correct code text after tokenization.
- A trailing newline code block still restores caret after the newline sentinel.
- Unknown language renders plain code without throwing.

## Workstream 3: Compact Controls

Current controls are functional but broad: toolbar text buttons, one large block type select, inline text input for code language, inline select for callout kind, table buttons, and annotation buttons.

Target:

- Keep all existing actions discoverable.
- Reduce toolbar width pressure in the two-replica layout.
- Avoid controls that steal or lose the editor selection.
- Preserve existing command paths and tests.

Suggested UI grouping:

- History: Undo, Redo.
- Inline marks: Bold, Italic, Strikethrough, Link.
- Annotation: Comment, Footnote, Popover grouped behind a compact select or segmented mini-control.
- Block type: keep one select, but normalize labels and selection state.
- Contextual metadata:
  - heading level only when current block is heading
  - list kind only when list item
  - todo checkbox only on todo row
  - callout kind only when callout
  - code language only when code
- Table controls:
  - table-level compact row: add row, add column, move table
  - row-level compact controls: move row, move up/down if those are still supported as buttons

Implementation notes:

- Replace text-heavy toolbar labels with short labels or icon-like text where no icon dependency exists. Keep `aria-label` explicit.
- Use `onMouseDown`/`onPointerDown` selection-preservation consistently for every control.
- Add stable `aria-label`s so tests can target controls without brittle text queries.
- Keep existing `BlockInlineControls` but consider splitting into `CodeLanguageControl` and `CalloutKindControl` if tests become easier.
- Do not introduce a new design system dependency for this phase.

Tests:

- Toolbar controls still emit metadata ops for paragraph, heading, list, todo, blockquote, code, and callout.
- Code language control preserves focus/selection and emits a code metadata update.
- Callout kind control preserves focus/selection and emits a callout metadata update.
- Annotation presentation control creates sidebar, footnote, and popover annotations.
- Table add-row/add-column controls still work after compacting labels.

## Workstream 4: Responsive Layout Polish

Target breakpoints:

- Wide desktop: two replicas side by side.
- Narrow desktop/tablet: two replicas still usable, with controls wrapping cleanly.
- Mobile-width screenshot/test viewport: replicas stack vertically, tables scroll horizontally, annotation UI does not cover the editable block.

CSS work:

- Add a breakpoint around `900px` to stack `.editorGrid`.
- Ensure `.toolbar`, `.historyControls`, `.tableToolbar`, `.tableRowControls`, `.annotationSidebar`, `.footnotes`, and popovers have sane wrapping and max-width behavior.
- Keep tables horizontally scrollable without forcing the whole editor panel wider.
- Ensure block rows in table cells do not overflow the cell at narrow widths.
- Keep code blocks readable with horizontal/vertical behavior that does not break selection offsets. Prefer `white-space: pre-wrap` and `overflow-wrap: anywhere` unless code editing needs horizontal scroll.
- Make grouped blockquote/callout containers visually continuous on narrow screens.
- Keep retained carets and highlights visible against code/callout/blockquote/table backgrounds.

Visual QA checklist:

- Paragraph, heading, list, todo, blockquote, callout, code, table, sidebar comment, footnote, and popover all appear in one document.
- Long code line does not break the editor panel.
- A table with at least 4 columns scrolls within the table area.
- Sidebar comments do not collapse the editor text below a readable width.
- Popovers stay within the panel where practical.
- Retained selection highlights are visible in inactive editor panels.

Tests:

- DOM tests for responsive-critical class structure are enough in Vitest.
- If a browser test harness is already available later, add one screenshot pass for desktop and one for mobile. Do not block this phase on adding a new e2e framework.

## Workstream 5: Keyboard Consistency Pass

Current keyboard handling lives mostly in `EditableBlock` and delegates to `blockCommands.ts`.

Audit and normalize:

- `Enter`
  - ordinary block: split
  - empty non-paragraph: convert to paragraph, as implemented earlier
  - code block: insert newline for normal Enter; if current behavior uses Shift+Enter for code newline, decide whether Phase 9 changes it to match the Phase 2 policy and update tests
  - table cell: Enter behavior should be intentional; if it advances to next cell, document that in tests
- `Tab`
  - code block: insert spaces
  - table cell: move between cells; final cell creates a row
  - ordinary block: indent/unindent
- `Backspace/Delete`
  - preserve existing same-row cell join policy
  - do not accidentally target `table_row`
  - code block deletion should not remove sentinel nodes or annotation sentinels
- Arrow keys
  - normal caret movement skips structural rows
  - retained multi-selection movement continues to use editable traversal
  - vertical movement should work across grouped subtree/table contexts when DOM geometry is available
- Clipboard
  - paste plain text in code should preserve newlines inside code blocks if that is the intended policy
  - paste into ordinary blocks should keep existing split behavior

Tests:

- One focused interaction test per keyboard branch that changed or was clarified.
- Regression test for code `Enter` behavior matching the final policy.
- Regression test for `Tab` precedence in a code block inside a table cell. Code behavior should win if the cell block is code; table-cell navigation should win otherwise.
- Regression test that arrow movement skips `table_row` and lands in editable cells/ordinary blocks.
- Regression test that selection restore still works after a code language change and after table-cell tab navigation.

## Workstream 6: Rendering Test Coverage

Add tests in `examples/block-rich-text/src/App.test.tsx` for UI-level rendering and controls.

Suggested test fixtures:

1. Build a mixed document through the actual UI:
   - type text
   - set block types
   - create annotation
   - create table
   - set code language
2. Assert DOM roles/classes/data attributes:
   - `.headingLevel1`
   - `.codeBlock`
   - syntax token class
   - `.calloutGroup` and kind class
   - `.blockquoteGroup`
   - `[role="table"]`
   - `.footnoteReferenceNumber`
   - `.markPopover`
   - retained-selection data attributes

Add tests in lower-level files where UI setup would be too expensive:

- `syntaxHighlight.test.ts` for language aliasing/fallback/token stability.
- `blockCommands.test.ts` only if keyboard policy changes require command changes.
- `retainedSelection.test.ts` only if highlighting boundary logic requires retained-selection helper changes.

Testing cautions:

- Avoid asserting exact color values.
- Avoid snapshots of the whole editor. They will be too brittle.
- Prefer semantic class/data assertions and visible text.
- Use existing helper patterns in `App.test.tsx`, including `blockText`, `selectCaret`, `selectRange`, and role queries.

## Workstream 7: Implementation Sequence

1. Add the syntax highlighting wrapper and tests.
2. Thread optional syntax token data through the code-block render path.
3. Merge syntax boundaries with run/selection chunks.
4. Add code syntax CSS classes and verify unknown-language fallback.
5. Compact controls while preserving existing command handlers.
6. Add responsive CSS pass for editor grid, tables, annotations, callouts, blockquotes, and code.
7. Audit keyboard precedence and update code/tests for any deliberate policy changes.
8. Add DOM regression tests for mixed rich block rendering and controls.
9. Run focused tests and typecheck.
10. Manually inspect the example in a browser at desktop and mobile widths.

## Acceptance Criteria

- Code blocks highlight supported languages without changing CRDT contents.
- Highlighting coexists with bold, italic, strikethrough, links, annotations, popovers, footnotes, retained highlights, and retained carets.
- Changing code language syncs between replicas as a metadata operation and rerenders highlighting.
- Compact controls cover every Phase 9 action and preserve active editor selection.
- Tables, callouts, blockquotes, comments, footnotes, popovers, and code remain usable in the two-replica layout.
- Mobile/narrow layout stacks replicas and avoids incoherent overlap.
- Keyboard behavior is consistent and covered by tests for ordinary blocks, code blocks, and table cells.
- Existing Phase 1-8 tests continue to pass.

## Verification Commands

Run during development:

```sh
npm exec vitest -- run examples/block-rich-text/src/syntaxHighlight.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/retainedSelection.test.ts
npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit
```

Run before closing Phase 9:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src
npm run typecheck
npm run build
npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit
```

Manual verification:

- Start the example with `npm run dev` from `examples/block-rich-text`.
- Create a mixed document in Editor A containing code, callout, blockquote, table, comment, footnote, and popover.
- Confirm Editor B receives metadata, annotations, table operations, and highlighted code.
- Focus Editor A and confirm Editor B still shows retained selections in styled/table/code contexts.
- Resize to a narrow viewport and confirm controls wrap, replicas stack, tables scroll, and popovers/annotations remain usable.

## Open Decisions

- Whether code `Enter` should become normal Enter inserts newline, or remain Shift+Enter inserts newline with normal Enter advancing/splitting in some contexts. The original plan says normal Enter in code inserts newline, so prefer aligning to that unless current users rely on the existing behavior.
    - yeah align to that
- Whether code blocks should use horizontal scrolling for long lines or wrap lines. Current editor behavior favors wrapping; keep wrapping unless selection/reading quality is clearly worse.
    - wrap
- Whether table row movement stays as both drag-only and button controls, or compact buttons remain for accessibility.
    - drag only. we can develop custom keyboard shortcuts for movement later
- Whether annotation controls should remain three buttons or become one compact presentation selector plus create button.
    - compact selector is better
