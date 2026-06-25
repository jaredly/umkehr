import type {FormattedBlock} from 'umkehr/block-crdt';
import type {RichBlockMeta} from './blockMeta';
import {segmentText, type SelectionSegment} from './selectionModel';
import {normalizeCodeLanguage} from './syntaxHighlight';

export type BooleanInlineMark = 'bold' | 'italic' | 'strikethrough';
export type BareInlineMark = BooleanInlineMark | 'code';
export type InlineMark = BareInlineMark | 'link';
export type MathRenderMode = 'inline' | 'display';
export type MathMarkData = true | {display?: boolean};

export type InlineTargetRange = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

export type LinkTargetRange = InlineTargetRange;
export type CodeTargetRange = InlineTargetRange;
export type MathTargetRange = InlineTargetRange;

export const LINK_MARK = 'link';
export const CODE_MARK = 'code';
export const MATH_MARK = 'math';

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

export const isCodeMarkValue = (value: unknown): value is true | string =>
    value === true || typeof value === 'string';

export const normalizeStoredCodeLanguage = (language: string): string => {
    const trimmed = language.trim();
    if (!trimmed) return '';
    return normalizeCodeLanguage(trimmed) ?? trimmed.toLowerCase();
};

export const codeLanguageFromMarkValue = (value: unknown): string =>
    typeof value === 'string' ? normalizeStoredCodeLanguage(value) : '';

export const isMathMarkValue = (value: unknown): value is MathMarkData =>
    value === true ||
    (isRecord(value) &&
        (value.display === undefined || typeof value.display === 'boolean') &&
        Object.keys(value).every((key) => key === 'display'));

export const mathDisplayModeFromMarkValue = (value: unknown): MathRenderMode | null => {
    if (!isMathMarkValue(value)) return null;
    return value !== true && value.display ? 'display' : 'inline';
};

export const mathMarkValueForMode = (mode: MathRenderMode): MathMarkData =>
    mode === 'display' ? {display: true} : true;

export const mathModeForRun = (run: FormattedBlock<RichBlockMeta>['runs'][number]): MathRenderMode | null =>
    mathDisplayModeFromMarkValue(run.marks[MATH_MARK]);

export const isMathRun = (run: FormattedBlock<RichBlockMeta>['runs'][number]): boolean =>
    mathModeForRun(run) !== null;

export const codeLanguageForSelectionSegments = (
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    segments: SelectionSegment[],
): string | null => {
    let language: string | null = null;
    for (const segment of segments) {
        const block = blocks.find((candidate) => candidate.id === segment.blockId);
        if (!block) return null;
        for (const run of runsInRange(block, segment.startOffset, segment.endOffset)) {
            const value = run.marks[CODE_MARK];
            if (!isCodeMarkValue(value)) return null;
            const runLanguage = codeLanguageFromMarkValue(value);
            if (language === null) {
                language = runLanguage;
            } else if (language !== runLanguage) {
                return null;
            }
        }
    }
    return language;
};

export const codeRangeAroundOffset = (
    block: FormattedBlock<RichBlockMeta>,
    offset: number,
): (CodeTargetRange & {language: string}) | null => {
    return codeRangeAroundOffsetInRuns(block.id, block.runs, offset);
};

export const mathRangeAroundOffset = (
    block: FormattedBlock<RichBlockMeta>,
    offset: number,
): (MathTargetRange & {mode: MathRenderMode}) | null => {
    return mathRangeAroundOffsetInRuns(block.id, block.runs, offset);
};

export const mathRangeAroundOffsetInRuns = (
    blockId: string,
    blockRuns: FormattedBlock<RichBlockMeta>['runs'],
    offset: number,
): (MathTargetRange & {mode: MathRenderMode}) | null => {
    const runs = runsWithOffsets(blockRuns);
    const target = runs.find((run) => {
        if (!mathModeForRun(run.run)) return false;
        if (run.startOffset === run.endOffset) return false;
        if (offset === run.endOffset) return false;
        return offset >= run.startOffset && offset <= run.endOffset;
    });
    if (!target) return null;

    const mode = mathModeForRun(target.run)!;
    let startOffset = target.startOffset;
    let endOffset = target.endOffset;
    for (let index = runs.indexOf(target) - 1; index >= 0; index--) {
        if (mathModeForRun(runs[index].run) !== mode) break;
        startOffset = runs[index].startOffset;
    }
    for (let index = runs.indexOf(target) + 1; index < runs.length; index++) {
        if (mathModeForRun(runs[index].run) !== mode) break;
        endOffset = runs[index].endOffset;
    }

    return {blockId, startOffset, endOffset, mode};
};

export const codeRangeAroundOffsetInRuns = (
    blockId: string,
    blockRuns: FormattedBlock<RichBlockMeta>['runs'],
    offset: number,
): (CodeTargetRange & {language: string}) | null => {
    const runs = runsWithOffsets(blockRuns);
    const target = runs.find((run) => {
        if (!isCodeMarkValue(run.run.marks[CODE_MARK])) return false;
        if (run.startOffset === run.endOffset) return false;
        if (offset === run.endOffset) return false;
        return offset >= run.startOffset && offset <= run.endOffset;
    });
    if (!target) return null;

    const language = codeLanguageFromMarkValue(target.run.marks[CODE_MARK]);
    let startOffset = target.startOffset;
    let endOffset = target.endOffset;
    for (let index = runs.indexOf(target) - 1; index >= 0; index--) {
        if (codeLanguageFromMarkValue(runs[index].run.marks[CODE_MARK]) !== language) break;
        if (!isCodeMarkValue(runs[index].run.marks[CODE_MARK])) break;
        startOffset = runs[index].startOffset;
    }
    for (let index = runs.indexOf(target) + 1; index < runs.length; index++) {
        if (codeLanguageFromMarkValue(runs[index].run.marks[CODE_MARK]) !== language) break;
        if (!isCodeMarkValue(runs[index].run.marks[CODE_MARK])) break;
        endOffset = runs[index].endOffset;
    }

    return {blockId, startOffset, endOffset, language};
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
