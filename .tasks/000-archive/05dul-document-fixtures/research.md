# Research: Document Fixtures for Block Rich Text

## Goal

Add built-in JSON document fixtures to `examples/block-rich-text` and expose a UI dropdown that replaces the current document from a selected fixture.

The requested fixture set is:

- simple document with a few block types
- long blocks: 4 blocks, 400 words each
- one long heavily marked block: 600 words, a mark every 10 words, each lasting 1-3 words
- large table: 5 x 7, a few words in each cell
- sparse table: rows with missing cells
- large complex table: nested tables inside rows/cells
- deep nesting: depth 5, lists of lists of lists of lists
- many blocks: 200 blocks, 10 words each
- any extra useful stress fixtures

## Current Document Format

Relevant files:

- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/style.css`

`documentFormat.ts` defines JSON import/export around:

```ts
export type DocumentBlock = {
    type?: DocumentBlockType;
    meta?: DocumentBlockMeta;
    content?: string;
    marks?: DocumentMark[];
    children?: DocumentBlock[];
};
```

Supported block types:

- `paragraph`
- `heading`
- `list_item`
- `todo`
- `blockquote`
- `code`
- `callout`
- `recipe_ingredient`
- `table`
- `image`
- `preview`

Supported inline marks:

- `bold`
- `italic`
- `strikethrough`
- `code`
- `link`

Mark offsets are grapheme offsets and are validated against block content. The importer creates a fresh empty CRDT state, inserts blocks recursively, inserts text, then applies marks. Export returns normalized JSON with explicit block types and metadata.

Tables are represented as ordinary nested blocks. A `table` block has child blocks that act as rows, and each row has child blocks that act as cells. The document format does not enforce row/cell block types, rectangularity, or cell counts; this is useful for sparse and complex table fixtures.

Example table fixture shape:

```ts
{
    type: 'table',
    content: 'Roadmap',
    children: [
        {
            content: 'Header row',
            children: [
                {content: 'Area'},
                {content: 'Owner'},
                {content: 'Status'},
            ],
        },
    ],
}
```

## Current App State Flow

`EditorApp` does not keep a mutable `DemoState` directly. It stores `HistoryState`, then derives `demo` via:

```ts
const demo = useMemo(() => replayHistory(history.actions, history.cursor), ...)
```

`replayHistory` always starts from `createDemoState()`, which creates the default one-paragraph document. User edits are stored as `local-change` history actions. Reset clears history and attachments. History import/export is separate from document JSON import/export.

This matters for fixture loading: replacing the document needs either:

1. A history action that contains the import ops, so replay continues to work from the default initial state.
2. A broader state model change where history has an initial document/base state.
3. A reset-style operation that builds history from the fixture import ops.

The lowest-risk approach is option 3: when selecting a fixture, confirm if there is existing history, revoke/clear attachments, import the JSON fixture into a fresh state with `importDocument`, then set history to a single `local-change` action whose ops are the fixture import ops and whose selection points at the first imported block. Because `importDocument` imports into an empty document, this action cannot simply be applied over the default one-paragraph state without deleting that starter block first.

So the cleaner low-risk variant is to add a small runtime/history helper that creates a fixture-backed initial demo:

- add `createDemoStateFromDocument(document, actor?)` or `createDemoStateFromState(state)`
- extend history with an explicit base action, e.g. `{type: 'replace-document'; document: ImportDocument}` or `{type: 'replace-document'; ops: Op[]; selection: RetainedSelectionSet}`
- make `replayHistory` apply this action by replacing both replicas rather than applying ops on top of the current state

This avoids delete-all hacks and keeps fixture selection replayable/exportable.

## Proposed Implementation Shape

Add a fixture module:

- `examples/block-rich-text/src/documentFixtures.ts`

Suggested API:

```ts
import type {ImportDocument} from './documentFormat';

export type DocumentFixture = {
    id: string;
    label: string;
    document: ImportDocument;
};

