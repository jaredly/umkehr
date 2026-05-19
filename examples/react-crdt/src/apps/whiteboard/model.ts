import typia from 'typia';
import {hlc} from 'umkehr/crdt';
import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';

export type WhiteboardElementType = 'note' | 'stroke' | 'emoji';

export type StrokePoint = {
    x: number;
    y: number;
    pressure?: number;
};

export type BaseWhiteboardElement = {
    type: WhiteboardElementType;
    id: string;
    x: number;
    y: number;
    rotation: number;
    zOrder: string;
    createdBy: string;
    createdAt: string;
    archived: boolean;
    archivedBy?: string;
    archivedAt?: string;
};

export type StickyNoteElement = BaseWhiteboardElement & {
    type: 'note';
    width: number;
    height: number;
    color: string;
    text: string;
};

export type StrokeElement = BaseWhiteboardElement & {
    type: 'stroke';
    color: string;
    width: number;
    points: StrokePoint[];
};

export type EmojiStampElement = BaseWhiteboardElement & {
    type: 'emoji';
    emoji: string;
    size: number;
};

export type WhiteboardElement = StickyNoteElement | StrokeElement | EmojiStampElement;

export type WhiteboardState = {
    background: string;
    elements: Record<string, WhiteboardElement>;
};

export const WHITEBOARD_DOC_ID = 'umkehr-react-crdt-whiteboard-v1';
export const whiteboardSchema = typia.json.schemas<[WhiteboardState], '3.1'>();
export const validateWhiteboardState = typia.createValidate<WhiteboardState>();
export const [ProvideWhiteboardHistory, useWhiteboardHistory] = createHistoryContext<
    WhiteboardState,
    never,
    'type'
>('type');
export const [ProvideWhiteboard, useWhiteboard] = createSyncedContext<WhiteboardState>('type');

export const initialWhiteboardState: WhiteboardState = {
    background: '#f8fafc',
    elements: {},
};

export const initialWhiteboardTimestamp = hlc.pack(hlc.init('seed', 0));
