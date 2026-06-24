# Plan: Document Fixtures for Block Rich Text

## Decisions From Research

- Fixture selection starts a new history.
- Fixture replacement resets the current history.
- Fixtures are generated on demand in TypeScript, not stored as large static JSON files.
- The marked long-block fixture should include annotations/popovers, so `documentFormat` needs annotation support.
- Fixtures should include image blocks. The fixture loader should generate simple canvas images on the fly for valid image assets, and include at least one missing image asset block.
- Sparse/complex table behavior should be observed with the current rendering/navigation code rather than normalized up front.

## Phase 1: Extend `documentFormat` for Annotations

Files:

- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- possibly `examples/block-rich-text/src/annotations.ts`

Add a JSON shape for annotations/popovers. Keep it explicit and fixture-friendly:

```ts
type DocumentAnnotation = {
    type: 'annotation';
    presentation: 'sidebar' | 'footnote' | 'popover';
    start: number;
    end: number;
    resolved?: boolean;
    body?: DocumentBlock[];
};
```

Implementation work:

- Add `annotations?: DocumentAnnotation[]` to `DocumentBlock`.
- Parse and validate annotations similarly to marks:
  - `start`/`end` are grapheme offsets into `content`.
  - `presentation` is one of `sidebar`, `footnote`, `popover`.
  - `body` defaults to one paragraph or an empty array, based on what renders best.
- During import, create annotation marks with `ANNOTATION_MARK` and `AnnotationMarkData`.
- Insert annotation body blocks as children of the annotation mark id, using `annotationVirtualParents`.
- Ensure annotation body blocks can themselves contain normal block content/marks if practical.
- During export, include active annotations with their body blocks.
- Decide whether resolved annotations export; simplest is to support `resolved?: true` but fixture generation should use active annotations.

Tests:

- Imports a block with a popover annotation and body text.
- Imports sidebar/footnote/popover annotation presentations.
- Rejects invalid annotation ranges and invalid presentation values.
- Exports annotation data and body blocks in a stable normalized shape.

Notes:

- Existing annotation creation logic in `createAnnotation` can guide the op sequence.
- Avoid coupling fixture generation directly to annotation CRDT internals; `documentFormat` should own this serialization behavior.

## Phase 2: Add Fixture Generation

Files:

- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/documentFixtures.test.ts`

Create a generated fixture module:

```ts
export type DocumentFixture = {
    id: string;
    label: string;
    document(): ImportDocument;
    attachments?: () => Promise<AttachmentStore>;
};
```

Use functions instead of precomputed arrays for heavy fixtures so they are generated only when selected or tested.

Required fixtures:

- `simple-mixed-blocks`
  - heading, paragraph with marks, todo, callout, code, blockquote, list items, preview, and at least one image block with a generated attachment.
- `long-blocks`
  - 4 paragraph blocks, 400 words each.
- `marked-long-block`
  - 600 words.
  - every 10th word starts a 1-3 word mark.
  - cycle through bold, italic, strikethrough, code, link, and annotation presentations.
  - include at least one `popover` annotation body.
- `large-table`
  - 5 rows x 7 cells.
- `sparse-table`
  - uneven row cell counts, including missing cells.
- `complex-table`
  - top-level table with nested tables inside some rows and cells.
- `deep-list-nesting`
  - depth 5 list nesting, with mixed ordered/unordered metadata.
- `many-blocks`
  - 200 blocks, 10 words each.

Additional useful fixtures:

- `mixed-table-and-text`
  - prose before and after a table to test table boundary navigation.
- `code-callouts-images`
  - code blocks, callouts, valid generated images, and one intentionally missing image.
- `empty-short-grapheme-blocks`
  - empty blocks, short blocks, emoji/grapheme text with marks.

Fixture helper functions:

- `words(count, seed)`
- `wordBlock(count, seed, type?)`
- `marksForEveryNthWord(content, every, markCycle)`
- `tableFixture(rowCount, columnCount)`
- `sparseTableFixture()`
- `nestedList(depth)`
- `canvasImageAttachment(id, label, colors)`

Image generation:

- Generate simple PNG data URLs using `HTMLCanvasElement` at fixture load time in the browser.
- Convert generated data URLs into `ImageAttachment` entries with `objectUrl`, `bytes`, `mimeType`, `width`, `height`, and `uploadStatus: 'local'`.
- Use fixed attachment ids in fixture documents so image blocks can refer to generated attachments.
- Include one image block with an attachment id that is not generated, to exercise the missing image renderer.

Tests:

- Fixture ids are unique.
- Every fixture document imports successfully.
- Every fixture export/import round-trips through `exportDocument` where supported.
- Required fixture size assertions:
  - long blocks: 4 root blocks, 400 words each.
  - marked long block: 600 words, expected mark/annotation count.
  - large table: 5 rows, 7 cells per row.
  - sparse table: at least one row with fewer cells than another.
  - complex table: nested `table` blocks exist.
  - deep list: nesting depth is 5.
  - many blocks: 200 root blocks.
- Attachment generation can be tested lightly with a browser/jsdom-compatible fallback. If canvas is awkward in unit tests, keep attachment tests focused on ids and metadata and manually verify rendered images.

## Phase 3: Add Replace-Document History Support

Files:

- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- related tests in `history.test.ts` or `App.test.tsx`

Add a first-class history action:

```ts
type HistoryAction =
    | ExistingActions
    | {
          type: 'replace-document';
          document: ImportDocument;
          fixtureId?: string;
      };
