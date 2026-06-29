import {useRef} from 'react';

import type {AnnotationPresentation} from './annotations';
import type {BlockTypeMenuValue, PendingInlineMarks} from './blockEditorTypes';
import {legacyBlockTypeMenuItems, type LegacyBlockTypeMenuItem} from './plugins/index.js';

export function Toolbar({
    canUndo,
    canRedo,
    blockType,
    blockTypeItems = legacyBlockTypeMenuItems,
    toolbarItemIds,
    activeMarks,
    onUndo,
    onRedo,
    onBold,
    onItalic,
    onStrikethrough,
    onCode,
    onMath,
    onDisplayMath,
    onLink,
    onDateEmbed,
    onImageUploadStart,
    onImageUpload,
    onBlockType,
    onAnnotation,
    onCommand,
}: {
    canUndo: boolean;
    canRedo: boolean;
    blockType: BlockTypeMenuValue;
    blockTypeItems?: readonly LegacyBlockTypeMenuItem[];
    toolbarItemIds?: ReadonlySet<string>;
    activeMarks: PendingInlineMarks;
    onUndo(): void;
    onRedo(): void;
    onBold(): void;
    onItalic(): void;
    onStrikethrough(): void;
    onCode(): void;
    onMath(): void;
    onDisplayMath(): void;
    onLink(): void;
    onDateEmbed(): void;
    onImageUploadStart(): void;
    onImageUpload(files: File[]): void;
    onBlockType(kind: BlockTypeMenuValue): void;
    onAnnotation(presentation: AnnotationPresentation): void;
    onCommand?(commandId: string): void;
}) {
    const imageInputRef = useRef<HTMLInputElement>(null);
    const enabled = (id: string): boolean => !toolbarItemIds || toolbarItemIds.has(id);
    const runCommand = (commandId: string, fallback: () => void) => {
        if (onCommand) {
            onCommand(commandId);
        } else {
            fallback();
        }
    };
    const inlineGroupEnabled = [
        'mark:bold',
        'mark:italic',
        'mark:strikethrough',
        'mark:code',
        'mark:math',
        'mark:display-math',
        'link:edit',
        'inline-embed:date',
        'image:upload',
    ].some(enabled);
    return (
        <div className="toolbar" aria-label="Formatting">
            {enabled('history:undo') || enabled('history:redo') ? (
                <div className="toolbarGroup" aria-label="History">
                    {enabled('history:undo') ? (
                        <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runCommand('history:undo', onUndo)}
                            disabled={!canUndo}
                        >
                            Undo
                        </button>
                    ) : null}
                    {enabled('history:redo') ? (
                        <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runCommand('history:redo', onRedo)}
                            disabled={!canRedo}
                        >
                            Redo
                        </button>
                    ) : null}
                </div>
            ) : null}
            {inlineGroupEnabled ? (
            <div className="toolbarGroup" aria-label="Inline marks">
                {enabled('mark:bold') ? (
                    <button
                        type="button"
                        aria-pressed={!!activeMarks.bold}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:bold', onBold)}
                    >
                        <strong>B</strong>
                    </button>
                ) : null}
                {enabled('mark:italic') ? (
                    <button
                        type="button"
                        aria-pressed={!!activeMarks.italic}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:italic', onItalic)}
                    >
                        <em>I</em>
                    </button>
                ) : null}
                {enabled('mark:strikethrough') ? (
                    <button
                        type="button"
                        aria-pressed={!!activeMarks.strikethrough}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:strikethrough', onStrikethrough)}
                        aria-label="Strikethrough"
                    >
                        <span className="toolbarStrike">S</span>
                    </button>
                ) : null}
                {enabled('mark:code') ? (
                    <button
                        type="button"
                        aria-pressed={!!activeMarks.code}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:code', onCode)}
                    >
                        Code
                    </button>
                ) : null}
                {enabled('mark:math') ? (
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:math', onMath)}
                    >
                        Math
                    </button>
                ) : null}
                {enabled('mark:display-math') ? (
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('mark:display-math', onDisplayMath)}
                    >
                        Display Math
                    </button>
                ) : null}
                {enabled('link:edit') ? (
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('link:edit', onLink)}
                    >
                        Link
                    </button>
                ) : null}
                {enabled('inline-embed:date') ? (
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand('inline-embed:date', onDateEmbed)}
                    >
                        Date
                    </button>
                ) : null}
                {enabled('image:upload') ? (
                    <>
                        <button
                            type="button"
                            onMouseDown={(event) => {
                                event.preventDefault();
                                runCommand('image:upload', onImageUploadStart);
                            }}
                            onClick={() => {
                                runCommand('image:upload', onImageUploadStart);
                                imageInputRef.current?.click();
                            }}
                        >
                            Image
                        </button>
                        <input
                            ref={imageInputRef}
                            className="imageUploadInput"
                            type="file"
                            accept="image/*"
                            aria-label="Upload image"
                            onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = '';
                                if (files.length) onImageUpload(files);
                            }}
                        />
                    </>
                ) : null}
            </div>
            ) : null}
            {enabled('annotation:sidebar') || enabled('annotation:footnote') || enabled('annotation:popover') ? (
                <div className="toolbarGroup" aria-label="Annotations">
                    {enabled('annotation:sidebar') ? (
                        <button
                            type="button"
                            aria-label="Comment"
                            title="Comment"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runCommand('annotation:sidebar', () => onAnnotation('sidebar'))}
                        >
                            C
                        </button>
                    ) : null}
                    {enabled('annotation:footnote') ? (
                        <button
                            type="button"
                            aria-label="Footnote"
                            title="Footnote"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runCommand('annotation:footnote', () => onAnnotation('footnote'))}
                        >
                            F
                        </button>
                    ) : null}
                    {enabled('annotation:popover') ? (
                        <button
                            type="button"
                            aria-label="Popover"
                            title="Popover"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runCommand('annotation:popover', () => onAnnotation('popover'))}
                        >
                            P
                        </button>
                    ) : null}
                </div>
            ) : null}
            {blockTypeItems.length ? (
                <select
                    aria-label="Block type"
                    value={blockType}
                    onChange={(event) => {
                        const kind = event.currentTarget.value as BlockTypeMenuValue;
                        runCommand(`block-type:${kind}`, () => onBlockType(kind));
                    }}
                >
                    {blockTypeItems.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
            ) : null}
        </div>
    );
}
