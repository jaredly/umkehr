# Research: Inline Code Mark With Optional Language

## Goal

Add inline `code` support to `examples/block-rich-text`. Users should be able to mark inline text as code, hover the inline code, set a `language`, and see syntax highlighting for that inline code mark. Code marks should be non-stacking.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/syntaxHighlight.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/inlineMarks.test.ts`
- `examples/block-rich-text/src/syntaxHighlight.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `src/block-crdt/marks.ts`
- `src/block-crdt/blocks.ts`

The example already has boolean inline marks:

```ts
export type BooleanInlineMark = 'bold' | 'italic' | 'strikethrough';
export type InlineMark = BooleanInlineMark | 'link';
```

`bold`, `italic`, and `strikethrough` are toggled through `toggleMark` / `toggleMarkEverywhere`. `link` is a valued mark handled by `setLinkMark` / `removeLinkMark` and a link popover.

Formatted runs expose mark values as:

```ts
type FormattedRun = {
    text: string;
    marks: Record<string, JsonValue | true>;
    stackedMarks?: Record<string, Array<JsonValue | true>>;
};
```

The block CRDT mark resolver is non-stacking by default. A mark type only stacks if `VirtualBlockParentConfig.markBehavior[type] === 'stacking'`. Current annotation marks opt into stacking through `annotationMarkBehavior`; normal valued marks like `link` are last-writer-wins by Lamport id.

This means inline `code` should not be added to `markBehavior` as stacking. If left at default behavior, overlapping `code` marks resolve as one winning value per character.

The example already has syntax highlighting for code blocks:

- `syntaxHighlight.ts` registers `css`, `javascript`, `json`, `markdown`, `typescript`, and `xml`.
- `normalizeCodeLanguage` maps aliases such as `js`, `ts`, `tsx`, `html`, `md`, and `plain`.
- `highlightCode(text, language)` returns `SyntaxToken[]` with `syntax-*` classes.
- `App.tsx` currently passes whole-code-block tokens to `renderRunNodes`.
- `style.css` already defines `.syntax-keyword`, `.syntax-string`, `.syntax-comment`, etc.

The editable renderer already splits runs by formatting boundaries, retained selection boundaries, and optional syntax token boundaries:

```ts
renderRunNodes(...)
runRenderChunks(...)
applyRunClasses(...)
```

The hover/edit pattern for links is a good local precedent:

- run spans receive `data-link-href`, `data-link-start-offset`, and `data-link-end-offset`
- `EditableBlock` handles `onMouseOver` and `onMouseOut`
- hover state opens `LinkHoverPopover`
- clicking `Edit` opens `LinkFloatingPopover`
- applying/removing the popover writes a valued mark over the discovered range

## Recommended Data Model

Use one inline mark type:

```ts
export const CODE_MARK = 'code';
```

Represent code mark data as either:

- `true` or empty string/no data for inline code with no language
- normalized language string for inline code with syntax highlighting

The simplest implementation is to store the language string as the mark data, like `link` stores `href`. A remove op clears the mark. An empty language can either be stored as `true` by using a boolean mark command, or as `''` by using a valued command. I recommend avoiding `''` as a persistent value and using:

- `data: undefined, remove: false` for code with no language, materialized as `true`
- `data: normalizedLanguage, remove: false` for language-specific code
- `remove: true` to remove code

This makes render checks straightforward:

```ts
run.marks[CODE_MARK] === true || typeof run.marks[CODE_MARK] === 'string'
```

Open question below: whether the UI should normalize before writing or preserve user-entered aliases.

## Recommended Implementation Plan

1. Extend inline mark helpers.
   - Add `CODE_MARK`.
   - Add a `CodeMarkData` helper if desired: `true | string`.
   - Add range helpers parallel to links, for example `codeRangeAroundOffsetInRuns`, `codeLanguageForSelectionSegments`, and `isCodeMarkValue`.
   - Keep `BooleanInlineMark` as-is unless the toolbar toggle should treat bare code exactly like bold/italic. Because code can later carry a value, it probably deserves its own command path rather than being folded into `BooleanInlineMark`.

