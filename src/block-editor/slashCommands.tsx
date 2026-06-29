import {useLayoutEffect, useMemo, useRef} from 'react';
import {
    applyMany,
    blockContents,
    deleteRangeOps,
    isDeleted,
    orderedCharIdsForBlock,
} from '../block-crdt/index.js';
import type {CachedState, Op} from '../block-crdt/types.js';
import {lamportToString, parseLamportString} from '../block-crdt/utils.js';

import {annotationVirtualParents} from './annotations';
import type {RichBlockMeta} from './blockMeta';
import type {BlockTypeMenuValue} from './blockEditorTypes';
import type {MultiCommandResult} from './multiSelectionCommands';
import type {BlockEditorRegistry, BlockEditorSlashCommandSpec} from './plugins/index.js';
import {caret, focusPoint, segmentText, type EditorSelection} from './selectionModel';
import {
    dedupeSelectionSet,
    resolveSelectionSet,
    type RetainedSelectionSet,
} from './selectionSet';
import {resolveSelection, retainSelection} from './retainedSelection';

export type SlashTrigger = {
    selectionId: string;
    charId: string | null;
    fallbackBlockId: string;
    fallbackOffset: number;
};

export type SlashMenuState = {
    triggers: SlashTrigger[];
    selection: RetainedSelectionSet;
    top: number;
    left: number;
    query: string;
    activeIndex: number;
};

export type SlashCommand =
    | {type: 'block'; value: BlockTypeMenuValue; label: string; group: string; keywords: string[]; commandId: string}
    | {type: 'date-embed'; label: string; group: string; keywords: string[]; commandId: string};

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
    defaultBlockSlashCommand('paragraph', 'Paragraph', ['text']),
    defaultBlockSlashCommand('heading1', 'Heading 1', ['h1', 'title']),
    defaultBlockSlashCommand('heading2', 'Heading 2', ['h2', 'subtitle']),
    defaultBlockSlashCommand('heading3', 'Heading 3', ['h3']),
    defaultBlockSlashCommand('unordered', 'Bulleted list', ['bullet', 'unordered']),
    defaultBlockSlashCommand('ordered', 'Numbered list', ['number', 'ordered']),
    defaultBlockSlashCommand('todo', 'Todo', ['task', 'checkbox']),
    defaultBlockSlashCommand('blockquote', 'Blockquote', ['quote']),
    defaultBlockSlashCommand('code', 'Code', ['pre']),
    defaultBlockSlashCommand('mermaid', 'Mermaid diagram', ['diagram', 'chart', 'flowchart', 'mermaid']),
    defaultBlockSlashCommand('vega-lite', 'Vega-Lite chart', ['chart', 'graph', 'vega', 'visualization']),
    defaultBlockSlashCommand('callout-info', 'Info callout', ['info']),
    defaultBlockSlashCommand('callout-warning', 'Warning callout', ['warning']),
    defaultBlockSlashCommand('callout-error', 'Error callout', ['error']),
    defaultBlockSlashCommand('recipe-ingredient', 'Ingredient', ['ingredient', 'recipe', 'food', 'line']),
    defaultBlockSlashCommand('table', 'Table', ['grid']),
    defaultBlockSlashCommand('columns', 'Columns', ['columns', 'layout']),
    defaultBlockSlashCommand('card-columns', 'Card columns', ['board', 'cards', 'columns']),
    defaultBlockSlashCommand('slide-deck', 'Slide deck', ['presentation', 'deck', 'slides']),
    defaultBlockSlashCommand('slide', 'Slide', ['presentation', 'deck']),
    defaultBlockSlashCommand('preview', 'Preview', ['link', 'card', 'url']),
    {type: 'date-embed', label: 'Date', group: 'Inline embed', keywords: ['embed', 'calendar'], commandId: 'inline-embed:date'},
];

const slashCommandId = (command: SlashCommand): string =>
    command.commandId;

function defaultBlockSlashCommand(
    value: BlockTypeMenuValue,
    label: string,
    keywords: string[],
): SlashCommand {
    return {
        type: 'block',
        value,
        label,
        group: 'Block type',
        keywords,
        commandId: `block-type:${value}`,
    };
}

export const slashCommandsFromRegistry = (
    registry: BlockEditorRegistry<RichBlockMeta>,
): SlashCommand[] => slashCommandsFromSpecs(registry.slashCommands);

