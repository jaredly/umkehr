import type {tags} from 'typia';
import {crdtPathForExisting, getMetaAtPath} from '../crdt/path.js';
import {emptyRichTextState, materializeRichTextState, richTextSnapshotFromPlainText} from '../peritext/index.js';
import type {CrdtDocument} from '../crdt/types.js';
import type {
    RichTextImportSnapshot,
    RichTextRenderView,
    RichTextState,
    RichTextSpan,
} from '../peritext/types.js';
import type {Path} from '../types.js';

declare const richTextBrand: unique symbol;

export type RichCollaborativeText = {
    kind: 'rich-text';
    version: 1;
    chars: RichTextState['chars'];
    pending?: RichTextState['pending'];
} & tags.JsonSchemaPlugin<{
    'x-umkehr-crdt': 'rich-text';
    'x-umkehr-rich-text-version': 1;
}> & {
        readonly [richTextBrand]?: never;
    };

export type {RichTextImportSnapshot, RichTextRenderView, RichTextSpan};

export function richText(): RichCollaborativeText {
    return {kind: 'rich-text', version: 1, ...emptyRichTextState()} as RichCollaborativeText;
}

export function richTextFromPlainText(text: string): RichTextImportSnapshot {
    return richTextSnapshotFromPlainText(text);
}

export function richTextFromSpans(spans: RichTextSpan[]): RichTextImportSnapshot {
    return {spans: spans.map((span) => ({...span, marks: span.marks ? {...span.marks} : undefined}))};
}

export function materializeRichText<T>(doc: CrdtDocument<T>, path: Path): RichTextRenderView {
    const crdtPath = crdtPathForExisting(doc, path);
    const meta = getMetaAtPath(doc.meta, crdtPath);
    if (!meta || (meta as {kind?: string}).kind !== 'richText') {
        throw new Error('Cannot materialize rich text: path does not point to a rich-text field.');
    }
    const value = getValueAtPath(doc.state, path);
    if (!isRichTextState(value)) {
        throw new Error('Cannot materialize rich text: state value is not rich-text data.');
    }
    return materializeRichTextState(value);
}

export function richTextToPlainText(view: RichTextRenderView) {
    return view.plainText;
}

function getValueAtPath(root: unknown, path: Path) {
    let current = root;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[segment.key];
    }
    return current;
}

function isRichTextState(value: unknown): value is RichTextState {
    return Boolean(
        value &&
            typeof value === 'object' &&
            Array.isArray((value as {chars?: unknown}).chars),
    );
}
