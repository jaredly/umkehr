import type {FormattedBlock} from 'umkehr/block-crdt';
import type {RichBlockMeta} from './blockMeta';
import {segmentText, type SelectionSegment} from './selectionModel';

export type BooleanInlineMark = 'bold' | 'italic' | 'strikethrough';
export type InlineMark = BooleanInlineMark | 'link';

export type LinkTargetRange = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

export const LINK_MARK = 'link';

export const isLinkLikeText = (text: string): boolean => {
    const value = text.trim();
    if (!value || /\s/.test(value)) return false;
    return /^(https?:\/\/|mailto:)[^\s]+$/i.test(value);
};

export const linkHrefForSelectionSegments = (
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    segments: SelectionSegment[],
): string | null => {
    let href: string | null = null;
    for (const segment of segments) {
        const block = blocks.find((candidate) => candidate.id === segment.blockId);
        if (!block) return null;
        for (const run of runsInRange(block, segment.startOffset, segment.endOffset)) {
            const value = run.marks[LINK_MARK];
            if (typeof value !== 'string') return null;
            if (href === null) {
                href = value;
            } else if (href !== value) {
                return null;
            }
        }
    }
    return href;
};

export const linkRangeAroundOffset = (
    block: FormattedBlock<RichBlockMeta>,
    offset: number,
): (LinkTargetRange & {href: string}) | null => {
    return linkRangeAroundOffsetInRuns(block.id, block.runs, offset);
};

export const linkRangeAroundOffsetInRuns = (
    blockId: string,
    blockRuns: FormattedBlock<RichBlockMeta>['runs'],
    offset: number,
): (LinkTargetRange & {href: string}) | null => {
    const runs = runsWithOffsets(blockRuns);
    const target = runs.find((run) => {
        if (typeof run.run.marks[LINK_MARK] !== 'string') return false;
        if (run.startOffset === run.endOffset) return false;
        if (offset === run.endOffset) return false;
        return offset >= run.startOffset && offset <= run.endOffset;
    });
    if (!target) return null;

    const href = target.run.marks[LINK_MARK] as string;
    let startOffset = target.startOffset;
    let endOffset = target.endOffset;
    for (let index = runs.indexOf(target) - 1; index >= 0; index--) {
        if (runs[index].run.marks[LINK_MARK] !== href) break;
        startOffset = runs[index].startOffset;
    }
    for (let index = runs.indexOf(target) + 1; index < runs.length; index++) {
        if (runs[index].run.marks[LINK_MARK] !== href) break;
        endOffset = runs[index].endOffset;
    }

    return {blockId, startOffset, endOffset, href};
};

export const textForSelectionSegments = (
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    segments: SelectionSegment[],
): string =>
    segments
        .map((segment) => {
            const block = blocks.find((candidate) => candidate.id === segment.blockId);
            return block ? textForRange(block, segment.startOffset, segment.endOffset) : '';
        })
        .join('\n');

const runsInRange = (
    block: FormattedBlock<RichBlockMeta>,
    startOffset: number,
    endOffset: number,
): Array<FormattedBlock<RichBlockMeta>['runs'][number]> =>
    runsWithOffsets(block.runs)
        .filter((run) => run.startOffset < endOffset && run.endOffset > startOffset)
        .map((run) => run.run);

const textForRange = (
    block: FormattedBlock<RichBlockMeta>,
    startOffset: number,
    endOffset: number,
): string =>
    runsWithOffsets(block.runs)
        .filter((run) => run.startOffset < endOffset && run.endOffset > startOffset)
        .map((run) => {
            const start = Math.max(0, startOffset - run.startOffset);
            const end = Math.min(run.endOffset, endOffset) - run.startOffset;
            return segmentText(run.run.text).slice(start, end).join('');
        })
        .join('');

const runsWithOffsets = (runs: FormattedBlock<RichBlockMeta>['runs']) => {
    let offset = 0;
    return runs.map((run) => {
        const length = segmentText(run.text).length;
        const result = {run, startOffset: offset, endOffset: offset + length};
        offset += length;
        return result;
    });
};