2. Add code mark commands.
   - Add `setCodeMark(state, selection, language, context)` and `removeCodeMark(...)` in `blockCommands.ts`.
   - Reuse or generalize `setValuedMark`; it already writes string values and remove marks over normalized selection segments.
   - For bare code, either add a small `setBareCodeMark` command that writes `markRangeOp(..., CODE_MARK, undefined, false, ...)`, or generalize `setValuedMark` to allow `value?: string`.
   - Add `setCodeMarkEverywhere` / `removeCodeMarkEverywhere` in `multiSelectionCommands.ts`, likely by generalizing `runLinkMarkCommand` to `runValuedMarkCommand`.

3. Add toolbar support.
   - Add a toolbar button for code, probably labelled with a code glyph or `Code`.
   - Applying code to a non-collapsed selection should create a bare code mark.
   - Toggling code off should remove the code mark for selected ranges.
   - Collapsed behavior should be decided. Existing boolean marks support pending retained typing sessions; valued code with language is more complex. A conservative first pass can make the code toolbar act only on non-collapsed selections, matching link's range requirement.

4. Add inline code rendering.
   - In `applyRunClasses`, add `.markCode` and data attributes:
     - `data-code-language` when the resolved value is a string
     - `data-code-start-offset`
     - `data-code-end-offset`
   - In `renderStaticRuns`, include `.markCode`.
   - Add styles for `.markCode` similar to inline code: monospace font, subtle background, border, padding, and radius.
   - Make sure `.markCode.markLink` and `.markCode.markStrikethrough` remain readable.

5. Add inline syntax highlighting.
   - Current syntax token support assumes one syntax token stream for the whole block, used by code blocks.
   - Inline code needs token streams scoped to each contiguous code mark range. Do not highlight the whole paragraph as one language.
   - A practical approach is to compute code syntax ranges before `runRenderChunks`:
     - identify contiguous ranges where `CODE_MARK` has the same string language
     - concatenate only that range's text
     - call `highlightCode(text, language)`
     - convert returned token offsets back to block offsets
   - Merge those ranges with the existing whole-block code-block syntax ranges. Inline code ranges should be local and should not affect non-code text.
   - If the code mark value is `true` or an unsupported/plain language, render `.markCode` without syntax token classes.

6. Add code hover and language popover.
   - Mirror the link hover flow:
     - `CodePopoverState` with `ranges`, `language`, `top`, `left`
     - `CodeHoverPopover` with current language and an Edit button, or possibly direct language input
     - `CodeFloatingPopover` with language input/select, Apply, Clear language, and Remove code
   - Add `codeTriggerFromEvent` and `codeRangeFromTrigger`, parallel to link helpers.
   - Use the same delayed-hide behavior as links so users can move from the mark to the hover popover.
   - Reuse `linkPopoverPositionFromElement` / `linkPopoverPositionFromSelection` or rename to generic popover positioning helpers.

7. Update annotation/comment body rendering if needed.
   - `AnnotationBodyEditor` has its own link hover/popover state and uses `renderStaticRuns` for some annotation display paths.
   - It likely needs code mark rendering at minimum.
   - If code marks should be editable inside annotation bodies too, the body command layer needs `setAnnotationBodyCodeMark` equivalents. If not, ensure code rendering still works for replicated marks in annotation content.

## Important Edge Cases