export const slashCommandsFromSpecs = (
    specs: readonly BlockEditorSlashCommandSpec[],
): SlashCommand[] =>
    specs.flatMap<SlashCommand>((spec) => {
        const blockValue = blockTypeValueFromCommandId(spec.commandId);
        if (blockValue) {
            return [
                {
                    type: 'block' as const,
                    value: blockValue,
                    label: spec.label,
                    group: spec.group ?? 'Block type',
                    keywords: [...(spec.keywords ?? [])],
                    commandId: spec.commandId ?? `block-type:${blockValue}`,
                },
            ];
        }
        if (spec.commandId === 'inline-embed:date') {
            return [
                {
                    type: 'date-embed' as const,
                    label: spec.label,
                    group: spec.group ?? 'Inline embed',
                    keywords: [...(spec.keywords ?? [])],
                    commandId: spec.commandId,
                },
            ];
        }
        return [];
    });

const blockTypeValueFromCommandId = (commandId: string | undefined): BlockTypeMenuValue | null => {
    if (!commandId?.startsWith('block-type:')) return null;
    const value = commandId.slice('block-type:'.length);
    return isBlockTypeMenuValue(value) ? value : null;
};

const BLOCK_TYPE_MENU_VALUES = new Set<string>([
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'unordered',
    'ordered',
    'todo',
    'blockquote',
    'code',
    'mermaid',
    'vega-lite',
    'callout-info',
    'callout-warning',
    'callout-error',
    'recipe-ingredient',
    'table',
    'columns',
    'card-columns',
    'slide-deck',
    'slide',
    'preview',
    'poll-rating',
    'poll-children',
    'poll-matrix',
    'poll-long',
]);

const isBlockTypeMenuValue = (value: string): value is BlockTypeMenuValue =>
    BLOCK_TYPE_MENU_VALUES.has(value);

export const canOpenSlashMenuForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
): boolean => {
    const resolved = resolveSelectionSet(state, selection);
    return resolved.entries.every((entry) => {
        const block = state.state.blocks[focusPoint(entry.selection).blockId];
        return block?.meta.type !== 'code';
    });
};

export const slashTriggersFromInsertResult = (result: MultiCommandResult): SlashTrigger[] => {
    const slashChars = result.ops.filter(
        (op): op is Op<RichBlockMeta> & {type: 'char'} =>
            op.type === 'char' && op.char.text === '/',
    );
    if (!slashChars.length) return [];

    const resolved = resolveSelectionSet(result.state, result.selection);
    const unusedEntries = [...resolved.entries];
    return slashChars.flatMap((op) => {
        const charId = lamportToString(op.char.id);
        const location = visibleCharLocation(result.state, charId);
        if (!location) return [];
        const entryIndex = unusedEntries.findIndex((entry) => {
            if (entry.selection.type !== 'caret') return false;
            return (
                entry.selection.point.blockId === location.blockId &&
                entry.selection.point.offset === location.offset + 1
            );
        });
        const entry =
            entryIndex >= 0
                ? unusedEntries.splice(entryIndex, 1)[0]
                : (unusedEntries.shift() ?? resolved.entries[0]);
        return [
            {
                selectionId: entry?.id ?? result.selection.primaryId,
                charId,
                fallbackBlockId: location.blockId,
                fallbackOffset: location.offset,
            },
        ];
    });
};

const visibleCharLocation = (
    state: CachedState<RichBlockMeta>,
    charId: string,
): {blockId: string; offset: number} | null => {
    const char = state.state.chars[charId];
    if (!char || isDeleted(char)) return null;
    const parentId = lamportToString(char.parent.id);
    const parentIds = [parentId, ...Object.keys(state.state.blocks).filter((id) => id !== parentId)];
    for (const blockId of parentIds) {
        if (!state.state.blocks[blockId]) continue;
        const index = orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).indexOf(charId);
        if (index >= 0) return {blockId, offset: index};
    }
    return null;
};

const fallbackSlashLocation = (
    state: CachedState<RichBlockMeta>,
    trigger: SlashTrigger,
): {blockId: string; offset: number} | null => {
    if (!state.state.blocks[trigger.fallbackBlockId]) return null;
    const chars = segmentText(blockContents(state, trigger.fallbackBlockId));
    return chars[trigger.fallbackOffset] === '/'
        ? {blockId: trigger.fallbackBlockId, offset: trigger.fallbackOffset}
        : null;
};

