import {segmentText} from './selectionModel';

export type IngredientHighlightClassName =
    | 'ingredient-amount'
    | 'ingredient-unit'
    | 'ingredient-name'
    | 'ingredient-prep';

export type IngredientHighlightToken = {
    startOffset: number;
    endOffset: number;
    className: IngredientHighlightClassName;
};

const ingredientRe =
    /^\s*(?<amount>(?:(?:\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?(?:\s+\d+\/\d+)?)|(?:\d+\/\d+)|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*[-–]\s*(?:(?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?)|(?:\d+\/\d+)|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))?)\s*(?<unit>cups?|c\.?|tbsp\.?|tablespoons?|tbs\.?|tsp\.?|teaspoons?|oz\.?|ounces?|fl\s*oz\.?|fluid\s+ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|pinch(?:es)?|dash(?:es)?|cloves?|sprigs?|stalks?|slices?|cans?|packages?|pkg\.?)?\s+(?<ingredient>.*?)\s*(?:[,;]\s*(?<prep>(?:chopped|diced|minced|sliced|crushed|grated|shredded|peeled|seeded|cored|trimmed|melted|softened|beaten|divided|drained|rinsed|packed|loosely\s+packed|room\s+temperature|to\s+taste)(?:\s+.*)?))?\s*$/i;

export const highlightIngredientLine = (text: string): IngredientHighlightToken[] => {
    const match = ingredientRe.exec(text);
    if (!match?.groups) return [];

    const groups: Array<{name: keyof typeof match.groups; className: IngredientHighlightClassName}> = [
        {name: 'amount', className: 'ingredient-amount'},
        {name: 'unit', className: 'ingredient-unit'},
        {name: 'ingredient', className: 'ingredient-name'},
        {name: 'prep', className: 'ingredient-prep'},
    ];
    const tokens: IngredientHighlightToken[] = [];
    let searchStart = 0;

    for (const {name, className} of groups) {
        const value = match.groups[name];
        if (!value) continue;
        const startIndex = text.indexOf(value, searchStart);
        if (startIndex < 0) return [];
        const endIndex = startIndex + value.length;
        tokens.push({
            startOffset: stringIndexToSegmentOffset(text, startIndex),
            endOffset: stringIndexToSegmentOffset(text, endIndex),
            className,
        });
        searchStart = endIndex;
    }

    return tokens.filter((token) => token.startOffset < token.endOffset);
};

const stringIndexToSegmentOffset = (text: string, index: number): number =>
    segmentText(text.slice(0, index)).length;
