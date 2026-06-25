# Plan: Recipe Ingredient Line Highlighting

## Decisions

- Persist the block type as `recipe_ingredient`.
- Show the user-facing toolbar label as `Ingredient line`.
- Add a slash command labeled `Ingredient`, searchable with ingredient/recipe-related keywords.
- Show a small produce-style icon in the block affordance area for ingredient line blocks.
- Apply generated ingredient styling only to exact named capture text:
  - `amount`: bold
  - `unit`: bold when present
  - whitespace between amount and unit: normal
  - `ingredient`: green
  - `prep`: italic
- Preserve generated styling in external clipboard HTML in addition to preserving the editor-specific block metadata payload.

## Phase 1: Add The Block Type

Update `examples/block-rich-text/src/blockMeta.ts`.

- Add `{type: 'recipe_ingredient'; ts: HLC}` to `RichBlockMeta`.
- Update `sameTypeWithTs(...)` with a `recipe_ingredient` case.
- Confirm helper behavior:
  - `isEditableBlock(...)` can remain true.
  - `isWholeSubtreeStyledBlock(...)` should remain false.
  - `isCellBlock(...)` needs no special case unless implementation reveals a table-specific conflict.

Update `examples/block-rich-text/src/App.tsx`.

- Add `'recipe-ingredient'` to `BlockTypeMenuValue`.
- Add the toolbar option: `Ingredient line`.
- Add `SLASH_COMMANDS` entry:
  - value: `'recipe-ingredient'`
  - label: `Ingredient`
  - group: `Block type`
  - keywords: `ingredient`, `recipe`, `food`, `line`
- Update `blockTypeMeta(...)` to return `{type: 'recipe_ingredient', ts}`.
- Update `blockTypeMenuValue(...)` to map `recipe_ingredient` to `'recipe-ingredient'`.

## Phase 2: Build The Ingredient Highlighter

Add a new helper file, likely `examples/block-rich-text/src/ingredientHighlight.ts`.

Responsibilities:

- Store the provided regex in one place.
- Export a token/range type, for example:

```ts
export type IngredientHighlightToken = {
    startOffset: number;
    endOffset: number;
    className: 'ingredient-amount' | 'ingredient-unit' | 'ingredient-name' | 'ingredient-prep';
};
```

- Export `highlightIngredientLine(text: string): IngredientHighlightToken[]`.
- Return no tokens for non-matching text.
- Return no token for optional groups that are absent.
- Convert regex capture positions into editor offsets compatible with `segmentText(...)`.

Implementation note:

- Prefer using the regex `d` flag and `match.indices.groups` if TypeScript and the test/runtime target support it cleanly.
- If that causes compatibility friction, avoid naive `indexOf` over captured text because repeated substrings can produce wrong ranges. In that case, split the regex into smaller anchored parsing pieces or add a deterministic capture locator with tests for repeated text.

Add `examples/block-rich-text/src/ingredientHighlight.test.ts`.

Cover at least:

- `1 cup flour`
- `1 1/2 cups flour`
- `½ tsp salt`
- `1-2 tbsp olive oil`
- `2 cloves garlic, minced`
- a no-unit line that still matches
- a non-matching line that returns `[]`
- a repeated-substring case to protect capture range calculation

## Phase 3: Integrate Render-Only Highlighting

Update `EditableBlock` in `App.tsx`.

- Compute the full block text from `block.runs`.
- When `meta.type === 'recipe_ingredient'`, compute `ingredientTokens` with `highlightIngredientLine(...)`.
- Pass `ingredientTokens` into `RichTextEditableSurface`.

Update `RichTextEditableSurface` and render helpers in `App.tsx`.

- Add an optional `ingredientTokens` prop.
- Include `ingredientTokens` in `serializeRuns(...)`.
- Include `ingredientTokens` in the layout effect dependency list.
- Pass `ingredientTokens` to every `renderRunNodes(...)` call, including focus and input rerender paths.
- Update `runRenderChunks(...)` so ingredient token boundaries split chunks the same way syntax token boundaries do.
- Change `RunRenderChunk` from a single `syntaxClassName` model to a class-list model, or add a parallel ingredient class field. Prefer a generic `decoratorClassNames: string[]` if it keeps syntax and ingredient styling composable.
- Update `applyRunClasses(...)` so ingredient classes compose with existing:
  - inline marks
  - links
  - annotations
  - inline embeds
  - retained selection highlights
  - code syntax classes

