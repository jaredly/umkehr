# Research: Inline Math Rendering in `examples/block-rich-text`

## Goal

Add inline math rendering to `examples/block-rich-text` while preserving the editor's collaborative editing behavior. The key requirement is that two replicas can edit the same equation concurrently and those edits merge through the existing block CRDT rather than overwriting each other as a single opaque value.

The task also calls out split and join behavior: ideally, splitting a block inside an equation should leave the left half in the original block and move the right half to the new block, and joining should recombine the marked math text where possible.

## Current Architecture

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/inlineEmbeds.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `src/block-crdt/marks.ts`
- `src/block-crdt/types.ts`

The editor stores normal text as CRDT characters. Local text insertion creates one `char` op per grapheme-like text segment via `localInsertTextOps` / `insertTextOps`. Concurrent edits inside the same text range already merge at this character level.

Inline formatting is represented as marks. Marks are anchored to stable character boundaries, not offsets:

```ts
export type Mark = {
    id: Lamport;
    start: Boundary;
    end?: Boundary;
    remove: boolean;
    type: string;
    data?: JsonValue;
    crossedSplits: Lamport[];
};
```

`materializeFormattedBlocks` resolves marks into formatted runs. Marks already handle split traversal through `crossedSplits`, and `visibleRangesForMark` can materialize visible ranges for a mark after structure changes.

The example already has an inline embed system. An embed is currently a single object replacement character (`\uFFFC`) with an `embed` mark carrying JSON payload:

```ts
export const INLINE_EMBED_MARK = 'embed';
export const INLINE_EMBED_TEXT = '\uFFFC';
```

Rendering treats that one character as an atomic `contentEditable=false` inline element. The current date embed editor updates the payload by writing a new mark over the replacement character.

The example does not currently depend on MathJax, KaTeX, or MathQuill.

## Option A: Atomic Inline Embed with LaTeX Payload

This is the smallest extension of the current embed system:

```ts
{type: 'math', value: '2 + \\pi'}
```

The renderer would add a math embed plugin that converts `value` to MathJax output. Editing could use the existing popover flow, or a click-to-inline-source mode.

Strengths:

- Smallest local change.
- Fits the existing `insertInlineEmbed` / `setInlineEmbedDataByCharId` flow.
- Selection is already handled for atomic embeds in `domSelection.ts`.
- Moving a block does not disturb the embed because the replacement character has a stable CRDT character id.
- Split/join around the embed works as one character.

Weaknesses:

- Concurrent edits inside the same equation are last-writer-wins at the payload/mark level. Two users editing `2 + \pi` concurrently would each submit an entire new JSON string; the highest Lamport mark wins.
- Splitting in the middle of an equation is impossible because the equation is one object replacement character.
- Undo, clipboard, import/export, and retained selection all see the equation as one character unless custom logic expands it.

Conclusion: useful for atomic widgets, but it does not satisfy the strongest collaborative editing requirement.

## Option B: Dollar-Delimited Source Text with a Math Mark

Store the LaTeX source as ordinary CRDT text, for example:

```text
$2 + \pi$
```

Then apply a `math` mark over the whole delimited range, or derive the range from delimiters during rendering. Rendering replaces or overlays that marked range with MathJax output when the range is not actively being edited.

Strengths:

- The equation source remains normal CRDT text. Concurrent edits inside the equation merge through the existing character CRDT.
- Split and join are naturally closer to the requested behavior. If a split happens inside the source, the right-side characters move to the new block. Marks already have split-aware traversal machinery.
- Copy/paste and plain text export can preserve the source string.
- Undo and redo can operate on text edits instead of opaque payload rewrites.
- This model is compatible with retained selections anchored to character ids.

Weaknesses:

- Rendering a range as MathJax dramatically changes the DOM shape. The current inline mark rendering mostly maps runs to spans with visible text; rendered math needs an alternate display subtree and careful offset sentinels.
- Native browser selection cannot directly edit hidden source text while showing only the rendered MathJax output.
- Partial selections through rendered math need explicit behavior: select the whole equation, enter source mode, or map click positions back to source offsets.
- Malformed or incomplete LaTeX is common while typing and must render gracefully.

Recommended behavior:

- Treat `$...$` as source text in edit mode.
- Render the range as MathJax only when the caret/selection is outside that math range.
- When the caret enters the range, display the literal source text and let normal editing occur.
- On blur or when the selection leaves the range, switch back to rendered mode.
- Keep delimiters in the CRDT text for simple plain text behavior and robust split/join semantics.

