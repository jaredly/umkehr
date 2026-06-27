import {useLayoutEffect, useMemo, useRef} from 'react';
import {
    applyMany,
    blockContents,
    deleteRangeOps,
    isDeleted,
    orderedCharIdsForBlock,
} from 'umkehr/block-crdt';
import type {CachedState, Op} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';

import {annotationVirtualParents} from './annotations';
import type {RichBlockMeta} from './blockMeta';
import type {BlockTypeMenuValue} from './blockEditorTypes';
import type {MultiCommandResult} from './multiSelectionCommands';
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
    | {type: 'block'; value: BlockTypeMenuValue; label: string; group: string; keywords: string[]}
    | {type: 'date-embed'; label: string; group: string; keywords: string[]};

const SLASH_COMMANDS: SlashCommand[] = [
    {type: 'block', value: 'paragraph', label: 'Paragraph', group: 'Block type', keywords: ['text']},
    {type: 'block', value: 'heading1', label: 'Heading 1', group: 'Block type', keywords: ['h1', 'title']},
    {type: 'block', value: 'heading2', label: 'Heading 2', group: 'Block type', keywords: ['h2', 'subtitle']},
    {type: 'block', value: 'heading3', label: 'Heading 3', group: 'Block type', keywords: ['h3']},
    {type: 'block', value: 'unordered', label: 'Bulleted list', group: 'Block type', keywords: ['bullet', 'unordered']},
    {type: 'block', value: 'ordered', label: 'Numbered list', group: 'Block type', keywords: ['number', 'ordered']},
    {type: 'block', value: 'todo', label: 'Todo', group: 'Block type', keywords: ['task', 'checkbox']},
    {type: 'block', value: 'blockquote', label: 'Blockquote', group: 'Block type', keywords: ['quote']},
    {type: 'block', value: 'code', label: 'Code', group: 'Block type', keywords: ['pre']},
    {type: 'block', value: 'mermaid', label: 'Mermaid diagram', group: 'Block type', keywords: ['diagram', 'chart', 'flowchart', 'mermaid']},
    {type: 'block', value: 'vega-lite', label: 'Vega-Lite chart', group: 'Block type', keywords: ['chart', 'graph', 'vega', 'visualization']},
    {type: 'block', value: 'callout-info', label: 'Info callout', group: 'Block type', keywords: ['info']},
    {type: 'block', value: 'callout-warning', label: 'Warning callout', group: 'Block type', keywords: ['warning']},
    {type: 'block', value: 'callout-error', label: 'Error callout', group: 'Block type', keywords: ['error']},
    {type: 'block', value: 'recipe-ingredient', label: 'Ingredient', group: 'Block type', keywords: ['ingredient', 'recipe', 'food', 'line']},
    {type: 'block', value: 'table', label: 'Table', group: 'Block type', keywords: ['grid']},
    {type: 'block', value: 'columns', label: 'Columns', group: 'Block type', keywords: ['columns', 'layout']},
    {type: 'block', value: 'card-columns', label: 'Card columns', group: 'Block type', keywords: ['board', 'cards', 'columns']},
    {type: 'block', value: 'slide-deck', label: 'Slide deck', group: 'Block type', keywords: ['presentation', 'deck', 'slides']},
    {type: 'block', value: 'slide', label: 'Slide', group: 'Block type', keywords: ['presentation', 'deck']},
    {type: 'block', value: 'preview', label: 'Preview', group: 'Block type', keywords: ['link', 'card', 'url']},
    {type: 'date-embed', label: 'Date', group: 'Inline embed', keywords: ['embed', 'calendar']},
];

const slashCommandId = (command: SlashCommand): string =>
    command.type === 'block' ? `block:${command.value}` : command.type;

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
    onQueryChange,
    onActiveIndexChange,
    onSelect,
    onClose,
}: {
    state: SlashMenuState | null;
    onQueryChange(query: string): void;
    onActiveIndexChange(index: number): void;
    onSelect(command: SlashCommand): void;
    onClose(): void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const commands = useMemo(() => {
        const query = state?.query.trim().toLowerCase() ?? '';
        if (!query) return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter((command) => {
            const haystack = [command.label, command.group, ...command.keywords]
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
    }, [state?.query]);
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
