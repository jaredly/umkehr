import {useValue} from 'umkehr/react';
import {blockRichTextRootBlockId, materializeBlockRichTextValue} from 'umkehr/block-richtext';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import type {BlockNotesBuilderExtensions, BlockNotesState} from './model';

export function BlockNotesPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<BlockNotesState, 'type', never, BlockNotesBuilderExtensions>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const body = useValue(editor.$.body);
    const blocks = materializeBlockRichTextValue(body);
    const firstBlock = blocks[0];
    const rootBlockId = firstBlock?.id ?? blockRichTextRootBlockId();
    const firstText = firstBlock?.runs.map((run) => run.text).join('') ?? '';
    const text = blocks.map((block) => block.runs.map((run) => run.text).join('')).join('\n');

    return (
        <section
            className={`blockNotesPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
            data-testid="block-notes-panel"
        >
            <header>
                <h1>{title}</h1>
                <p>{blocks.length} blocks</p>
            </header>
            <pre data-testid="block-notes-text">{text}</pre>
            <div>
                <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                        editor.$.body.$block.insertText({
                            block: rootBlockId,
                            offset: Array.from(firstText).length,
                            text: firstText ? ` ${actor}` : actor,
                        });
                        editor.$.updatedAt(new Date().toISOString());
                    }}
                >
                    Insert actor
                </button>
                <button type="button" disabled={!editor.canUndo()} onClick={() => editor.undo()}>
                    Undo
                </button>
                <button type="button" disabled={!editor.canRedo()} onClick={() => editor.redo()}>
                    Redo
                </button>
            </div>
        </section>
    );
}
