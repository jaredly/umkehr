import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {validateWhiteboardEphemeralData, type WhiteboardEphemeralData} from './ephemeral';
import type {WhiteboardState} from './schema';

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
export {
    clearEphemeralMessage,
    elementPreviewId,
    elementPreviewMessage,
    selectionId,
    selectionMessage,
    strokePreviewId,
    strokePreviewMessage,
    validateWhiteboardEphemeralData,
    whiteboardEphemeralKinds,
    type WhiteboardElementPreviewData,
    type WhiteboardEphemeralData,
    type WhiteboardSelectionData,
    type WhiteboardStrokePreviewData,
} from './ephemeral';

export const [ProvideWhiteboardHistory, useWhiteboardHistory] = createHistoryContext<
    WhiteboardState,
    never,
    'type'
>('type');
export const [ProvideWhiteboard, useWhiteboard] = createSyncedContext<
    WhiteboardState,
    'type',
    WhiteboardEphemeralData
>('type', undefined, {
    validateEphemeralData: validateWhiteboardEphemeralData,
    maxEphemeralBytes: 16_384,
});