Conclusion: this best matches the collaboration requirement because the source is not opaque.

## Option C: Inline Embed Whose Internal Source Is Also CRDT Text

This would model a math equation as an embed object that points to a nested CRDT document or nested character sequence. The visual equation is atomic in the parent block, but the source has its own collaborative text model.

Strengths:

- Clean visual atom in the parent editor.
- Concurrent edits inside the equation can merge if the nested model uses the same CRDT primitives.
- Could support a specialized math editor later.

Weaknesses:

- The current CRDT does not have nested inline documents.
- Split/join in the middle of equation source becomes a custom cross-document operation.
- Selection, undo, persistence, import/export, clipboard, and remote op routing all need new structure.
- This is much larger than the example currently needs.

Conclusion: potentially interesting long-term, but not a pragmatic first implementation.

## Option D: MathQuill / Structured Math Editing

MathQuill gives an interactive equation editing UI rather than just rendering LaTeX.

Strengths:

- Better equation editing UX than raw LaTeX for many users.
- Can still store LaTeX as text if integrated carefully.

Weaknesses:

- It introduces another editing engine inside a `contentEditable` editor.
- Its internal editing model would need to be synchronized back to CRDT text edits at a fine granularity to preserve collaborative merging.
- Selection, IME, clipboard, and focus interactions are likely to be complex.

Conclusion: not a good first step for this codebase. It may be useful later as an edit-mode UI if it emits granular source text edits instead of whole-string replacements.

## Recommendation

Start with Option B: dollar-delimited source text plus a math mark/rendering layer.

The central design point is that the CRDT source of truth should be text, not an embed payload. Math rendering should be a view of that text. This preserves collaborative behavior because edits to `2 + \pi` are ordinary character inserts/deletes/moves, and the existing CRDT can merge concurrent changes at character granularity.

There are two plausible ways to identify math ranges:

1. Derived ranges: scan block text for `$...$` and render those ranges as math.
2. Stored marks: when a complete `$...$` pair is typed or pasted, apply a `math` mark over the delimited range.

I would start with derived ranges for the prototype, then add stored marks only if the UI needs explicit commands, stable range identity, or non-dollar math syntaxes. Derived ranges avoid mark maintenance when users type or delete delimiters. Stored marks fit existing mark operations but need cleanup when delimiters become unbalanced or the source is split.

If using stored marks, keep the delimiters inside the marked range. That makes split/join and plain text behavior predictable.

## Rendering Plan

Add a `math` inline rendering pass after runs are available:

- Detect inline math ranges in each visible block from the rendered plain text.
- Split run chunks at math boundaries, similar to how existing rendering splits by run and syntax/highlight boundaries.
- If the block selection intersects a math range, render that range as literal text.
- If the selection is outside the range, render a `contentEditable=false` math preview element plus hidden/sentinel text needed for offset mapping.

For the first implementation, prefer KaTeX or MathJax's direct typesetting API over MathQuill. MathJax is named in the task and gives broad LaTeX support, but it is asynchronous and heavier. KaTeX is usually simpler for synchronous inline rendering. If the explicit product goal is "MathJax rendered math", use MathJax; if the goal is inline math rendering with less editor complexity, evaluate KaTeX.

The preview element should store:

- `data-inline-math="true"`
- `data-block-id`
- `data-start-offset`
- `data-end-offset`
- the source string, excluding or including delimiters consistently

This mirrors the existing embed dataset approach and gives `domSelection.ts` enough information to map clicks near math previews to block offsets.

## Editing Behavior

Initial behavior should be intentionally simple:

- Typing `$` can just insert text.
- Complete `$...$` ranges render after selection leaves them.
- Clicking rendered math places the caret at a deterministic source boundary or enters source mode for the whole range.
- Double-click or Enter on rendered math can place the caret inside the source, preferably after the opening `$`.
- While source mode is active, the literal `$...$` text is shown and all normal text commands apply.
- If the source is malformed, render the literal text with a math-error style instead of throwing.

Avoid editing MathJax's generated DOM directly. It should be treated as display output only.

## Split and Join

Derived ranges make split/join behavior straightforward:

- Split inside `$abc|def$` produces `$abc` in the left block and `def$` in the right block. Neither side is a complete range, so neither renders until the user rejoins or adds delimiters.
- Join recombines the text and the range renders again if delimiters are balanced.

Stored marks are more ambitious:

