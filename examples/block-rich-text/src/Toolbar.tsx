import {useRef} from 'react';

import type {AnnotationPresentation} from './annotations';
import type {BlockTypeMenuValue, PendingInlineMarks} from './blockEditorTypes';

export function Toolbar({
    canUndo,
    canRedo,
    blockType,
    activeMarks,
    onUndo,
    onRedo,
    onBold,
    onItalic,
    onStrikethrough,
    onCode,
    onLink,
    onDateEmbed,
    onImageUploadStart,
    onImageUpload,
    onBlockType,
    onAnnotation,
}: {
    canUndo: boolean;
    canRedo: boolean;
    blockType: BlockTypeMenuValue;
    activeMarks: PendingInlineMarks;
    onUndo(): void;
    onRedo(): void;
    onBold(): void;
    onItalic(): void;
    onStrikethrough(): void;
    onCode(): void;
    onLink(): void;
    onDateEmbed(): void;
    onImageUploadStart(): void;
    onImageUpload(files: File[]): void;
    onBlockType(kind: BlockTypeMenuValue): void;
    onAnnotation(presentation: AnnotationPresentation): void;
}) {
    const imageInputRef = useRef<HTMLInputElement>(null);
    return (
        <div className="toolbar" aria-label="Formatting">
            <div className="toolbarGroup" aria-label="History">
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onUndo}
                    disabled={!canUndo}
                >
                    Undo
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onRedo}
                    disabled={!canRedo}
                >
                    Redo
                </button>
            </div>
            <div className="toolbarGroup" aria-label="Inline marks">
                <button
                    type="button"
                    aria-pressed={!!activeMarks.bold}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onBold}
                >
                    <strong>B</strong>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.italic}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onItalic}
                >
                    <em>I</em>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.strikethrough}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onStrikethrough}
                    aria-label="Strikethrough"
                >
                    <span className="toolbarStrike">S</span>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.code}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onCode}
                >
                    Code
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onLink}
                >
                    Link
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onDateEmbed}
                >
                    Date
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        onImageUploadStart();
                    }}
                    onClick={() => {
                        onImageUploadStart();
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
            </div>
            <div className="toolbarGroup" aria-label="Annotations">
                <button
                    type="button"
                    aria-label="Comment"
                    title="Comment"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('sidebar')}
                >
                    C
                </button>
                <button
                    type="button"
                    aria-label="Footnote"
                    title="Footnote"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('footnote')}
                >
                    F
                </button>
                <button
                    type="button"
                    aria-label="Popover"
                    title="Popover"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('popover')}
                >
                    P
                </button>
            </div>
            <select
                aria-label="Block type"
                value={blockType}
                onChange={(event) => {
                    onBlockType(event.currentTarget.value as BlockTypeMenuValue);
                }}
            >
                <option value="paragraph">Paragraph</option>
                <option value="heading1">Heading 1</option>
                <option value="heading2">Heading 2</option>
                <option value="heading3">Heading 3</option>
                <option value="unordered">Bulleted list</option>
                <option value="ordered">Numbered list</option>
                <option value="todo">Todo</option>
                <option value="blockquote">Quote</option>
                <option value="code">Code</option>
                <option value="mermaid">Mermaid diagram</option>
                <option value="vega-lite">Vega-Lite chart</option>
                <option value="callout-info">Info callout</option>
                <option value="callout-warning">Warning callout</option>
                <option value="callout-error">Error callout</option>
                <option value="recipe-ingredient">Ingredient line</option>
                <option value="table">Table</option>
                <option value="kanban">Kanban board</option>
                <option value="preview">Preview</option>
            </select>
        </div>
    );
}
