import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {MAX_PEER_EPHEMERAL_BYTES, parsePeerMessage, type PeerProtocolConfig} from './protocol';

type State = {title: string};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const config: PeerProtocolConfig<State> = {
    docId: 'doc',
    tagKey: 'type',
    schema,
    validateState(input): IValidation<State> {
        return {success: true, data: input as State};
    },
};

describe('parsePeerMessage', () => {
    it('parses valid ephemeral messages', () => {
        expect(
            parsePeerMessage(
                {
                    kind: 'ephemeral',
                    version: 1,
                    actor: 'actor-1',
                    docId: 'doc',
                    messages: [
                        {
                            kind: 'whiteboard:element-preview',
                            id: 'preview-1',
                            actor: 'actor-1',
                            path: [
                                {type: 'key', key: 'elements'},
                                {type: 'key', key: 'note-1'},
                            ],
                            data: {type: 'element-preview', elementId: 'note-1', x: 10, y: 20},
                        },
                    ],
                },
                config,
            ),
        ).toMatchObject({
            kind: 'ephemeral',
            actor: 'actor-1',
            messages: [{id: 'preview-1'}],
        });
    });

    it('rejects malformed ephemeral envelopes', () => {
        expect(
            parsePeerMessage(
                {
                    kind: 'ephemeral',
                    version: 1,
                    actor: 'actor-1',
                    docId: 'doc',
                    messages: [
                        {
                            kind: 'whiteboard:element-preview',
                            id: 'preview-1',
                            actor: 'actor-2',
                            data: {type: 'element-preview', elementId: 'note-1', x: 10, y: 20},
                        },
                    ],
                },
                config,
            ),
        ).toBeNull();

        expect(
            parsePeerMessage(
                {
                    kind: 'ephemeral',
                    version: 1,
                    actor: 'actor-1',
                    docId: 'doc',
                    messages: [
                        {
                            kind: 'whiteboard:element-preview',
                            id: 'preview-1',
                            actor: 'actor-1',
                            path: [{type: 'unknown', key: 'elements'}],
                            data: {type: 'element-preview', elementId: 'note-1', x: 10, y: 20},
                        },
                    ],
                },
                config,
            ),
        ).toBeNull();
    });

    it('rejects oversized ephemeral batches', () => {
        expect(
            parsePeerMessage(
                {
                    kind: 'ephemeral',
                    version: 1,
                    actor: 'actor-1',
                    docId: 'doc',
                    messages: [
                        {
                            kind: 'whiteboard:element-preview',
                            id: 'preview-1',
                            actor: 'actor-1',
                            data: {value: 'x'.repeat(MAX_PEER_EPHEMERAL_BYTES)},
                        },
                    ],
                },
                config,
            ),
        ).toBeNull();
    });
});
