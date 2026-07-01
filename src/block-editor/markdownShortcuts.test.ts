import {describe, expect, it} from 'vitest';

import {
    legacyMarkdownShortcutSpecs,
    markdownShortcutPrefix,
    markdownShortcutPrefixFromSpecs,
} from './markdownShortcuts';
import type {RichBlockMeta} from './blockMeta';

const paragraph = (ts = '0'): RichBlockMeta => ({type: 'paragraph', ts});

describe('markdown shortcuts', () => {
    it('matches unordered list shortcuts through legacy specs', () => {
        expect(markdownShortcutPrefixFromSpecs(legacyMarkdownShortcutSpecs, '- ', paragraph(), () => '1')).toEqual({
            length: 2,
            meta: {type: 'list_item', kind: 'unordered', ts: '1'},
            kind: 'list',
        });
    });

    it('preserves the public markdownShortcutPrefix behavior', () => {
        expect(markdownShortcutPrefix('### ', paragraph(), () => '2')).toEqual({
            length: 4,
            meta: {type: 'heading', level: 3, ts: '2'},
            kind: 'heading',
        });
        expect(markdownShortcutPrefix('[x] ', paragraph(), () => '3')).toEqual({
            length: 4,
            meta: {type: 'todo', checked: true, ts: '3'},
            kind: 'todo',
        });
    });

    it('ignores specs with non-legacy shortcut kinds', () => {
        expect(
            markdownShortcutPrefixFromSpecs(
                [
                    {
                        id: 'custom',
                        match: () => ({
                            length: 1,
                            meta: {type: 'paragraph', ts: '1'},
                            kind: 'custom',
                        }),
                    },
                ],
                '/',
                paragraph(),
                () => '1',
            ),
        ).toBeNull();
    });
});
