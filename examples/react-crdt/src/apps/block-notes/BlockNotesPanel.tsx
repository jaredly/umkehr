import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useValue} from 'umkehr/react';
import {hlc} from 'umkehr/crdt';
import {cachedBlockRichTextValue} from 'umkehr/block-richtext';
import {
    BlockRichTextEditor,
    createAttachmentFromFile,
    deserializeAttachments,
    initialRetainedSelectionSet,
    legacyRichTextPlugins,
    revokeAttachments,
    type AttachmentStore,
    type BlockEditorReplica,
    type ImageAttachment,
    type MultiCommandResult,
    type RetainedSelectionSet,
    type SerializedImageAttachment,
} from 'umkehr/block-editor';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {
    attachmentStoreFromBlockNotesArtifacts,
    clearSelectionMessage,
    saveBlockNotesAttachments,
    selectionMessage,
    type BlockNotesBuilderExtensions,
    type BlockNotesEphemeralData,
    type BlockNotesState,
} from './model';

export function BlockNotesPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<
        BlockNotesState,
        'type',
        BlockNotesEphemeralData,
        BlockNotesBuilderExtensions
    >;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const body = useValue(editor.$.body);
    const state = useMemo(() => cachedBlockRichTextValue(body), [body]);
    const [selection, setSelection] = useState<RetainedSelectionSet>(() =>
        initialRetainedSelectionSet(state),
    );
    const [attachments, setAttachments] = useState<AttachmentStore>(() =>
        attachmentStoreFromBlockNotesArtifacts(),
    );
    const attachmentsRef = useRef(attachments);
    const clockRef = useRef(hlc.init(actor, 0));
    const editorId = gridSlot === 'right' ? 'right' : 'left';

    useLayoutEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useLayoutEffect(
        () => () => {
            revokeAttachments(attachmentsRef.current);
            editor.publishEphemeral([clearSelectionMessage(actor)]);
        },
        [actor, editor],
    );

    const createImageAttachment = async (file: File): Promise<ImageAttachment> => {
        const attachment = await createAttachmentFromFile(file);
        setAttachments((current) => {
            const next = new Map(current);
            next.set(attachment.id, attachment);
            saveBlockNotesAttachments(next);
            return next;
        });
        return attachment;
    };

    const mergeSerializedAttachments = (serialized: SerializedImageAttachment[]) => {
        const pastedAttachments = deserializeAttachments(serialized);
        setAttachments((current) => {
            const next = new Map(current);
            for (const [id, attachment] of pastedAttachments) next.set(id, attachment);
            saveBlockNotesAttachments(next);
            return next;
        });
    };

    const replicaForCommand = (): BlockEditorReplica => ({
        id: editorId,
        actor,
        state,
        selection,
        online: !readOnly,
        queue: [],
        clock: clockRef.current,
    });

    const runCommand = (command: (replica: BlockEditorReplica) => MultiCommandResult) => {
        if (readOnly) return;
        const replica = replicaForCommand();
        const result = command(replica);
        clockRef.current = replica.clock;
        setSelection(result.selection);
        editor.publishEphemeral([selectionMessage({actor, selection: result.selection})]);
        if (!result.ops.length) return;
        editor.$.body.$block.ops({ops: result.ops});
        editor.$.updatedAt(new Date().toISOString());
    };

    return (
        <section
            className={`blockNotesPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
            data-testid="block-notes-panel"
        >
            <header>
                <h1>{title}</h1>
            </header>
            <BlockRichTextEditor
                replica={replicaForCommand()}
                attachments={attachments}
                plugins={legacyRichTextPlugins}
                resetSignal={0}
                undoState={{
                    canUndo: editor.canUndo(),
                    canRedo: editor.canRedo(),
                }}
                undoStatus=""
                rainbowLamportIds={false}
                userId={actor}
                onUserIdChange={() => {}}
                onCommand={runCommand}
                onUndo={() => editor.undo()}
                onRedo={() => editor.redo()}
                onToggleOnline={() => {}}
                onCreateImageAttachment={createImageAttachment}
                onMergeSerializedAttachments={mergeSerializedAttachments}
                onKeystroke={() => {}}
            />
        </section>
    );
}
