import type {ReactElement} from 'react';
import type {CachedState, HLC, Op, TimestampedBlockMeta} from '../block-crdt/types.js';
import type {RetainedSelectionSet} from './selectionSet.js';

export type BlockEditorClock = {
    actor: string;
    nextTs(): HLC;
    previewTs?(): () => HLC;
};

export type BlockEditorValue<Meta extends TimestampedBlockMeta> = {
    state: CachedState<Meta>;
    selection: BlockEditorSelectionState;
};

export type BlockEditorChange<Meta extends TimestampedBlockMeta> = {
    state: CachedState<Meta>;
    selection: BlockEditorSelectionState;
    ops: Array<Op<Meta>>;
    commandLabel?: string;
};

export type BlockEditorAttachment = {
    id: string;
    url: string;
    name?: string;
    type?: string;
};

export type BlockEditorAttachmentStore = {
    get(id: string): BlockEditorAttachment | null;
    create?(file: File): Promise<BlockEditorAttachment>;
};

export type BlockEditorPresenceSelection = {
    actor: string;
    color?: string;
    label?: string;
    selection: BlockEditorSelectionState;
};

export type BlockEditorPresence = {
    selections: BlockEditorPresenceSelection[];
    publishSelection?(selection: BlockEditorSelectionState | null): void;
};

export type BlockEditorSelectionState = RetainedSelectionSet;

export type BlockRichTextEditorProps<Meta extends TimestampedBlockMeta> = {
    value: BlockEditorValue<Meta>;
    clock: BlockEditorClock;
    readOnly?: boolean;
    userId?: string;
    attachments?: BlockEditorAttachmentStore;
    presence?: BlockEditorPresence;
    onChange(change: BlockEditorChange<Meta>): void;
    onSelectionChange?(selection: BlockEditorSelectionState): void;
    onUndo?(): void;
    onRedo?(): void;
};

export type BlockRichTextEditorComponent = <Meta extends TimestampedBlockMeta>(
    props: BlockRichTextEditorProps<Meta>,
) => ReactElement;
