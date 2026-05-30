import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {RichTextBinding} from '../react-crdt/react-crdt.js';
import type {RichTextImportSnapshot} from '../richtext/index.js';
import {diffPlainText, type TextEdit} from './diff.js';
import {rangeHasMark} from './marks.js';
import {RichTextSpanView} from './render.js';
import {
    restoreSelection,
    selectionInside,
    selectionRangeIn,
    type TextRange,
} from './selection.js';
import {SelectionToolbar, type ToolbarState} from './toolbar.js';

type RichTextEditorProps = RichTextBinding & {
    ariaLabel?: string;
    promptForLink?: (currentUrl: string | undefined) => string | null;
};

export function RichTextEditor({
    view,
    commands,
    ariaLabel = 'Rich text editor',
    promptForLink,
}: RichTextEditorProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const pendingSelection = useRef<TextRange | null>(null);
    const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const range = pendingSelection.current;
        if (!root || !range) return;
        pendingSelection.current = null;
        restoreSelection(root, clampRange(range, view.plainText.length));
    }, [view.plainText]);

    const applyEdit = (edit: TextEdit, restoreTo: TextRange) => {
        if (edit.delete && edit.delete.start !== edit.delete.end) {
            commands.delete(edit.delete.start, edit.delete.end);
        }
        if (edit.insert && edit.insert.text) {
            commands.insert(edit.insert.index, edit.insert.text);
        }
        pendingSelection.current = restoreTo;
    };

    const replaceSelectionWithText = (range: TextRange, text: string) => {
        applyEdit(
            {
                ...(range.start !== range.end ? {delete: range} : {}),
                ...(text ? {insert: {index: range.start, text}} : {}),
            },
            {start: range.start + text.length, end: range.start + text.length},
        );
    };

    const applySnapshotAtSelection = (range: TextRange, snapshot: RichTextImportSnapshot) => {
        const text = snapshot.spans.map((span) => span.text).join('');
        replaceSelectionWithText(range, text);
        let offset = range.start;
        for (const span of snapshot.spans) {
            const end = offset + span.text.length;
            if (span.marks && offset !== end) {
                for (const [markType, value] of Object.entries(span.marks)) {
                    const preset = markType === 'link' ? 'exclusive' : 'inclusive';
                    commands.mark(offset, end, markType, value, preset);
                }
            }
            offset = end;
        }
    };

    const updateToolbar = () => {
        const root = rootRef.current;
        if (!root || !selectionInside(root)) {
            setToolbar(null);
            return;
        }
        const range = selectionRangeIn(root);
        const selection = root.ownerDocument.defaultView?.getSelection();
        if (!range || range.start === range.end || !selection || selection.rangeCount === 0) {
            setToolbar(null);
            return;
        }
        const selectedRange = selection.getRangeAt(0);
        const rect =
            'getBoundingClientRect' in selectedRange
                ? selectedRange.getBoundingClientRect()
                : {top: 0, left: 0, width: 0, height: 0};
        setToolbar({
            range,
            rect: {top: rect.top, left: rect.left, width: rect.width, height: rect.height},
        });
    };

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const doc = root.ownerDocument;
        doc.addEventListener('selectionchange', updateToolbar);
        return () => doc.removeEventListener('selectionchange', updateToolbar);
    });

    const toggleMark = (markType: string, value: boolean | string = true) => {
        const root = rootRef.current;
        if (!root) return;
        const range = selectionRangeIn(root);
        if (!range || range.start === range.end) return;
        const preset = markType === 'link' ? 'exclusive' : 'inclusive';
        if (rangeHasMark(view, range, markType)) {
            commands.unmark(range.start, range.end, markType, preset);
        } else {
            commands.mark(range.start, range.end, markType, value, preset);
        }
        pendingSelection.current = range;
        setToolbar((current) => (current ? {...current, range} : current));
    };

    const toggleLink = () => {
        const root = rootRef.current;
        if (!root) return;
        const range = selectionRangeIn(root);
        if (!range || range.start === range.end) return;
        if (rangeHasMark(view, range, 'link')) {
            toggleMark('link');
            return;
        }
        const current = undefined;
        const next = (promptForLink ?? defaultPromptForLink)(current)?.trim();
        if (!next) return;
        toggleMark('link', next);
    };

    return (
        <>
            <div
                ref={rootRef}
                aria-label={ariaLabel}
                contentEditable
                role="textbox"
                suppressContentEditableWarning
                onMouseUp={updateToolbar}
                onKeyUp={updateToolbar}
                onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
                    const key = event.key.toLowerCase();
                    if (key === 'b') {
                        event.preventDefault();
                        toggleMark('strong');
                    } else if (key === 'i') {
                        event.preventDefault();
                        toggleMark('em');
                    }
                }}
                onBeforeInput={(event) => {
                const root = rootRef.current;
                if (!root) return;
                const range = selectionRangeIn(root);
                if (!range) return;
                const native = event.nativeEvent as InputEvent;
                switch (native.inputType) {
                    case 'insertText':
                    case 'insertCompositionText': {
                        if (!native.data) return;
                        event.preventDefault();
                        replaceSelectionWithText(range, native.data);
                        return;
                    }
                    case 'deleteContentBackward': {
                        const next =
                            range.start === range.end
                                ? {start: Math.max(0, range.start - 1), end: range.start}
                                : range;
                        if (next.start === next.end) return;
                        event.preventDefault();
                        applyEdit({delete: next}, {start: next.start, end: next.start});
                        return;
                    }
                    case 'deleteContentForward': {
                        const next =
                            range.start === range.end
                                ? {start: range.start, end: Math.min(view.plainText.length, range.end + 1)}
                                : range;
                        if (next.start === next.end) return;
                        event.preventDefault();
                        applyEdit({delete: next}, {start: next.start, end: next.start});
                        return;
                    }
                }
                }}
                onPaste={(event) => {
                const root = rootRef.current;
                if (!root) return;
                const range = selectionRangeIn(root);
                if (!range) return;
                const html = event.clipboardData.getData('text/html');
                const text = event.clipboardData.getData('text/plain');
                event.preventDefault();
                if (html) {
                    applySnapshotAtSelection(range, richTextSnapshotFromHtml(root.ownerDocument, html));
                } else if (text) {
                    replaceSelectionWithText(range, text);
                }
                }}
                onInput={(event) => {
                const after = event.currentTarget.textContent ?? '';
                const edit = diffPlainText(view.plainText, after);
                if (!edit) return;
                const caret = edit.insert
                    ? edit.insert.index + edit.insert.text.length
                    : (edit.delete?.start ?? after.length);
                event.currentTarget.textContent = view.plainText;
                applyEdit(edit, {start: caret, end: caret});
                }}
            >
                {view.spans.map((span, index) => (
                    <RichTextSpanView key={index} span={span} />
                ))}
            </div>
            {toolbar ? (
                <SelectionToolbar
                    state={toolbar}
                    view={view}
                    onToggleMark={toggleMark}
                    onToggleLink={toggleLink}
                />
            ) : null}
        </>
    );
}