```

Implementation work:

- Add helper to create a `DemoState` from imported document state:
  - import fixture document with a deterministic context actor, likely `'left'` or `'fixture'`.
  - create both replicas from the same imported `CachedState`.
  - initialize both selections from the imported state.
  - keep both replicas online and queues empty.
- Update `replayHistory`:
  - starts from default demo.
  - when it encounters `replace-document`, replace the whole demo with the imported document.
  - subsequent local changes apply normally.
- Update `applyHistoryAction` and parsing/validation/export handling for `replace-document`.
- Since fixture replacement resets history, UI can set `history` to a one-action history:

```ts
{
    actions: [{type: 'replace-document', document: fixture.document(), fixtureId: fixture.id}],
    cursor: 1,
    keystrokes: [],
}
```

Selection handling:

- Use `initialRetainedSelectionSet(imported.state)` if it correctly points into the first editable block.
- If not, add a small helper that creates a retained caret at the first imported visible/editable block.

Tests:

- Replaying a `replace-document` action yields only the fixture blocks, not the default starter paragraph.
- Exported/imported history preserves a fixture-backed starting document.
- Local edits after a replace-document action replay correctly.
- Rewinding the history cursor to 0 returns the default empty/start state, and cursor 1 returns the fixture state.

## Phase 4: Wire the UI Dropdown

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

Add a top-level control near history controls:

```tsx
<select aria-label="Replace document from fixture" value="" onChange={...}>
    <option value="">Replace document...</option>
    {documentFixtures.map((fixture) => (
        <option key={fixture.id} value={fixture.id}>{fixture.label}</option>
    ))}
</select>
```

On fixture selection:

- If there is existing history, confirm replacement.
- Revoke old attachments.
- Generate fixture document and fixture attachments.
- Set attachments to the generated attachment store.
- Set history to a new one-action `replace-document` history.
- Clear transient selections, undo status, history status, and reset signal.
- Show status like `Loaded fixture: Large table.`
- Reset the `<select>` value to the placeholder after loading.

Style:

- Extend `.historyControls` grid to accommodate the select.
- Add top-level select styling matching existing buttons.
- Ensure mobile layout still wraps cleanly.

App tests:

- Dropdown is present with the expected accessible name.
- Selecting `simple-mixed-blocks` replaces the default document in both editors.
- Selecting a second fixture resets previous edits/history.
- Image fixture renders at least one generated image and one missing image.
- Popover annotation fixture renders an inline popover trigger/body behavior sufficiently to prove annotations imported.
- Large table fixture renders 5 x 7 table cells.
- Sparse table fixture renders without crashing and exposes missing-cell UI if the current code does that.

## Phase 5: Verification and Manual QA

Automated checks:

```sh
npm exec vitest -- run \
  examples/block-rich-text/src/documentFormat.test.ts \
  examples/block-rich-text/src/documentFixtures.test.ts \
  examples/block-rich-text/src/history.test.ts \
  examples/block-rich-text/src/App.test.tsx
```

Manual checks:

- Start the example with `npm run dev` from `examples/block-rich-text`.
- Load every fixture from the dropdown.
- Confirm both replicas show the same replacement document.
- Type in both editors after loading a fixture.
- Verify generated image blocks render and the missing image block shows the existing missing image UI.
- Verify popover annotations open/render correctly.
- Try basic table navigation/editing on large, sparse, and complex tables.
- Export history after selecting a fixture, re-import it, and confirm the fixture-backed document returns.

## Suggested Implementation Order

1. Add annotation support to `documentFormat` and tests.
2. Add generated fixture definitions and fixture validation tests.
3. Add `replace-document` history action and replay/import/export tests.
4. Add generated image attachment helpers.
5. Add the UI dropdown and styling.
6. Add App-level coverage for fixture replacement, images, annotations, and tables.
7. Run focused tests and do manual fixture QA.
