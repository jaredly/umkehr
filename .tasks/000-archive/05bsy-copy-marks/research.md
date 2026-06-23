# Research: Copy And Paste Marks

## Goal

When copying and pasting in `examples/block-rich-text`, pasted text should preserve the marks carried by the copied selection.

Required behavior from the task:

- Copying bold, italic, strikethrough, or link-marked text should paste with those marks.
- Copying text with an annotation mark should paste with an annotation mark that points at the same annotation block when pasting inside the same document.
- Copying text with an annotation mark into a different document should include enough annotation-body data to recreate that annotation there.
- When pasting annotation data into a document that already has the target annotation, paste should not overwrite the existing annotation body.

## Current State

The block rich text app currently handles paste as plain text.

- Main editor paste prevents the browser default and passes only `text/plain` into `pastePlainTextWithMarkdownShortcutsEverywhere` (`examples/block-rich-text/src/App.tsx:2275`).
- Annotation body paste also reads only `text/plain` and routes to `pasteAnnotationBodyTextWithMarkdownShortcuts` (`examples/block-rich-text/src/App.tsx:3325`).
- There is no `onCopy` handler in `examples/block-rich-text/src`, and no custom clipboard MIME type currently used by the block-rich-text example.

The plain text paste implementation already has useful insertion behavior:

- `pastePlainTextDetailed` normalizes line endings, inserts the first line at the selection, splits blocks for later lines, and records `touchedLines` with destination block ids and offsets (`examples/block-rich-text/src/blockCommands.ts:669`).
- `pastePlainTextWithMarkdownShortcuts` applies markdown shortcuts after insertion (`examples/block-rich-text/src/blockCommands.ts:702`).

Existing mark application primitives are available:

- `insertTextWithMarks` can apply boolean marks to a newly inserted single-block text range (`examples/block-rich-text/src/blockCommands.ts:154`).
- `toggleMark`, `setLinkMark`, and the internal `setValuedMark` apply mark ops over normalized selection segments (`examples/block-rich-text/src/blockCommands.ts:1037`, `examples/block-rich-text/src/blockCommands.ts:1067`).
- Retained typing marks use boundary marks over newly inserted char IDs (`examples/block-rich-text/src/blockCommands.ts:192`), but this is optimized for interactive typing sessions, not arbitrary clipboard ranges.

Annotation support is more complex than boolean/link marks:

- `createAnnotation` creates an annotation mark and a virtual body block under the annotation id (`examples/block-rich-text/src/annotations.ts:50`).
- Annotation body blocks are discovered by `annotationBodyBlockIds`, which returns visible children of the annotation id under the annotation virtual-parent config (`examples/block-rich-text/src/annotations.ts:486`).
- `renderedAnnotations` exposes body block text, runs, and meta for active annotation data (`examples/block-rich-text/src/annotations.ts:502`).
- Annotation marks store `AnnotationMarkData` with an `id`, `presentation`, and optional `resolved` flag (`examples/block-rich-text/src/annotations.ts:550`).
- Existing annotation helpers deliberately look up existing annotations by covered source char IDs (`exactAnnotationForSegments`, `examples/block-rich-text/src/annotations.ts:609`), which is useful for UI annotation creation but not enough for cross-document clipboard import.

## Clipboard Payload Shape

The browser clipboard should continue to include `text/plain` for compatibility, plus a custom JSON MIME type for lossless intra-app paste.

Suggested MIME type:

```text
application/x-umkehr-block-rich-text+json
```

Suggested payload:

```ts
type RichClipboardPayload = {
    version: 1;
    plainText: string;
    blocks: Array<{
        text: string;
        meta?: RichBlockMeta;
        marks: Array<{
            type: 'bold' | 'italic' | 'strikethrough' | 'link' | 'annotation';
            startOffset: number;
            endOffset: number;
            data?: unknown;
        }>;
    }>;
    annotations: Array<{
        originalId: string;
        presentation: AnnotationPresentation;
        resolved?: boolean;
        bodyBlocks: Array<{
            text: string;
            meta: RichBlockMeta;
            marks: Array<{
                type: 'bold' | 'italic' | 'strikethrough' | 'link';
                startOffset: number;
                endOffset: number;
                data?: unknown;
            }>;
        }>;
    }>;
};
```