export const deleteSlashTriggers = (
    state: CachedState<RichBlockMeta>,
    menu: SlashMenuState,
    context: {nextTs(): string},
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; selection: RetainedSelectionSet} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const located = menu.triggers
        .map((trigger) => ({
            trigger,
            location:
                (trigger.charId ? visibleCharLocation(working, trigger.charId) : null) ??
                fallbackSlashLocation(working, trigger),
        }))
        .filter(
            (item): item is {trigger: SlashTrigger; location: {blockId: string; offset: number}} =>
                item.location !== null,
        )
        .sort((a, b) =>
            a.location.blockId === b.location.blockId
                ? b.location.offset - a.location.offset
                : a.location.blockId.localeCompare(b.location.blockId),
        );

    const caretBySelectionId = new Map<string, EditorSelection>();
    for (const {trigger, location} of located) {
        const deleteOps = deleteRangeOps(working, {
            block: parseLamportString(location.blockId),
            startOffset: location.offset,
            endOffset: location.offset + 1,
            ts: context.nextTs,
        });
        if (!deleteOps.length) continue;
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        caretBySelectionId.set(trigger.selectionId, caret(location.blockId, location.offset));
    }

    const selection = dedupeSelectionSet(working, {
        primaryId: menu.selection.primaryId,
        entries: menu.selection.entries.map((entry) => ({
            id: entry.id,
            selection: retainSelection(
                working,
                caretBySelectionId.get(entry.id) ?? resolveSelection(working, entry.selection),
            ),
        })),
    });
    return {state: working, ops, selection};
};

export function SlashCommandPopover({
    state,
    commands: commandsProp = DEFAULT_SLASH_COMMANDS,
    onQueryChange,
    onActiveIndexChange,
    onSelect,
    onClose,
}: {
    state: SlashMenuState | null;
    commands?: readonly SlashCommand[];
    onQueryChange(query: string): void;
    onActiveIndexChange(index: number): void;
    onSelect(command: SlashCommand): void;
    onClose(): void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const commands = useMemo(() => {
        const query = state?.query.trim().toLowerCase() ?? '';
        if (!query) return [...commandsProp];
        return commandsProp.filter((command) => {
            const haystack = [command.label, command.group, ...command.keywords]
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
    }, [commandsProp, state?.query]);
    const activeIndex = commands.length
        ? Math.max(0, Math.min(state?.activeIndex ?? 0, commands.length - 1))
        : -1;

    useLayoutEffect(() => {
        if (state) inputRef.current?.focus();
    }, [state]);

    useLayoutEffect(() => {
        if (!state || activeIndex < 0) return;
        optionRefs.current[activeIndex]?.scrollIntoView?.({block: 'nearest'});
    }, [activeIndex, state, commands.length]);

    if (!state) return null;

    return (
        <div
            className="slashCommandPopover"
            role="dialog"
            aria-label="Slash commands"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                    return;
                }
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (commands.length) onActiveIndexChange((activeIndex + 1) % commands.length);
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (commands.length) {
                        onActiveIndexChange((activeIndex - 1 + commands.length) % commands.length);
                    }
                    return;
                }
                if (event.key === 'Enter' && activeIndex >= 0) {
                    event.preventDefault();
                    onSelect(commands[activeIndex]);
                }
            }}
        >
            <input
                ref={inputRef}
                value={state.query}
                aria-label="Search slash commands"
                placeholder="Search"
                onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
            <div className="slashCommandList" role="listbox" aria-label="Slash command results">
                {commands.length ? (
                    commands.map((command, index) => (
                        <button
                            key={slashCommandId(command)}
                            ref={(element) => {
                                optionRefs.current[index] = element;
                            }}
                            type="button"
                            className={index === activeIndex ? 'active' : ''}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseEnter={() => onActiveIndexChange(index)}
                            onClick={() => onSelect(command)}
                        >
                            <span>{command.label}</span>
                            <small>{command.group}</small>
                        </button>
                    ))
                ) : (
                    <div className="slashCommandEmpty">No commands</div>
                )}
            </div>
        </div>
    );
}
