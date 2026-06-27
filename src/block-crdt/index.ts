export type {
    Boundary,
    Block,
    BlockOrder,
    BlockOrderTs,
    BlockStyle,
    BlockStylePatch,
    Cache,
    CachedState,
    Char,
    CharParentTs,
    DefaultBlockMeta,
    HLC,
    IncidentalBlockOrderTs,
    JoinRecord,
    JsonValue,
    Lamport,
    Mark,
    Op,
    SplitRecord,
    State,
    TimestampedBlockMeta,
} from './types.js';

export {
    addChars,
    deleteRangeOps,
    deleteBlockOps,
    insertTextOps,
    insertBlockOps,
    insertBlockOpsWithId,
    join,
    joinBlocksOps,
    markRangesOps,
    markSelectionOps,
    moveBlockOps,
    nextBlockIdForActor,
    setBlockMetaOps,
    setBlockStyleOps,
    split,
    splitBlockOps,
} from './changes.js';
export type {
    DeleteBlockMode,
    DeleteBlockOpsOptions,
    InsertBlockOpsOptions,
    MarkRange,
    MarkRangePoint,
} from './changes.js';

export {
    apply,
    applyMany,
    applyManyStrict,
    applyRemote,
    applyRemoteMany,
    applyStrict,
    assertCacheConsistent,
    charOp,
} from './apply.js';
export type {ApplyResult} from './apply.js';

export {
    blockParentStrategiesForStress,
    materializedBlockParent,
    materializedBlockPath,
    materializedBlockPaths,
    virtualParentOwner,
    virtualParentOwners,
} from './blocks.js';
export type {VirtualBlockParentConfig} from './blocks.js';

export {
    cachedState,
    organizeState,
} from './cache.js';

export {
    compareLamports,
    compareLamportStrings,
    lamportToString,
    parseLamportString,
} from './ids.js';

export {
    activeJoinByRightBlock,
    activeJoinRecords,
    joinedBlockIds,
} from './joins.js';

export {
    markOp,
    markBoundaryOp,
    markRange,
    markRange as markRangeOp,
    materializeFormattedBlocks,
    coveredCharIdsForMark,
    formattedMarkValues,
    visibleRangesForMark,
    splitRecordsByLeft,
} from './marks.js';
export type {FormattedBlock, FormattedMarkValue, FormattedRun, VisibleMarkRange} from './marks.js';

export {
    maxLamportCounterForOp,
    validateOp,
} from './ops.js';

export {
    planUndoOps,
} from './undo.js';
export type {UndoPlan, UndoUnsupported} from './undo.js';

export {
    blockIdAtVisiblePath,
    blockContents,
    clampBlockPoint,
    charToString,
    findTail,
    graphemeLength,
    graphemeOffsetToUtf16Offset,
    hasJoinStyleParent,
    orderedCharIdsForBlock,
    resolvePoint,
    resolveSelection,
    retainPoint,
    retainSelection,
    rootBlockIds,
    segmentGraphemes,
    stateToString,
    utf16OffsetToGraphemeOffset,
    visibleBlockEntryAtPath,
    visibleBlockChildren,
    visibleBlockOutline,
    visibleGraphemeIdsForBlock,
    visibleLengthForBlock,
    visiblePathForBlockId,
    visibleSiblingAnchorsForBlock,
    visibleSiblingAnchorsForPath,
    visibleTextForBlock,
} from './traversal.js';
export type {
    BlockPoint,
    RetainedPoint,
    RetainedSelection,
    VisibleBlockOutlineEntry,
    VisibleBlockPath,
    VisibleSiblingAnchors,
} from './traversal.js';

export {
    blockOrderVersionWins,
    charParentVersionWins,
    compareBlockOrderVersions,
    compareCharParentVersions,
} from './versions.js';
