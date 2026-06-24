# Research: Recipe Ingredient Line Highlighting

## Goal

Add a new block type to `examples/block-rich-text` called `recipe ingredient line`.

For blocks of this type, the visible text content should be highlighted with the provided ingredient regex:

- `amount`: bold
- `unit`: bold
- `ingredient`: green
- `prep`: italic

This should be a custom highlighter for the block's text content, not persisted inline marks. The underlying CRDT text and marks should remain unchanged when the regex matches or stops matching.

## Current Architecture

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/syntaxHighlight.test.ts`
- `examples/block-rich-text/src/clipboard.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`

Block type state lives in `RichBlockMeta` in `blockMeta.ts`. Current block types include paragraph, headings, list items, todo, blockquote, code, callout, table, image, and preview. Metadata is persisted through block meta ops, so adding a block type means extending this union and every exhaustive `switch` over it.

The editor UI converts selected blocks through `setBlockTypeEverywhere(...)`, which calls `blockTypeMeta(...)` in `App.tsx`. The toolbar and slash menu both use `BlockTypeMenuValue`, so the new block type needs to be added in both places:

- `BlockTypeMenuValue`
- `SLASH_COMMANDS`
- toolbar `<select aria-label="Block type">`
- `blockTypeMeta(...)`
- `blockTypeMenuValue(...)`

Rendering for editable block text flows through `EditableBlock` and `RichTextEditableSurface` in `App.tsx`. `EditableBlock` computes code block syntax tokens with:

```ts
const syntaxTokens = useMemo(
    () => (isCodeBlock ? highlightCode(codeText, codeLanguage) : undefined),
    [codeLanguage, codeText, isCodeBlock],
);
```

`RichTextEditableSurface` then renders DOM spans through:

- `serializeRuns(...)`
- `renderRunNodes(...)`
- `runRenderChunks(...)`
- `renderRunChunkNode(...)`
- `applyRunClasses(...)`

This pipeline already splits text at syntax token, inline embed, caret, and retained-selection boundaries. That is the best integration point for ingredient highlighting.

## Existing Highlighting Model

Code block syntax highlighting is already a derived render-only layer:

- `examples/block-rich-text/src/syntaxHighlight.ts` returns `{text, className}` tokens.
- `runRenderChunks(...)` converts those tokens into absolute offset ranges.
- `applyRunClasses(...)` attaches classes like `syntax-string`.
- `style.css` defines the colors.

Inline code syntax highlighting is also derived from inline code marks in `inlineCodeSyntaxRanges(...)`, then merged into the same syntax range list.

Ingredient highlighting should follow the same broad pattern, but the names should probably be generalized because this is not syntax highlighting:

- keep `highlightCode(...)` as-is for code blocks
- add a new ingredient highlighter helper, for example `ingredientHighlight.ts`
- return token/range data with classes like `ingredientAmount`, `ingredientUnit`, `ingredientName`, `ingredientPrep`
- include those ranges in the chunk boundary calculation next to syntax ranges
- include the ingredient token/range data in `serializeRuns(...)` so DOM rendering does not get cached with stale highlight spans

## Recommended Implementation Shape

Add metadata:

```ts
| {type: 'recipe_ingredient'; ts: HLC}
```

Use an internal snake_case type to match existing metadata style (`list_item`). The user-facing label can be `Recipe ingredient line`.

Update `sameTypeWithTs(...)` in `blockMeta.ts` to preserve the new type on timestamp changes.

Add the block type to `App.tsx`:

- `BlockTypeMenuValue`: likely `'recipe-ingredient'`
- `SLASH_COMMANDS`: label `Recipe ingredient`, keywords such as `recipe`, `ingredient`, `food`
- toolbar select option
- `blockTypeMeta(...)`: return `{type: 'recipe_ingredient', ts}`
- `blockTypeMenuValue(...)`: map back to `'recipe-ingredient'`
- editable block class list: add something like `meta.type === 'recipe_ingredient' ? 'recipeIngredientBlock' : ''` if block-level styling is desired

Add a helper for derived ingredient ranges. A clean API would be:

```ts
export type IngredientToken = {
    startOffset: number;
    endOffset: number;
    className: 'ingredient-amount' | 'ingredient-unit' | 'ingredient-name' | 'ingredient-prep';
};