- Non-stacking behavior: overlapping same-type `code` marks resolve by highest Lamport id. Tests should verify that applying a second language over part of an existing code range splits the rendered runs and does not expose both languages in `stackedMarks`.
- Removing code should remove both the inline code styling and the language value.
- Clearing only language should keep bare inline code. This should write a new non-remove `code` mark with no data, not a remove mark.
- Syntax highlighting should be constrained to each code mark range. A `javascript` code mark in the middle of a paragraph should not highlight surrounding prose.
- Adjacent code runs with the same language should be treated as one hover/edit range, including when split by other marks like bold.
- Adjacent code runs with different languages should remain separate ranges.
- The editable DOM uses `textContent` and rebuilt spans. Dataset offsets must continue to line up with `segmentText`, not UTF-16 indices.
- Code block highlighting and inline code highlighting can coexist in the same renderer. Avoid accidentally double-highlighting code block text as inline code unless that is explicitly desired.

## Testing Plan

Unit tests:

- `inlineMarks.test.ts`
  - detects contiguous code ranges across adjacent runs with the same language
  - separates adjacent code ranges with different languages
  - returns a shared language only when every selected character has the same code language
  - treats bare code (`true`) as code with no language

- `syntaxHighlight.test.ts`
  - existing tests already cover language normalization and fallback
  - add coverage only if introducing a new helper for range-scoped inline syntax tokens

- `blockCommands.test.ts` or `multiSelectionCommands.test.ts`
  - setting a bare code mark writes `marks.code === true`
  - setting a language writes `marks.code === 'typescript'` or chosen normalized value
  - clearing language leaves `marks.code === true`
  - removing code clears the mark
  - overlapping language applications resolve non-stacking via the existing LWW behavior

Integration tests in `App.test.tsx`:

- selecting text and pressing the code toolbar button renders `.markCode`
- hovering a code mark opens code actions
- editing language to `javascript` adds syntax classes to tokens inside that inline range
- clearing language removes syntax classes but keeps `.markCode`
- removing code removes `.markCode`
- hovering/editing a code mark that also has bold/link/annotation marks still finds the correct contiguous code range
- code block syntax highlighting still works after inline code changes

## Open Questions

1. Should users be able to create inline code from a collapsed cursor and then type into it?
   - Existing boolean marks support pending retained mark sessions for collapsed typing.
   - Link does not.
   - Inline code could start range-only for less complexity, or it could join the retained mark session machinery as a bare code mark.

   -> yes please

2. Should the language UI be a free-text input or a constrained select?
   - `syntaxHighlight.ts` supports aliases and graceful fallback for unknown languages.
   - A free-text input is flexible but can store unsupported languages unless normalized/validated.
   - A select is clearer for the currently bundled languages but less extensible.

    -> free-text input

3. Should stored language values preserve aliases or normalize before writing?
   - Normalizing before write means `ts` stores as `typescript`, simplifying equality/range merging.
   - Preserving aliases keeps user input but makes adjacent `ts` and `typescript` ranges look separate unless helpers normalize for comparison.
   - I recommend normalizing before writing.

    -> normalize if possible, but allow unknown values

4. What should "Clear language" do in the hover UI?
   - Recommended: keep the `code` mark and write a bare `code` mark (`data: undefined`) over the range.
   - Alternative: make empty input remove the code mark entirely, matching link behavior. That is less consistent with the requirement because language is optional for inline code.

    -> write a bare mark

5. Should inline code be allowed inside code blocks?
   - It is technically possible because marks are independent of block meta.
   - Visually it may be redundant and could create confusing nested highlighting.
   - Recommended: render inline code styling in normal rich text blocks; in code blocks, ignore `.markCode` styling and rely on block-level highlighting, or disallow applying inline code while the selection is inside a code block.

    -> sure, let's allow it

6. Should code marks be editable inside annotation bodies?
   - The example has a separate annotation body editor command path for links and boolean marks.
   - If parity is expected, code commands/popovers need to be implemented there too.
   - If not, code should at least render correctly in annotation body content.

    -> yes

7. Should Markdown shortcuts create inline code from backticks?
   - The task does not ask for this.
   - Existing shortcuts handle block transformations and pasted prefixes. Inline backtick conversion would be useful but should be a separate change unless requested.

    -> sure
