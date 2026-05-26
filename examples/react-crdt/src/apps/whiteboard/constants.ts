import type {Viewport} from './helpers';

export const noteColors = ['#fff7b8', '#fed7aa', '#bbf7d0', '#bfdbfe', '#fbcfe8'] as const;
export const emojiChoices = ['👍', '⭐', '💡', '✅', '❗', '❤️'] as const;

export type Tool = 'select' | 'note' | 'pen' | 'emoji' | 'erase' | 'pan';
export type NoteColor = (typeof noteColors)[number];
export type EmojiChoice = (typeof emojiChoices)[number];

export const defaultNoteColor: NoteColor = '#fff7b8';
export const defaultEmojiChoice: EmojiChoice = '👍';

export const penColor = '#17202a';
export const strokeWidth = 4;

export const defaultNoteSize = {width: 220, height: 150} as const;
export const minNoteSize = {width: 120, height: 96} as const;
export const defaultEmojiSize = 48;

export const initialViewport: Viewport = {panX: 80, panY: 70, zoom: 0.75};
export const minZoom = 0.2;
export const maxZoom = 2.5;
export const wheelZoomInFactor = 1.08;
export const wheelZoomOutFactor = 0.92;

export const minimapWidth = 120;
export const minimapHeight = 80;

export function labelForTool(tool: Tool) {
    switch (tool) {
        case 'select':
            return 'Select';
        case 'note':
            return 'Note';
        case 'pen':
            return 'Pen';
        case 'emoji':
            return 'Emoji';
        case 'erase':
            return 'Erase';
        case 'pan':
            return 'Pan';
    }
}
