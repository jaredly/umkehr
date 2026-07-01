import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {
    JIGSAW_DOC_ID,
    initialJigsawState,
    initialJigsawTimestamp,
    jigsawSchema,
    validateJigsawState,
    type Coord,
    type JigsawState,
} from './schema';
import {
    initialJigsawArtifacts,
    isJigsawPieceCount,
    isJigsawImageArtifact,
    isJigsawSurface,
    jigsawArtifactStore,
    type JigsawBoardArtifact,
    type JigsawGenerationType,
    type JigsawImageArtifact,
    type JigsawImageMimeType,
    type JigsawImageRef,
    type JigsawPiece,
    type JigsawPieceCount,
    type JigsawSurface,
    type PathSegment,
} from './artifacts';

export {
    JIGSAW_DOC_ID,
    initialJigsawState,
    initialJigsawTimestamp,
    jigsawSchema,
    validateJigsawState,
    initialJigsawArtifacts,
    isJigsawPieceCount,
    isJigsawImageArtifact,
    isJigsawSurface,
    jigsawArtifactStore,
    type Coord,
    type JigsawBoardArtifact,
    type JigsawGenerationType,
    type JigsawImageArtifact,
    type JigsawImageMimeType,
    type JigsawImageRef,
    type JigsawPieceCount,
    type JigsawSurface,
    type JigsawPiece,
    type JigsawState,
    type PathSegment,
};

export type JigsawEphemeralData = never;

export const [ProvideJigsawHistory, useJigsawHistory] = createHistoryContext<
    JigsawState,
    never,
    'type'
>('type');

export const [ProvideJigsaw, useJigsaw] = createSyncedContext<
    JigsawState,
    'type',
    JigsawEphemeralData
>('type');