- A mark over `$abcdef$` can survive a split because marks track character ids and `crossedSplits`.
- The existing mark traversal can display visible ranges across split blocks.
- Rendering a single marked equation across two visible blocks is awkward, though. It may need to render as literal text whenever a math range spans multiple visible blocks.

Recommendation for first implementation: render only math ranges fully contained in one visible block. Let split-in-the-middle degrade to source text on both sides. Join restores rendering when the delimiters are complete in one block again.

## Collaboration Semantics

The source-text approach gives the desired merge behavior:

- Concurrent insertions inside the same equation become normal CRDT character insertions.
- Concurrent deletions are normal character tombstones.
- Block moves do not affect the equation source within a block.
- Split/join are already represented by block CRDT operations.

The main collaborative edge case is concurrent delimiter editing. For example, one user deletes the closing `$` while another edits inside the equation. That should be accepted as ordinary text state; rendering simply turns off until a valid range exists again.

If stored marks are used, mark conflicts are not the equation source conflict. The source still merges, but the math mark may become stale or disagree with delimiters. A reconciliation pass or derived rendering can avoid this issue.

## Import / Export / Clipboard

Current document import/export supports bold, italic, strikethrough, code, and link marks. Math should be added only after the runtime model is settled.

Suggested first behavior:

- Plain text clipboard copies `$...$`.
- HTML clipboard can copy rendered math plus a plain text fallback.
- Document export preserves source text. If stored marks are used, add `{type: 'math', start, end}`.
- Document import can either preserve dollar text as text or apply math marks for complete ranges.

## Testing Plan

Core tests to add:

- Detects complete inline math ranges and ignores unbalanced `$`.
- Does not treat escaped dollars (`\$`) as delimiters, if escaping is supported.
- Renders literal source while the selection intersects the range.
- Renders preview while selection is outside the range.
- Maps clicks on preview to stable block offsets.
- Concurrent inserts inside a math range merge as normal text.
- Deleting a delimiter disables rendering without losing source.
- Split inside a math source degrades to literal text.
- Join restores rendering when the source becomes complete again.
- Clipboard/plain text export preserves `$...$`.

If using MathJax in tests, isolate the math renderer behind a small adapter so tests can use a deterministic fake renderer.

## Open Questions

- Should inline math use single dollar `$...$`, `\(...\)`, or both?
    - single dollar
- Should display math (`$$...$$`) be supported, or is this strictly inline math?
    - sure
- Should delimiters be visible in source mode only, or always shown around rendered output?
    - so the delimiters are just a 'markdown shortcut', and are not required for the basic implementation. similiar to other markdown shortcuts, when it is processed, the delimiters get tombstoned. Additionally, the user can just apply the mark to non-delimited text and it should work.
- Should clicking rendered math put the caret before/after the equation, select the whole equation, or enter source mode?
    - I would love for it to drop you into the source text at a reasonable place, based on the seelection. but to start we can just drop you into source mode
- Should source mode be per equation, per block, or only based on current selection intersection?
    - per equation
- Should malformed LaTeX render as literal text, an error pill, or MathJax's error output?
    - let's try literal text
- Do we need deterministic server/test rendering, or is client-only visual rendering enough for the example?
    - yeah we should render in test as well
- Should stored `math` marks exist at all, or should math ranges remain purely derived from text delimiters?
    - yes, definitely math marks. Display math should use the same `math` mark with metadata, not a separate `math-display` mark.
- If stored marks exist, should they include delimiters or only the inner LaTeX source?
    - delimiters are shortcuts only, and will be deleted
- Should equations spanning split blocks ever render across blocks, or should multi-block math always fall back to literal source?
    - same as other marks, if split they'll render separately
- Which renderer should be used first: MathJax for broader compatibility with the request wording, or KaTeX for simpler synchronous rendering?
    - let's use mathjax

## Proposed First Slice

1. Add `math` mark helpers that distinguish inline/display mode from mark metadata, plus shortcut helpers for `$...$` and `$$...$$`.
2. Add a math renderer adapter with a fake/test implementation and a real MathJax-backed implementation.
3. Update inline run rendering to render complete math ranges as non-editable previews only when the current selection does not intersect the range.
4. Add click handling that enters source mode or places the caret inside the source range.
5. Add CSS for inline math previews and error fallback.
6. Add focused tests for range detection, source/render mode switching, and split/join degradation.

This slice avoids changing the CRDT core. It uses the existing text model for collaboration and treats math rendering as editor presentation.
