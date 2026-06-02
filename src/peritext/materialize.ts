import {marksForOperations, opSetForChar} from './marks.js';
import {plainText} from './sequence.js';
import type {RichTextJsonValue, RichTextRenderView, RichTextSpan, RichTextState} from './types.js';

export function materializeRichTextState(state: RichTextState): RichTextRenderView {
    const text = plainText(state);
    const spans: RichTextSpan[] = [];
    for (let i = 0; i < state.chars.length; i++) {
        const char = state.chars[i];
        if (!char || char.deleted) continue;
        const marks = marksForOperations(opSetForChar(state.chars, i));
        const previous = spans.at(-1);
        if (previous && equalMarks(previous.marks, marks)) {
            previous.text += char.char;
        } else {
            spans.push(marks ? {text: char.char, marks} : {text: char.char});
        }
    }
    return {
        plainText: text,
        spans,
    };
}

function equalMarks(
    a: Record<string, RichTextJsonValue> | undefined,
    b: Record<string, RichTextJsonValue> | undefined,
) {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
