import {blockContents} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import type {RichBlockMeta} from './blockMeta';
import {editableBlockIds, segmentText, type BlockPoint, type EditorSelection} from './selectionModel';

type WordRange = {
    text: string;
    selection: EditorSelection;
};

type WordSegment = {
    text: string;
    startOffset: number;
    endOffset: number;
};

export const wordAtPoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): WordRange | null => {
    const text = blockContents(state, point.blockId);
    const segment = wordSegments(text).find(
        (segment) => point.offset >= segment.startOffset && point.offset <= segment.endOffset,
    );
    if (!segment) return null;
    return {
        text: segment.text,
        selection: {
            type: 'range',
            anchor: {blockId: point.blockId, offset: segment.startOffset},
            focus: {blockId: point.blockId, offset: segment.endOffset},
        },
    };
};

export const findWordOccurrences = (state: CachedState<RichBlockMeta>, word: string): EditorSelection[] => {
    if (!word) return [];
    const selections: EditorSelection[] = [];
    for (const blockId of editableBlockIds(state)) {
        for (const segment of wordSegments(blockContents(state, blockId))) {
            if (segment.text !== word) continue;
            selections.push({
                type: 'range',
                anchor: {blockId, offset: segment.startOffset},
                focus: {blockId, offset: segment.endOffset},
            });
        }
    }
    return selections;
};

const wordSegments = (text: string): WordSegment[] => {
    const segmenter = new Intl.Segmenter(undefined, {granularity: 'word'});
    const segments: WordSegment[] = [];
    for (const segment of segmenter.segment(text)) {
        if (!segment.isWordLike) continue;
        const startOffset = segmentText(text.slice(0, segment.index)).length;
        const endOffset = startOffset + segmentText(segment.segment).length;
        segments.push({text: segment.segment, startOffset, endOffset});
    }
    return segments;
};
