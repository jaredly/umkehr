export type TextEdit = {
    delete?: {start: number; end: number};
    insert?: {index: number; text: string};
};

export function diffPlainText(before: string, after: string): TextEdit | null {
    if (before === after) return null;

    let prefix = 0;
    while (
        prefix < before.length &&
        prefix < after.length &&
        before[prefix] === after[prefix]
    ) {
        prefix++;
    }

    let beforeSuffix = before.length;
    let afterSuffix = after.length;
    while (
        beforeSuffix > prefix &&
        afterSuffix > prefix &&
        before[beforeSuffix - 1] === after[afterSuffix - 1]
    ) {
        beforeSuffix--;
        afterSuffix--;
    }

    const removed = before.slice(prefix, beforeSuffix);
    const inserted = after.slice(prefix, afterSuffix);
    return {
        ...(removed ? {delete: {start: prefix, end: beforeSuffix}} : {}),
        ...(inserted ? {insert: {index: prefix, text: inserted}} : {}),
    };
}