Notes:

- Store offsets relative to each copied block/line, not original document offsets.
- Include `plainText` and set `text/plain` to the same value.
- For boolean marks, `data` can be omitted or `true`.
- For link marks, `data` should be the href.
- For annotation marks, `data` should include enough to identify the source annotation: original annotation id and presentation. The paste step will map this to either an existing destination annotation id or a newly created one.
- Annotation body blocks should include their own formatting marks. Annotation body copy/paste should not be a special dead end.

## Extraction Approach

Build a clipboard serializer near `inlineMarks.ts` or in a new focused module such as `clipboard.ts`.

Recommended inputs:

- Current `CachedState<RichBlockMeta>`.
- Current `RetainedSelectionSet` or resolved primary `EditorSelection`.
- Formatted blocks from `materializeFormattedBlocks(state, annotationMarkBehavior)` for visible runs and marks.
- Annotation bodies from `renderedAnnotations(state, materializeFormattedBlocks(...), materializeFormattedBlocks(..., annotationVirtualParents(...)))`.

Extraction steps:

1. Resolve and normalize the selection into block segments.
2. Build `plainText` using the existing selected-text behavior as a baseline, preserving newline separators between selected blocks.
3. For each selected segment, walk formatted runs with offsets and emit mark ranges clipped to the selected segment.
4. For annotation marks, collect active `AnnotationMarkData` values from stacked marks, not only `run.marks`, because annotation behavior is configured as stacking.
5. For each referenced annotation id, include the corresponding annotation body blocks and their inline marks.

Important detail: `FormattedRun` can contain `stackedMarks`. Annotation marks should be read through `formattedMarkValues(run, ANNOTATION_MARK)` or the existing annotation helpers, not by looking only at `run.marks[ANNOTATION_MARK]`.

## Paste/Reconstruction Approach

Add a rich paste command that falls back to current plain paste when no valid custom clipboard payload exists.

Recommended flow:

1. On paste, read the custom MIME type first.
2. Validate `version`, `plainText`, block/mark offsets, and annotation entries.
3. Insert the payload text using the same mechanics as `pastePlainTextDetailed`, because that already handles selection replacement, multi-line split behavior, and destination line mapping.
4. Use the returned destination block ids and start offsets to map payload-local mark ranges to inserted document ranges.
5. Apply mark ops over the inserted ranges:
   - Boolean marks: `markRangeOp(..., markType, undefined, false, ...)`.
   - Links: `markRangeOp(..., LINK_MARK, href, false, ...)`.
   - Annotation refs: map source annotation id to a destination annotation id, then apply `ANNOTATION_MARK` with destination `AnnotationMarkData`.
6. Apply markdown shortcut conversion either before or after mark replay by policy. If shortcut text is deleted by markdown conversion, mark offsets need to be adjusted. The simpler first implementation may skip markdown shortcut conversion for rich payloads and keep it only for plain text paste.

Annotation id mapping is the core design point:

- Same-document paste should keep the same annotation id when the destination state already contains that annotation id and body blocks.
- Cross-document paste cannot reuse the source Lamport id safely if it conflicts with existing state or actor/clock assumptions. It should allocate a fresh annotation id and rewrite the pasted annotation mark data to that new id.
- If the destination already has an annotation matching the source id, do not overwrite its body blocks. Reuse the existing annotation id and only add new reference marks over the pasted text.
- If the destination does not have that annotation, create the annotation body blocks from the payload.

