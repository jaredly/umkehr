import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorInlineMarkSpec, BlockEditorPlugin} from './types.js';

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

export const basicMarksPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'basic-marks',
    marks: basicMarkSpecs,
};
