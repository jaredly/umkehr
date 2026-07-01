import type {HLC, TimestampedBlockMeta} from '../../block-crdt/types.js';

import type {BlockEditorRegistry} from './types.js';

export const CORE_PARAGRAPH_BLOCK_TYPE = 'paragraph';

export type CoreBlockMeta = {type: typeof CORE_PARAGRAPH_BLOCK_TYPE; ts: HLC};

export const coreParagraphMeta = (ts: HLC): CoreBlockMeta => ({
    type: CORE_PARAGRAPH_BLOCK_TYPE,
    ts,
});

export type BlockEditorMetaValidationOptions = {
    coreBlockTypes?: readonly string[];
};

const DEFAULT_CORE_BLOCK_TYPES = [CORE_PARAGRAPH_BLOCK_TYPE] as const;

export const blockEditorMetaType = (meta: TimestampedBlockMeta): string | null => {
    const record = meta as unknown as {type?: unknown};
    return typeof record.type === 'string' ? record.type : null;
};

export const blockEditorMetaIsCore = (
    meta: TimestampedBlockMeta,
    options: BlockEditorMetaValidationOptions = {},
): boolean => {
    const coreBlockTypes = new Set(options.coreBlockTypes ?? DEFAULT_CORE_BLOCK_TYPES);
    const type = blockEditorMetaType(meta);
    return !!type && coreBlockTypes.has(type);
};

export const validateBlockEditorMeta = <Meta extends TimestampedBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
    meta: unknown,
    options: BlockEditorMetaValidationOptions = {},
): meta is Meta | CoreBlockMeta => {
    if (!isTimestampedMeta(meta)) return false;
    if (blockEditorMetaIsCore(meta, options)) return true;

    const type = blockEditorMetaType(meta);
    if (!type) return false;
    const spec = registry.blockTypes.get(type);
    if (!spec) return false;
    if (spec.validate) return spec.validate(meta);
    if (spec.isMeta) return spec.isMeta(meta);
    return true;
};

export const blockEditorMetaWithTs = <Meta extends TimestampedBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
    meta: Meta | CoreBlockMeta,
    ts: HLC,
): Meta | CoreBlockMeta => {
    const type = blockEditorMetaType(meta);
    if (type === CORE_PARAGRAPH_BLOCK_TYPE) return coreParagraphMeta(ts);
    const spec = type ? registry.blockTypes.get(type) : undefined;
    if (spec?.withTs) return spec.withTs(meta as Meta, ts);
    return {...meta, ts};
};

const isTimestampedMeta = (value: unknown): value is TimestampedBlockMeta =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as {ts?: unknown}).ts === 'string';
