import type {CachedState} from '../block-crdt/types.js';
import {isDeleted} from '../block-crdt/index.js';
import type {RichBlockMeta} from './blockMeta';
import {segmentText} from './selectionModel';

export const textSegments = (text: string): string[] => {
    if (/^[\x00-\x7F]*$/.test(text)) return text.split('');
    return segmentText(text);
};

export const visibleCharIdBeforeOffset = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    offset: number,
): string | null => {
    if (offset <= 0) return null;
    let seen = 0;
    let found: string | null = null;

    const visit = (charId: string): boolean => {
        const char = state.state.chars[charId];
        if (!char) return false;
        if (!isDeleted(char)) {
            seen++;
            if (seen === offset) {
                found = charId;
                return true;
            }
        }
        for (const child of state.cache.charContents[charId] ?? []) {
            if (visit(child)) return true;
        }
        return false;
    };

    for (const charId of state.cache.charContents[blockId] ?? []) {
        if (visit(charId)) break;
    }
    return found;
};
