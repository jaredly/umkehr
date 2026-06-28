import type {CachedState} from '../block-crdt/types.js';
import {slideChildren} from './blockCommands';
import type {RichBlockMeta} from './blockMeta';
import {primarySelection, replacePrimarySelection, resolveSelectionSet, type RetainedSelectionSet} from './selectionSet';
import {blockSelection, selectedBlockIdsForSelection, visibleSubtreeBlockIds, type EditorSelection} from './selectionModel';

export type SlidePresentationSelectionUi = Record<
    string,
    {
        mode: string;
        currentSlideId: string | null;
        fullScreen: boolean;
    }
>;

export type SlidePresentationSelectionConstraint = {
    selection: RetainedSelectionSet;
    fallbackSelection: EditorSelection | null;
};

export const constrainSelectionToFullscreenSlide = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    uiByDeckId: SlidePresentationSelectionUi,
): SlidePresentationSelectionConstraint => {
    const boundary = fullscreenSlideBoundary(state, uiByDeckId);
    if (!boundary) return {selection, fallbackSelection: null};

    const resolvedSelection = primarySelection(resolveSelectionSet(state, selection));
    const selectedBlockIds = selectedBlockIdsForSelection(state, resolvedSelection);
    if (selectedBlockIds.length && selectedBlockIds.every((blockId) => boundary.has(blockId))) {
        return {selection, fallbackSelection: null};
    }

    const fallbackSelection = blockSelection(boundary.slideId);
    return {
        selection: replacePrimarySelection(state, selection, fallbackSelection),
        fallbackSelection,
    };
};

const fullscreenSlideBoundary = (
    state: CachedState<RichBlockMeta>,
    uiByDeckId: SlidePresentationSelectionUi,
): (Set<string> & {slideId: string}) | null => {
    for (const [deckId, ui] of Object.entries(uiByDeckId)) {
        if (!ui.fullScreen || ui.mode !== 'presentation') continue;
        const slides = slideChildren(state, deckId);
        const slideId = ui.currentSlideId && slides.includes(ui.currentSlideId) ? ui.currentSlideId : slides[0];
        if (!slideId) continue;
        const boundary = new Set(visibleSubtreeBlockIds(state, slideId)) as Set<string> & {slideId: string};
        boundary.slideId = slideId;
        return boundary;
    }
    return null;
};