function defaultPromptForLink(currentUrl: string | undefined) {
    return window.prompt('Link URL', currentUrl ?? '');
}

function clampRange(range: TextRange, length: number): TextRange {
    return {
        start: Math.max(0, Math.min(range.start, length)),
        end: Math.max(0, Math.min(range.end, length)),
    };
}

export function richTextSnapshotFromHtml(document: Document, html: string): RichTextImportSnapshot {
    const template = document.createElement('template');
    template.innerHTML = html;
    const spans: RichTextImportSnapshot['spans'] = [];
    appendNodeSpans(template.content, {}, spans);
    return {spans: mergeAdjacentSpans(spans).filter((span) => span.text)};
}

function appendNodeSpans(
    node: Node,
    inheritedMarks: NonNullable<RichTextImportSnapshot['spans'][number]['marks']>,
    spans: RichTextImportSnapshot['spans'],
) {
    if (node.nodeType === node.TEXT_NODE) {
        const text = node.textContent ?? '';
        if (text) spans.push({text, marks: Object.keys(inheritedMarks).length ? {...inheritedMarks} : undefined});
        return;
    }

    const childMarks = marksForElement(node, inheritedMarks);
    for (const child of Array.from(node.childNodes)) {
        appendNodeSpans(child, childMarks, spans);
    }
}

function marksForElement(
    node: Node,
    inheritedMarks: NonNullable<RichTextImportSnapshot['spans'][number]['marks']>,
) {
    if (node.nodeType !== 1) return inheritedMarks;
    const element = node as Element;
    const marks = {...inheritedMarks};
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'strong' || tagName === 'b') marks.strong = true;
    if (tagName === 'em' || tagName === 'i') marks.em = true;
    if (tagName === 'code') marks.code = true;
    if (tagName === 'a') {
        const href = element.getAttribute('href');
        if (href) marks.link = href;
    }
    return marks;
}

function mergeAdjacentSpans(spans: RichTextImportSnapshot['spans']) {
    const merged: RichTextImportSnapshot['spans'] = [];
    for (const span of spans) {
        const previous = merged.at(-1);
        if (previous && JSON.stringify(previous.marks ?? {}) === JSON.stringify(span.marks ?? {})) {
            previous.text += span.text;
        } else {
            merged.push({...span, marks: span.marks ? {...span.marks} : undefined});
        }
    }
    return merged;
}