export const documentFixtures: DocumentFixture[] = [...];
```

Prefer generated fixture data in TypeScript over large static JSON files. The larger fixtures can be deterministic builders:

- `words(count, seedLabel)` for repeatable pseudo-prose
- `paragraph(content, marks?)`
- `table(rows: DocumentBlock[][], title?)`
- `nestedList(depth, breadth)`
- `markedLongBlock()` that derives mark ranges from word boundaries

This keeps the repo readable and avoids thousands of lines of fixture text. Tests can validate the generated fixture documents through `importDocument`.

Add fixture validation tests:

- `examples/block-rich-text/src/documentFixtures.test.ts`

Coverage:

- every fixture imports without throwing
- fixture ids are unique
- expected root/block counts for the stress fixtures
- long-block fixture has 4 root blocks with about 400 words each
- many-block fixture has 200 blocks
- large table has 5 rows and 7 cells per row
- sparse table has at least one row with fewer cells
- complex table contains nested `table` blocks
- marked fixture has 600 words and many marks, all valid after import/export

Add UI controls in `EditorApp` near the existing history controls:

- a `<select aria-label="Replace document from fixture">`
- first option should be a placeholder such as `Replace document...`
- on change, confirm if there is existing history
- reset transient selections, history status, undo status, and attachments
- set status like `Loaded fixture: Large table.`

Style can extend `.historyControls` or split fixture controls into a small `.fixtureControls` group. Existing CSS already styles `select` globally and toolbar selects, but not top-level history selects.

## Fixture Recommendations

Required fixtures:

- `simple-mixed-blocks`: heading, paragraph with marks, todo, callout, code, blockquote, ordered/unordered list items, preview metadata. Avoid image unless fixture loading also seeds attachments.
- `long-blocks`: 4 paragraph blocks, each 400 words.
- `marked-long-block`: 1 paragraph, 600 words. Every 10th word starts a mark of 1-3 words. Cycle through `bold`, `italic`, `strikethrough`, `code`, and `link`.
- `large-table`: 5 rows x 7 cells. Use row content like `Row 1` and cell contents like `Alpha 1 1`.
- `sparse-table`: table rows with intentionally uneven child counts, e.g. 7, 4, 6, 2 cells.
- `complex-table`: top-level table with nested table children inside selected row/cell blocks. Include a row whose child is itself a `table`, and a normal cell whose child is a nested `table`.
- `deep-list-nesting`: depth 5 nested `list_item` blocks, with mixed ordered/unordered metadata.
- `many-blocks`: 200 paragraph/list/todo/callout-ish blocks, 10 words each.

Additional useful fixtures:

- `mixed-table-and-text`: prose before and after a table, to test table boundary navigation.
- `code-and-callouts`: code blocks with languages plus info/warning/error callouts.
- `wide-mark-overlaps`: overlapping bold/italic/link/code ranges on a medium paragraph, useful for export normalization and rendering.
- `empty-and-short-blocks`: empty paragraph, empty todo, one-character block, emoji/grapheme content with marks.

## Main Risks

History integration is the only non-trivial design point. A fixture import produces a complete replacement document, but current history replay assumes every action is an edit applied on top of the default demo state. Adding a first-class `replace-document` history action is cleaner than trying to turn the replacement into normal editing ops.

Selections must be reset to a valid point in the imported document. `importDocument` returns `blockIds`, so fixture loading can set selection to the first imported block at offset 0, or use `initialRetainedSelectionSet(imported.state)` if that already resolves correctly for non-empty imported docs.

Fixture loading should clear attachments unless image fixtures are explicitly supported. `image` blocks require `attachmentId`, but fixture JSON alone cannot provide a live object URL-backed `AttachmentStore`.

Very large fixtures should be generated deterministically, not hand-written, and should avoid random behavior in tests.

## Open Questions

1. Should selecting a fixture be recorded in exported history? If yes, add a `replace-document` history action. If no, fixture selection can simply reset local state, but exported history would not fully explain how the document started.

- starts a new history

2. Should fixture replacement preserve existing history, or always reset history? The UI wording says "replace document", so resetting history is probably expected.

- reset history

3. Should the "long block with lots of marks" include annotations/popovers? Current `DocumentMark` cannot represent annotation/popover marks; it only supports bold, italic, strikethrough, code, and link. Supporting popovers would require extending `documentFormat` to serialize annotation mark data and body blocks, or leaving popovers out of JSON fixtures for now.

- yes please

4. Should fixtures include image blocks? The document format supports image metadata, but the app would need seeded attachments. Without that, image fixtures may render as missing assets.

- yeah, let's include image blocks. have the code generate some simple images using HTMLCanvas on the fly when selecting one of those. Also, let's have one of the image blocks have a missing asset, to see how that renders.

5. Should fixtures live as generated TypeScript data or static `.json` files? TypeScript builders are more maintainable for 200-block and 600-word fixtures, while JSON files are more representative of import/export artifacts.

- geenrated on the fly

6. How should sparse/complex tables be interpreted by UI commands that expect rectangular tables? Current tests cover moving rows/cells without padding in some cases, but fixture QA should verify rendering and basic navigation on imported sparse tables.

- idk let's see what the current code does

## Suggested Verification

Run focused tests:

```sh
npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/documentFixtures.test.ts examples/block-rich-text/src/App.test.tsx
```

Manual UI check:

- start the example with `npm run dev` from `examples/block-rich-text`
- select each fixture from the dropdown
- confirm both editor replicas show the replacement
- type into both sides after loading a fixture
- verify table fixtures render and basic table navigation still works
