import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
export {
    WHITEBOARD_DOC_ID,
    initialWhiteboardState,
    initialWhiteboardTimestamp,
    validateWhiteboardState,
    whiteboardSchema,
    type BaseWhiteboardElement,
    type BoardPoint,
    type ElementSize,
    type EmojiStampElement,
    type StickyNoteElement,
    type StrokeElement,
    type StrokePoint,
    type WhiteboardElement,
    type WhiteboardElementType,
    type WhiteboardState,
} from './schema';
import type {WhiteboardState} from './schema';
export const [ProvideWhiteboardHistory, useWhiteboardHistory] = createHistoryContext<
    WhiteboardState,
    never,
    'type'
>('type');
export const [ProvideWhiteboard, useWhiteboard] = createSyncedContext<WhiteboardState>('type');
