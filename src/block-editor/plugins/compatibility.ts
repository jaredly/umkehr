import type {CachedState, Mark, TimestampedBlockMeta} from '../../block-crdt/types.js';

import type {BlockEditorRegistry} from './types.js';

export type BlockEditorDocumentCompatibilityIssue =
    | {type: 'block'; id: string; blockType: string}
    | {type: 'mark'; id: string; markType: string}
    | {type: 'inline-embed'; id: string; embedType: string}
    | {type: 'selection'; id: string; selectionType: string};

export class BlockEditorPluginLoadError extends Error {
    readonly issues: readonly BlockEditorDocumentCompatibilityIssue[];

    constructor(issues: readonly BlockEditorDocumentCompatibilityIssue[]) {
        super(documentCompatibilityMessage(issues));
        this.name = 'BlockEditorPluginLoadError';
        this.issues = issues;
    }
}

export type BlockEditorDocumentCompatibilityOptions = {
    coreBlockTypes?: readonly string[];
    coreMarkTypes?: readonly string[];
    coreSelectionTypes?: readonly string[];
    inlineEmbedMarkType?: string;
};

const DEFAULT_CORE_BLOCK_TYPES = ['paragraph'] as const;
const DEFAULT_CORE_MARK_TYPES: readonly string[] = [];
const DEFAULT_CORE_SELECTION_TYPES = ['caret', 'range', 'block'] as const;
const DEFAULT_INLINE_EMBED_MARK_TYPE = 'embed';

export const blockEditorDocumentCompatibilityIssues = <Meta extends TimestampedBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
    input: {
        state: CachedState<Meta>;
        selections?: readonly {id: string; selection: {type: string}}[];
    },
    options: BlockEditorDocumentCompatibilityOptions = {},
): BlockEditorDocumentCompatibilityIssue[] => {
    const coreBlockTypes = new Set(options.coreBlockTypes ?? DEFAULT_CORE_BLOCK_TYPES);
    const coreMarkTypes = new Set(options.coreMarkTypes ?? DEFAULT_CORE_MARK_TYPES);
    const coreSelectionTypes = new Set(options.coreSelectionTypes ?? DEFAULT_CORE_SELECTION_TYPES);
    const inlineEmbedMarkType = options.inlineEmbedMarkType ?? DEFAULT_INLINE_EMBED_MARK_TYPE;
    const issues: BlockEditorDocumentCompatibilityIssue[] = [];

    for (const [id, block] of Object.entries(input.state.state.blocks)) {
        const blockType = metadataType(block.meta);
        if (blockType && !coreBlockTypes.has(blockType) && !registry.blockTypes.has(blockType)) {
            issues.push({type: 'block', id, blockType});
        }
    }

    for (const [id, mark] of Object.entries(input.state.state.marks)) {
        if (!coreMarkTypes.has(mark.type) && !registry.marks.has(mark.type)) {
            issues.push({type: 'mark', id, markType: mark.type});
        }
        if (mark.type === inlineEmbedMarkType) {
            const embedType = inlineEmbedType(mark);
            if (embedType && !registry.inlineEmbeds.has(embedType)) {
                issues.push({type: 'inline-embed', id, embedType});
            }
        }
    }

    for (const entry of input.selections ?? []) {
        const selectionType = entry.selection.type;
        if (!coreSelectionTypes.has(selectionType) && !registry.selectionTypes.has(selectionType)) {
            issues.push({type: 'selection', id: entry.id, selectionType});
        }
    }

    return issues;
};

export const assertBlockEditorDocumentPluginsAvailable = <Meta extends TimestampedBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
    input: {
        state: CachedState<Meta>;
        selections?: readonly {id: string; selection: {type: string}}[];
    },
    options?: BlockEditorDocumentCompatibilityOptions,
): void => {
    const issues = blockEditorDocumentCompatibilityIssues(registry, input, options);
    if (issues.length) throw new BlockEditorPluginLoadError(issues);
};

const documentCompatibilityMessage = (issues: readonly BlockEditorDocumentCompatibilityIssue[]): string => {
    const summary = issues
        .slice(0, 5)
        .map((issue) => {
            switch (issue.type) {
                case 'block':
                    return `block "${issue.id}" requires block type "${issue.blockType}"`;
                case 'mark':
                    return `mark "${issue.id}" requires mark type "${issue.markType}"`;
                case 'inline-embed':
                    return `mark "${issue.id}" requires inline embed type "${issue.embedType}"`;
                case 'selection':
                    return `selection "${issue.id}" requires selection type "${issue.selectionType}"`;
            }
        })
        .join('; ');
    const suffix = issues.length > 5 ? `; and ${issues.length - 5} more` : '';
    return `Document requires unavailable block editor plugins: ${summary}${suffix}.`;
};

const metadataType = (meta: TimestampedBlockMeta): string | null => {
    const record = meta as unknown as {type?: unknown};
    return typeof record.type === 'string' ? record.type : null;
};

const inlineEmbedType = (mark: Mark): string | null => {
    const data = mark.data as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const type = (data as {type?: unknown}).type;
    return typeof type === 'string' && type.length > 0 ? type : null;
};