export const highlightIngredientLine = (text: string): IngredientToken[] => { ... };
```

The helper should:

- run the provided regex against the whole block text
- use named capture groups
- convert JS string indices to editor segment offsets using `segmentText(...)`, because the editor offsets are grapheme/segment based
- skip empty optional groups, especially `unit` and `prep`
- produce no tokens when the line does not match

Important: `RegExpMatchArray.indices.groups` would make group ranges much easier, but it requires the `d` flag and may need TypeScript/lib support. A safer implementation can compute group ranges from the match text, but duplicate substrings make naive `indexOf` fragile. If we can use `d`, prefer it and update tests accordingly. If not, the regex should be decomposed or matched with anchored sub-regexes to avoid ambiguous group offsets.

Integrate rendering:

- In `EditableBlock`, compute `ingredientTokens` only when `meta.type === 'recipe_ingredient'`.
- Pass those tokens to `RichTextEditableSurface`.
- Include them in `serializeRuns(...)`.
- Add their boundaries in `runRenderChunks(...)`.
- Add a class field to `RunRenderChunk` that can carry both syntax and ingredient classes, or introduce a generic `decoratorClassNames: string[]`.
- In `applyRunClasses(...)`, apply ingredient classes in addition to existing inline mark, annotation, link, code, embed, and syntax classes.

CSS should define the visual treatment:

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

The exact class names should follow whatever naming is chosen in the renderer. `ingredient-name` is probably clearer than `ingredient-ingredient`.

## Composition With Existing Marks

Ingredient highlighting should compose with existing inline marks:

- If amount text already has italic, it should render bold and italic.
- If ingredient text is a link or annotation, link/annotation behavior should still work.
- If prep text has bold, it should render bold and italic.
- Ingredient highlighting should not write `bold` or `italic` CRDT marks.

This means the highlighter should affect render classes only. It should not call `markRangeOp(...)` and should not modify `block.runs`.

## Clipboard Considerations

Clipboard serialization currently preserves `fragment.meta` and emits `data-umkehr-block-type="${fragment.meta.type}"`.

For a recipe ingredient block, the fallback HTML will naturally be a `<p data-umkehr-block-type="recipe_ingredient">...</p>` unless `htmlTagForMeta(...)` gets a special case. That is probably sufficient for preserving the block type inside this editor's embedded JSON clipboard payload.

Open product decision: should copied HTML shown in external apps include the generated bold/green/italic ingredient presentation? Current code block syntax highlighting is not serialized into fallback HTML, so the consistent default is no: preserve the block type and text, but not derived highlighting.

## Tests To Add

Unit test the new highlighter helper:

- parses `1 cup flour`
- parses fractional amounts such as `1 1/2 cups flour`
- parses Unicode fractions such as `½ tsp salt`
- parses ranges such as `1-2 tbsp olive oil`
- parses prep after comma, for example `2 cloves garlic, minced`
- returns no tokens for non-matching text
- handles optional unit

Rendering test in `App.test.tsx`:

- convert a block to recipe ingredient line
- type or paste `1 cup flour, sifted`
- assert the block text is unchanged
- assert spans/classes exist for amount, unit, ingredient, and prep
- assert applying existing bold/italic inline marks still composes with the derived classes

Block type tests:

- `multiSelectionCommands.test.ts` or `App.test.tsx`: toolbar conversion stores `{type: 'recipe_ingredient', ts: ...}`
- slash menu conversion stores the same metadata
- `blockTypeMenuValue(...)` causes the toolbar select to show `Recipe ingredient line`

Clipboard tests:

- selected recipe ingredient blocks preserve `meta: {type: 'recipe_ingredient', ts: ...}` in fragments
- fallback HTML includes `data-umkehr-block-type="recipe_ingredient"`

Existing tests likely affected by exhaustiveness:

- `history.test.ts`
- `undoHistory.test.ts`
- `clipboard.test.ts`
- TypeScript compile checks around `RichBlockMeta` switches

## Open Questions

1. What should the persisted internal type name be: `recipe_ingredient`, `ingredient_line`, or exactly `'recipe ingredient line'`? Existing code strongly suggests a machine-friendly value like `recipe_ingredient`.
    - recipe_ingredient sounds good
2. Should the toolbar label be `Recipe ingredient line` or a shorter `Ingredient line`?
    - ingredient line
3. Should slash command text be `/ingredient`, `/recipe`, or both via keywords?
    - ingredient
4. Should unmatched recipe ingredient blocks look identical to paragraphs, or should the whole block have a subtle recipe-specific style even when the regex does not match?
    - let's have a little list icon of some vegetable or something to the left
5. Should external clipboard HTML include the generated bold/green/italic styling, or only preserve the block type in the editor-specific payload?
    - yeah let's keep it
6. Should the highlighter treat the `unit` group as bold only when present, and should the whitespace between amount and unit stay unbolded? The task says bolds the amount and unit, so the whitespace should likely remain normal.
    - only when present, whitespace normal
7. Should the ingredient color apply only to the `ingredient` capture text, or also to surrounding whitespace before prep punctuation? The natural interpretation is only the captured `ingredient` text.
    - only the captured text
8. The provided regex uses named groups but not match indices. Is it acceptable to add the `d` flag and rely on `match.indices.groups`, or should implementation avoid that for compatibility with the current TypeScript/browser target?
    - use your judgement

## Risk Notes

The main implementation risk is mapping regex capture ranges to the editor's offset model. The editor renders and selects text by `segmentText(...)`, not raw UTF-16 indices. This matters for Unicode fractions and any future multi-codepoint graphemes. The highlighter should convert ranges carefully and have tests with Unicode fraction characters.

The second risk is stale DOM caching in `RichTextEditableSurface`. Any new derived token list must be included in `serializeRuns(...)` and the layout effect dependencies. Otherwise changing a block from paragraph to recipe ingredient, or editing text so the regex starts/stops matching, can leave old spans in place.

The third risk is class composition. The current render chunk has a single `syntaxClassName`. Ingredient highlighting may need to coexist with syntax classes for inline code marks, so adding a generic list of decoration classes is cleaner than replacing the existing syntax class with an ingredient class.
