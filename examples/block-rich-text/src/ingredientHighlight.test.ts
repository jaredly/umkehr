import {describe, expect, it} from 'vitest';
import {highlightIngredientLine} from './ingredientHighlight';

describe('ingredient highlighting', () => {
    it('highlights amount, unit, and ingredient', () => {
        expect(highlightIngredientLine('1 cup flour')).toEqual([
            {startOffset: 0, endOffset: 1, className: 'ingredient-amount'},
            {startOffset: 2, endOffset: 5, className: 'ingredient-unit'},
            {startOffset: 6, endOffset: 11, className: 'ingredient-name'},
        ]);
    });

    it('highlights mixed fractions', () => {
        expect(highlightIngredientLine('1 1/2 cups flour')).toEqual([
            {startOffset: 0, endOffset: 5, className: 'ingredient-amount'},
            {startOffset: 6, endOffset: 10, className: 'ingredient-unit'},
            {startOffset: 11, endOffset: 16, className: 'ingredient-name'},
        ]);
    });

    it('highlights unicode fractions', () => {
        expect(highlightIngredientLine('½ tsp salt')).toEqual([
            {startOffset: 0, endOffset: 1, className: 'ingredient-amount'},
            {startOffset: 2, endOffset: 5, className: 'ingredient-unit'},
            {startOffset: 6, endOffset: 10, className: 'ingredient-name'},
        ]);
    });

    it('highlights amount ranges', () => {
        expect(highlightIngredientLine('1-2 tbsp olive oil')).toEqual([
            {startOffset: 0, endOffset: 3, className: 'ingredient-amount'},
            {startOffset: 4, endOffset: 8, className: 'ingredient-unit'},
            {startOffset: 9, endOffset: 18, className: 'ingredient-name'},
        ]);
    });

    it('highlights prep after punctuation', () => {
        expect(highlightIngredientLine('2 cloves garlic, minced')).toEqual([
            {startOffset: 0, endOffset: 1, className: 'ingredient-amount'},
            {startOffset: 2, endOffset: 8, className: 'ingredient-unit'},
            {startOffset: 9, endOffset: 15, className: 'ingredient-name'},
            {startOffset: 17, endOffset: 23, className: 'ingredient-prep'},
        ]);
    });

    it('supports ingredient lines without a unit', () => {
        expect(highlightIngredientLine('2 eggs')).toEqual([
            {startOffset: 0, endOffset: 1, className: 'ingredient-amount'},
            {startOffset: 2, endOffset: 6, className: 'ingredient-name'},
        ]);
    });

    it('does not highlight non-matching text', () => {
        expect(highlightIngredientLine('salt to taste')).toEqual([]);
    });

    it('keeps repeated group text in the correct position', () => {
        expect(highlightIngredientLine('1 cup cup, chopped')).toEqual([
            {startOffset: 0, endOffset: 1, className: 'ingredient-amount'},
            {startOffset: 2, endOffset: 5, className: 'ingredient-unit'},
            {startOffset: 6, endOffset: 9, className: 'ingredient-name'},
            {startOffset: 11, endOffset: 18, className: 'ingredient-prep'},
        ]);
    });
});
