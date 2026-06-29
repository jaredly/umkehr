import {
    isSlideDeckFooterMode,
    isSlideTransition,
    slideDeckAspectRatioIsValid,
    type RichBlockMeta,
} from '../blockMeta.js';
import type {BlockEditorPlugin} from './types.js';
import {
    structuralBlockTypeSpec,
    structuralCommands,
    structuralOptionPanels,
    structuralRenderers,
    structuralSlashCommands,
    structuralToolbarItems,
} from './structuralHelpers.js';

export const slidesPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'slides',
    blockTypes: [
        structuralBlockTypeSpec('slide_deck', (meta) =>
            typeof meta.width === 'number' &&
            typeof meta.height === 'number' &&
            slideDeckAspectRatioIsValid(meta.width, meta.height) &&
            isSlideDeckFooterMode(meta.footer),
        ),
        structuralBlockTypeSpec('slide', (meta) =>
            typeof meta.showTitle === 'boolean' && isSlideTransition(meta.transition),
        ),
    ],
    toolbarItems: structuralToolbarItems([
        {value: 'slide-deck', label: 'Slide deck'},
        {value: 'slide', label: 'Slide'},
    ]),
    slashCommands: structuralSlashCommands([
        {value: 'slide-deck', label: 'Slide deck', keywords: ['presentation', 'deck', 'slides']},
        {value: 'slide', label: 'Slide', keywords: ['presentation', 'deck']},
    ]),
    commands: structuralCommands([
        'slides:create-deck',
        'slides:add-slide',
        'slides:set-deck-size',
        'slides:set-deck-footer',
        'slides:set-title-visibility',
        'slides:set-transition',
        'slides:set-presentation-mode',
    ]),
    blockRenderers: structuralRenderers([
        {id: 'slide-deck', blockType: 'slide_deck'},
        {id: 'slide', blockType: 'slide'},
    ]),
    optionPanels: structuralOptionPanels([
        {id: 'slide-deck', blockType: 'slide_deck'},
        {id: 'slide', blockType: 'slide'},
    ]),
};
