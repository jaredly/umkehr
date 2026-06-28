import {describe, expect, it} from 'vitest';
import {rootBlockIds} from 'umkehr/block-crdt';
import {addSlide, convertBlockToSlideDeck, slideChildren, type CommandContext} from 'umkehr/block-editor';
import {createDemoState} from './blockEditorRuntime';
import {caret} from 'umkehr/block-editor';
import {primarySelection, resolveSelectionSet, singleRetainedSelectionSet} from 'umkehr/block-editor';
import {constrainSelectionToFullscreenSlide, type SlidePresentationSelectionUi} from 'umkehr/block-editor';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => `${actor}-${String(i++).padStart(5, '0')}`,
    };
};

const twoSlideDeck = () => {
    const context = ctx();
    const demo = createDemoState();
    const deckId = rootBlockIds(demo.left.state)[0];
    let result = convertBlockToSlideDeck(demo.left.state, caret(deckId, 0), context);
    result = addSlide(result.state, deckId, context);
    const [firstSlideId, secondSlideId] = slideChildren(result.state, deckId);
    return {state: result.state, deckId, firstSlideId, secondSlideId};
};

const ui = (
    deckId: string,
    currentSlideId: string,
    fullScreen: boolean,
): SlidePresentationSelectionUi => ({
    [deckId]: {mode: 'presentation', currentSlideId, fullScreen},
});

describe('fullscreen slide presentation selection constraints', () => {
    it('does not constrain inline presentation mode selections', () => {
        const {state, deckId, firstSlideId, secondSlideId} = twoSlideDeck();
        const selection = singleRetainedSelectionSet(state, caret(secondSlideId, 0));

        const result = constrainSelectionToFullscreenSlide(state, selection, ui(deckId, firstSlideId, false));

        expect(result.fallbackSelection).toBeNull();
        expect(primarySelection(resolveSelectionSet(state, result.selection))).toEqual(caret(secondSlideId, 0));
    });

    it('keeps fullscreen selections inside the current slide', () => {
        const {state, deckId, firstSlideId} = twoSlideDeck();
        const selection = singleRetainedSelectionSet(state, caret(firstSlideId, 0));

        const result = constrainSelectionToFullscreenSlide(state, selection, ui(deckId, firstSlideId, true));

        expect(result.fallbackSelection).toBeNull();
        expect(primarySelection(resolveSelectionSet(state, result.selection))).toEqual(caret(firstSlideId, 0));
    });

    it('falls back to selecting the current slide when a fullscreen selection leaves it', () => {
        const {state, deckId, firstSlideId, secondSlideId} = twoSlideDeck();
        const selection = singleRetainedSelectionSet(state, caret(secondSlideId, 0));

        const result = constrainSelectionToFullscreenSlide(state, selection, ui(deckId, firstSlideId, true));

        expect(result.fallbackSelection).toEqual({
            type: 'block',
            anchorBlockId: firstSlideId,
            focusBlockId: firstSlideId,
        });
        expect(primarySelection(resolveSelectionSet(state, result.selection))).toEqual(result.fallbackSelection);
    });
});
