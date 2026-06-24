examples/block-rich-text: I want to add a new block type called 'recipe ingredient line'. This block type applies a custom highlighter to the text content of the block.
It uses this regex:
```ts
const ingredientRe = /^\s*(?<amount>(?:(?:\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?(?:\s+\d+\/\d+)?)|(?:\d+\/\d+)|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*[-–]\s*(?:(?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?)|(?:\d+\/\d+)|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))?)\s*(?<unit>cups?|c\.?|tbsp\.?|tablespoons?|tbs\.?|tsp\.?|teaspoons?|oz\.?|ounces?|fl\s*oz\.?|fluid\s+ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|pinch(?:es)?|dash(?:es)?|cloves?|sprigs?|stalks?|slices?|cans?|packages?|pkg\.?)?\s+(?<ingredient>.*?)\s*(?:[,;]\s*(?<prep>(?:chopped|diced|minced|sliced|crushed|grated|shredded|peeled|seeded|cored|trimmed|melted|softened|beaten|divided|drained|rinsed|packed|loosely\s+packed|room\s+temperature|to\s+taste)(?:\s+.*)?))?\s*$/i;
```
and then bolds the "amount" and "unit", colors the "ingredient" green, and italicises any "prep".
