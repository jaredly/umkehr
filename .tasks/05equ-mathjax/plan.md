# Plan: Inline Math Rendering

## Decisions From Research

- Use real inline marks, not derived delimiter ranges.
- Add one mark type, `math`.
- Store display mode in the mark metadata instead of using a separate mark type.
  - Inline math can use `true` or `{display: false}`.
  - Display math should use `{display: true}`.
- `$...$` and `$$...$$` are markdown shortcuts only. When converted, the delimiters are deleted/tombstoned and the inner source text remains.
- Users should also be able to apply math marks directly to selected non-delimited text.
- Use MathJax as the renderer.
- Source mode is per equation.
- Clicking rendered math can initially enter source mode for the whole equation. Fine-grained click-to-source-offset mapping can come later.
- Invalid or malformed LaTeX should render as literal source text.
- If a marked equation is split across blocks, render each visible block segment separately, matching current mark behavior.
- Tests should render math too, but through a deterministic adapter where possible.

## Phase 1: Math Mark Model

Add math mark definitions and helpers beside the existing inline mark utilities.

Files likely involved:

- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/inlineRunRendering.tsx`
- `examples/block-rich-text/src/blockEditorTypes.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/EditorApp.tsx`

Work:

- Add constants:
  - `MATH_MARK = 'math'`
- Add a `MathMarkData` / `MathRenderMode` type.
  - Accept `true` as inline math for simple boolean mark compatibility.
  - Accept `{display: true}` as display math.
  - Optionally normalize `{display: false}` to inline math.
- Decide whether `math` should be included in `BareInlineMark`.
  - Inline math can probably share boolean mark semantics if `true` means inline.
  - Display math needs command handling that writes `{display: true}`.
- Add helpers:
  - `isMathMarkValue(value): value is true | {display?: boolean}`
  - `mathDisplayModeFromMarkValue(value): 'inline' | 'display' | null`
  - `isMathRun(run)`
  - `mathModeForRun(run): 'inline' | 'display' | null`
  - `mathRangeAroundOffsetInRuns(...)`, similar to `codeRangeAroundOffsetInRuns`.
- Update active mark derivation only if toolbar state needs to show math as active.

Acceptance:

- Math marks materialize through existing `materializeFormattedBlocks` without CRDT core changes.
- Helpers can identify contiguous math-marked ranges in formatted runs.

## Phase 2: Commands and Markdown Shortcuts

Add commands to apply/remove math marks and convert delimiter shortcuts.

Files likely involved:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/markdownShortcuts.ts`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/multiSelectionCommands.ts` if command wrappers need updates

Work:

- Add command functions:
  - `toggleMathMark(state, selection, context)` for inline math.
  - `toggleDisplayMathMark(state, selection, context)` for display math.
  - `setMathMark(state, selection, mode, context)`
  - `removeMathMark(state, selection, context)`
- Ensure applying inline math over display math, or display math over inline math, writes a newer `math` mark with the desired metadata.
- Implement markdown shortcut conversion:
  - When typing the closing `$`, detect the nearest preceding unescaped `$` in the same block.
  - For `$source$`, delete both delimiters and apply `math` with inline metadata to `source`.
  - For `$$source$$`, delete both delimiter pairs and apply `math` with display metadata to `source`.
  - Do not convert empty source.
  - Do not convert escaped delimiters.
- Extend paste shortcut handling if practical:
  - If pasted text contains complete `$...$` or `$$...$$` inside a touched line, convert delimiters and apply marks.
  - This can be a follow-up if it makes the first slice too broad.
- Preserve selection after delimiter deletion:
  - After `$abc$` converts, caret should end after `abc`.
  - After `$$abc$$` converts, caret should end after `abc`.
- Add editor commands/UI entry points:
  - Keyboard shortcuts are optional.
  - Toolbar buttons or slash commands are useful but not required for the first internal slice.
  - Direct command access is required so selected non-delimited text can be marked.

Acceptance:

- Typing `$x$` produces visible text `x` with an inline `math` mark over `x`.
- Typing `$$x$$` produces visible text `x` with a display `math` mark over `x`.
- Selecting `x` and applying inline math works without delimiters.
- Selecting `x` and applying display math works without delimiters.
- Concurrent edits to marked source remain normal text ops.

## Phase 3: MathJax Adapter

Add a small rendering adapter so MathJax is isolated from editor rendering and tests can stay deterministic.

Files likely involved:

- `examples/block-rich-text/package.json`
- new `examples/block-rich-text/src/mathRendering.ts`
- tests under `examples/block-rich-text/src/*math*.test.ts`

Work:

- Add MathJax dependency.
- Create an adapter API, for example:

```ts
export type MathRenderMode = 'inline' | 'display';

export type MathRenderResult =
    | {type: 'html'; html: string}
    | {type: 'literal'; text: string};

export type MathRenderer = {
    render(source: string, mode: MathRenderMode): MathRenderResult;
};
```

- Use MathJax's browser rendering API in production.
- Catch MathJax errors and return `{type: 'literal', text: source}`.
- Provide a deterministic test renderer that returns simple HTML/text for valid inputs and literal text for invalid inputs.
- Keep rendering synchronous from the editor's perspective if possible. If MathJax forces async rendering, cache rendered results by `{source, mode}` and re-render after resolution.

Acceptance:

- Editor rendering code does not import MathJax directly.
- Tests can render math without depending on MathJax timing or full generated markup.
- Invalid LaTeX falls back to literal text.

## Phase 4: Rendered Math and Source Mode

Update editable block rendering so math-marked ranges can switch between rendered preview and editable source.

Files likely involved:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/inlineRunRendering.tsx`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/style.css`

Work:

- Track active source-mode equation in `BlockEditor` state.
  - Use per-equation identity from the mark/range. Candidate identity: `${blockId}:${startOffset}:${endOffset}:${mode}` for first slice.
  - A more stable follow-up could use mark ids or boundary char ids.
- Compute math ranges from formatted runs.
  - Each contiguous run sequence with `math` and inline metadata is an inline math range.
  - Each contiguous run sequence with `math` and display metadata is a display math range.
- During run rendering:
  - If a math range is active source mode, render literal source text with a source-mode class.
  - If the current selection intersects the range, render literal source text.
  - Otherwise render a `contentEditable=false` preview element.
- Preview element dataset:
  - `data-inline-math="true"` or `data-display-math="true"`
  - `data-block-id`
  - `data-start-offset`
  - `data-end-offset`
  - `data-math-mode`
- Click behavior:
  - Clicking rendered math enters source mode for that equation.
  - Place the caret inside the source range, initially at the range start or end.
  - Fine-grained offset mapping from click coordinates is deferred.
- Exit behavior:
  - Leave source mode when selection moves outside that equation.
  - Leave source mode on blur.
- Styling:
  - Inline math should sit naturally within text.
  - Display math should have block-like spacing but still live inside the editor block.
  - Source mode should look editable and not like a disabled preview.
  - Literal fallback should be readable and visibly distinct enough to show it did not render.

Acceptance:

- A math-marked range renders as MathJax when inactive.
- Clicking it enters editable source mode.
- While source mode is active, normal text editing commands modify CRDT text.
- Moving selection away returns to rendered mode.
- Display-mode `math` uses display-style MathJax and suitable layout.

## Phase 5: Selection and DOM Mapping

Make rendered math cooperate with the existing offset-based DOM selection bridge.

Files likely involved:

- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/EditorApp.tsx`

Work:

- Mirror the inline embed selection strategy for math preview elements.
- Add helpers similar to the inline embed helpers:
  - `isInlineMathPreview`
  - `closestInlineMathPreview`
  - boundary mapping around a preview element
- When reading DOM selection:
  - If selection lands on/inside a preview, map to before or after the source range.
  - For initial click-to-source-mode, prefer placing caret inside the source range after rerendering literal source.
- When restoring DOM selection:
  - If source mode is inactive and the target offset is inside a rendered math range, clamp to a boundary or activate source mode before restore.
- Ensure retained selection highlights/carets still render around math ranges.

Acceptance:

- Clicking before/after rendered math produces stable editor selections.
- Clicking rendered math reliably enters source mode rather than corrupting DOM selection.
- Keyboard navigation around rendered math does not trap focus.

## Phase 6: Clipboard, Import, and Export

Preserve math source and marks in non-live data flows.

Files likely involved:

- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`

Work:

- Plain text clipboard:
  - Copy math source text without delimiters for marked ranges, unless product preference changes.
  - Consider re-adding `$...$` / `$$...$$` in plain text output for portability.
- Rich clipboard:
  - Preserve math marks in the internal payload.
  - HTML output may include rendered MathJax plus source fallback.
- Document format:
  - Add document mark types:
    - `{type: 'math', start, end, display?: boolean}`
  - Import should apply those marks to source text.
  - Export should preserve them.
- Paste:
  - Preserve math marks from rich payload.
  - Optionally convert markdown delimiters in plain text paste.

Acceptance:

- Internal copy/paste preserves math marks.
- Export/import round-trips math marks and source text.
- Plain text copy has a deliberate, tested behavior.

## Phase 7: Collaboration, Split/Join, Undo, and Retained Marks

Verify the behavior that matters most for the CRDT.

Files likely involved:

- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/inlineMarks.test.ts`
- `examples/block-rich-text/src/retainedSelection.test.ts`
- `examples/block-rich-text/src/history.test.ts`
- `src/block-crdt/formatting.test.ts` only if a core mark issue appears

Work:

- Concurrent source edits:
  - Start with a marked equation `abc`.
  - Replica A inserts `X`; replica B inserts `Y`; sync; assert merged source has both.
- Concurrent delimiter shortcut conversion:
  - If two users type around the same math source, ensure delimiter tombstones and marks converge acceptably.
- Split inside math:
  - Mark `abcdef`, split at `abc|def`.
  - Assert both visible block segments carry math rendering/mark behavior separately.
- Join after split:
  - Join the blocks and assert the equation source and mark behavior remain coherent.
- Undo/redo:
  - Undo delimiter shortcut conversion should restore a sensible previous state.
  - Undo source edits inside source mode should only undo the text edit.
- Retained selection:
  - A retained selection inside math source should stay anchored after remote edits.
- Pending/retained inline marks:
  - If math is included in pending mark behavior, verify typing with pending math creates an open-ended math session and closing it produces a valid mark.
  - If not included, document that math requires a selected range or delimiter shortcut.

Acceptance:

- No CRDT core changes are needed unless tests expose a mark traversal bug.
- Concurrent edits inside equations merge through existing character ops.
- Split/join behavior is tested and matches the chosen "render separately" rule.

## Phase 8: UI Polish and Documentation

Make the feature discoverable enough for the example.

Files likely involved:

- `examples/block-rich-text/src/Toolbar.tsx`
- `examples/block-rich-text/src/slashCommands.tsx`
- `examples/block-rich-text/src/style.css`
- example fixture/documentation files if any are used by demos

Work:

- Add toolbar controls for inline math and display math.
- Add slash commands if they fit the current command menu:
  - Inline math
  - Display math
- Add a small fixture/demo document containing inline and display math.
- Keep visual design restrained:
  - Inline math should not disrupt line height too much.
  - Display math should be readable without becoming a separate block type.
  - Error/literal fallback should be clear without looking alarming.

Acceptance:

- Users can create math via delimiter shortcuts and via direct commands.
- The example visibly demonstrates both inline and display math.

## Suggested Implementation Order

1. Add mark constants/helpers and command functions.
2. Implement `$...$` and `$$...$$` shortcut conversion.
3. Add tests for command behavior before touching MathJax.
4. Add the MathJax adapter and test renderer.
5. Render inactive marked ranges as previews.
6. Add source-mode click/edit behavior.
7. Harden DOM selection mapping.
8. Add clipboard/import/export support.
9. Add collaboration, split/join, undo, and retained selection tests.
10. Add toolbar/slash command polish.

## Risks

- MathJax async rendering may not fit the current render path cleanly. Keep it behind an adapter and cache results.
- DOM selection around `contentEditable=false` previews is the most likely source of browser-specific behavior.
- Display math inside an inline text block may require careful layout so it does not break selection or line box assumptions.
- Display/inline mode updates need a consistent last-writer-wins policy for the `math` mark metadata.
- Undo for delimiter shortcut conversion may need special attention because the shortcut deletes delimiter characters and adds a mark in one command.

## Non-Goals for First Slice

- Fine-grained click coordinate mapping into MathJax source offsets.
- MathQuill or structured equation editing.
- A nested CRDT for equations.
- Rendering one equation as a single visual object across multiple visible blocks.
- Full Markdown import/export beyond the editor's existing document format and clipboard paths.
