import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorInlineMarkSpec, BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';

export const basicMarkIds = ['bold', 'italic', 'strikethrough', 'underline'] as const;

export type BasicMarkId = (typeof basicMarkIds)[number];

function basicMarkLabel(id: BasicMarkId): string {
    switch (id) {
        case 'bold':
            return 'Bold';
        case 'italic':
            return 'Italic';
        case 'strikethrough':
            return 'Strikethrough';
        case 'underline':
            return 'Underline';
    }
}

export const basicMarkSpecs: readonly BlockEditorInlineMarkSpec[] = basicMarkIds.map((id) => ({
    id,
    label: basicMarkLabel(id),
}));

export const basicMarkToolbarItems: readonly BlockEditorToolbarItemSpec[] = [
    {id: 'mark:bold', group: 'Inline marks', label: 'Bold', commandId: 'mark:bold', order: 2},
    {id: 'mark:italic', group: 'Inline marks', label: 'Italic', commandId: 'mark:italic', order: 3},
    {
        id: 'mark:strikethrough',
        group: 'Inline marks',
        label: 'Strikethrough',
        commandId: 'mark:strikethrough',
        order: 4,
    },
    {id: 'mark:underline', group: 'Inline marks', label: 'Underline', commandId: 'mark:underline', order: 5},
];

export const basicMarksPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'basic-marks',
    marks: basicMarkSpecs,
    toolbarItems: basicMarkToolbarItems,
};
