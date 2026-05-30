import type {RichTextJsonValue, RichTextRenderView} from '../peritext/types.js';
import type {TextRange} from './selection.js';

export function rangeHasMark(
    view: RichTextRenderView,
    range: TextRange,
    markType: string,
): boolean {
    if (range.start === range.end) return false;
    let offset = 0;
    let covered = 0;
    for (const span of view.spans) {
        const next = offset + span.text.length;
        const start = Math.max(range.start, offset);
        const end = Math.min(range.end, next);
        if (start < end) {
            covered += end - start;
            if (!span.marks || span.marks[markType] === undefined) return false;
        }
        offset = next;
    }
    return covered === range.end - range.start;
}

export function linkValueForRange(
    view: RichTextRenderView,
    range: TextRange,
): string | undefined {
    const value = markValueForRange(view, range, 'link');
    return typeof value === 'string' ? value : undefined;
}

export function markValueForRange(
    view: RichTextRenderView,
    range: TextRange,
    markType: string,
): RichTextJsonValue | undefined {
    if (!rangeHasMark(view, range, markType)) return undefined;
    let offset = 0;
    let found = false;
    let value: RichTextJsonValue | undefined;
    for (const span of view.spans) {
        const next = offset + span.text.length;
        const start = Math.max(range.start, offset);
        const end = Math.min(range.end, next);
        if (start < end) {
            const spanValue = span.marks?.[markType];
            if (!found) {
                value = spanValue;
                found = true;
            } else if (JSON.stringify(value) !== JSON.stringify(spanValue)) {
                return undefined;
            }
        }
        offset = next;
    }
    return value;
}
