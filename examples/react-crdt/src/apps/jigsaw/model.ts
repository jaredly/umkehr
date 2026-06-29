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
    jigsawArtifactStore,
    type JigsawBoardArtifact,
    type JigsawGenerationType,
    type JigsawPiece,
    type JigsawPieceCount,
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
    jigsawArtifactStore,
    type Coord,
    type JigsawBoardArtifact,
    type JigsawGenerationType,
    type JigsawPieceCount,
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