Because `createAnnotation` is coupled to current selected ranges and exact existing source-char matching, it is probably not the right primitive for paste reconstruction. A paste-specific helper should create annotation mark ops and body block ops directly, reusing the same lower-level primitives used by `createAnnotation`.

## Same Document Detection

The task says "if they do exist, it should not overwrite them." The implementation needs a clear definition of "exist".

Practical first definition:

- An annotation exists if `state.state.blocks[annotationId]`-style lookup is not applicable, because annotations are mark ids, not normal blocks.
- Instead, scan active annotation marks for matching `AnnotationMarkData.id`, using logic similar to `findAnnotationMarks`.
- Also check `annotationBodyBlockIds(state, annotationId)` to see whether body blocks are already present.

If found:

- Reuse that annotation id.
- Do not import payload body blocks.

If not found:

- Allocate a new annotation id from the current actor/clock.
- Insert body blocks under that new annotation id.
- Apply pasted annotation marks with rewritten `AnnotationMarkData.id`.

## Testing Strategy

Command-level tests should cover the data model before UI wiring:

- Serialize a selection containing mixed plain and bold text, paste it, and assert `materializeFormattedBlocks` has the same bold ranges at the pasted destination.
- Preserve overlapping boolean marks, e.g. bold plus italic over partially overlapping ranges.
- Preserve links and their href values.
- Preserve annotation reference marks in same-document paste and assert the pasted reference points at the existing annotation id.
- Cross-document import should create a new annotation id, copy body block text, and apply pasted reference marks to that new id.
- Cross-document import should not overwrite an existing annotation body when the destination already has the referenced annotation id.
- Multi-line copy should preserve per-line mark offsets after paste creates/splits blocks.
- Pasting a malformed or unknown-version payload should fall back to `text/plain`.

UI tests should cover:

- `copy` writes both custom MIME and `text/plain`.
- Main editor `paste` prefers custom MIME over `text/plain`.
- Annotation body paste either preserves formatting there too or explicitly falls back to plain text, depending on the resolved product decision.

## Open Questions

1. Should rich paste still run markdown shortcuts? If yes, mark ranges need to be transformed after shortcut deletion and block meta changes. If no, rich paste can preserve literal copied text and marks more predictably.
- no, not when the copied data is 'rich'
2. Should copied block metadata be preserved, or is this task strictly inline text marks? The task only mentions associated marks, but the current paste path can create multiple blocks, so block type preservation may come up next.
- yes please
3. Should copying from annotation body editors preserve annotation body inline marks only, or should it also preserve annotation references if an annotation body somehow contains them?
- annotation body text can contain other annotations, yes. it shouldn't need any special handling though.
4. What is the preferred cross-document annotation identity policy? A fresh destination annotation id is safest, but if payload ids are globally unique enough, reusing non-conflicting source Lamport ids would make repeated paste dedupe easier.
- hmm good thought. let's make fresh ids for now
5. How should resolved annotations paste? The current render path filters to active annotations, but payloads may contain `resolved`. It is probably best to copy only active annotation references.
- let's go ahead and copy everything
6. Should browser `text/html` also be populated for interoperability with other editors, or is `text/plain` plus custom JSON enough for this task?
- text/html would be great
7. Should multi-selection copy be supported immediately? The app has retained multi-selection infrastructure, so the serializer needs either a deterministic multi-selection order or an initial single-primary-selection limitation.
- yes please. multiple selections should be pasted as subsequent adjacent new blocks.

## Recommended First Implementation

1. Add `examples/block-rich-text/src/clipboard.ts` with pure serializer/parser/replay helpers and command-level tests.
2. Support custom MIME plus plain text for main-editor selections.
3. Implement boolean, link, and annotation reference paste for regular editor blocks.
4. Recreate missing annotation bodies with a fresh annotation id when needed, and never mutate existing body blocks during paste.
5. Wire `onCopy` and rich `onPaste` in `App.tsx`, falling back to current plain paste.

This keeps the UI change small and puts most correctness in testable pure command helpers.