Important behavior:

- Do not write CRDT marks for amount/unit/prep.
- Do not mutate `block.runs`.
- Existing user-applied inline marks must still render alongside generated ingredient classes.

## Phase 4: Add Styling And Affordance

Update `examples/block-rich-text/src/style.css`.

- Add ingredient token styles:

```css
.ingredient-amount,
.ingredient-unit {
    font-weight: 700;
}

.ingredient-name {
    color: #1e7f4f;
}

.ingredient-prep {
    font-style: italic;
}
```

- Add any needed `.recipeIngredientBlock` or `.blockType-recipe_ingredient` styles.

Update `BlockAffordance` in `App.tsx`.

- Add a `recipe_ingredient` case before the default drag handle.
- Render a drag affordance button with a small produce-style symbol/icon and `aria-label="Move block"`.
- Keep the same drag behavior as other non-toggle block affordances.

Note: keep this lightweight and consistent with the current app, which mostly uses text controls rather than an icon library.

## Phase 5: Preserve Highlighting In Clipboard HTML

Update `examples/block-rich-text/src/clipboard.ts`.

- Preserve `fragment.meta.type === 'recipe_ingredient'` in the embedded payload as usual.
- Keep fallback block tag as `<p>` unless a later design reason appears.
- Update HTML fallback generation so ingredient line fragments include the generated amount/unit/ingredient/prep styling.

Suggested approach:

- Reuse `highlightIngredientLine(fragment.text)`.
- Split clipboard text by generated ingredient token boundaries and existing mark boundaries.
- For each slice, apply existing inline mark wrappers and the ingredient fallback wrappers.
- Ingredient fallback wrappers can be semantic where possible:
  - amount/unit: `<strong>`
  - prep: `<em>`
  - ingredient: `<span style="color: #1e7f4f">`
- Ensure whitespace outside captures remains outside the generated wrappers.

Risk:

- Clipboard HTML already wraps inline marks in `wrapHtmlText(...)`. Avoid duplicating or reordering wrappers in a way that breaks links/annotations. A focused helper for recipe ingredient fallback slices is safer than making all clipboard serialization generic in one pass.

## Phase 6: Tests And Verification

Add or update tests.

Highlighter unit tests:

- `examples/block-rich-text/src/ingredientHighlight.test.ts`

Rendering/UI tests:

- In `App.test.tsx`, verify toolbar conversion to `Ingredient line`.
- Verify rendered class spans for `1 cup flour, sifted`.
- Verify the block's text content remains unchanged.
- Verify existing inline marks compose with generated classes.
- Verify editing a line from matching to non-matching clears generated classes.
- Verify slash command `Ingredient` converts the current block.

Clipboard tests:

- In `clipboard.test.ts`, verify fragment metadata:
  - `{type: 'recipe_ingredient', ts: ...}`
- Verify fallback HTML includes:
  - `data-umkehr-block-type="recipe_ingredient"`
  - `<strong>` around amount and unit text only
  - green span around ingredient capture text only
  - `<em>` around prep capture text only

Regression checks:

- Run the block rich text test suite, or at minimum:
  - `ingredientHighlight.test.ts`
  - `syntaxHighlight.test.ts`
  - `App.test.tsx`
  - `clipboard.test.ts`
  - `multiSelectionCommands.test.ts`
  - `history.test.ts`
  - `undoHistory.test.ts`
- Run TypeScript/build checks for `examples/block-rich-text` if available.

## Implementation Order

1. Add metadata and UI block type mapping.
2. Add the highlighter helper and unit tests.
3. Wire render-only ingredient tokens into `EditableBlock` and `RichTextEditableSurface`.
4. Add CSS and the ingredient block affordance icon.
5. Update clipboard fallback HTML.
6. Add UI/clipboard regression tests.
7. Run targeted tests and fix exhaustiveness or stale render cache issues.

## Acceptance Criteria

- A user can choose `Ingredient line` from the toolbar.
- A user can type `/ingredient` and convert the current block.
- The block stores `meta.type === 'recipe_ingredient'`.
- Matching ingredient lines render amount and unit bold, ingredient green, and prep italic.
- Unmatched ingredient lines do not show stale generated highlights.
- Generated highlights compose with existing inline marks and links.
- Generated highlights are render-only and do not create CRDT marks.
- External clipboard HTML preserves the generated bold/green/italic presentation.
- Editor clipboard payload preserves the `recipe_ingredient` block type.
