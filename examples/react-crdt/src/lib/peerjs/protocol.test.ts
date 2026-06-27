import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import type {ArtifactStore, SerializedArtifact} from '../artifacts';
import {artifactsForPeerJsHistorySave} from './PeerJsApp';
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

describe('artifactsForPeerJsHistorySave', () => {
    it('serializes the current artifact without creating a new initial artifact', () => {
        const current: SerializedArtifact = {
            id: 'puzzle',
            kind: 'wordsearch-puzzle',
            version: 1,
            fingerprintHash: 'current',
            data: {board: 'current'},
        };
        const regenerated: SerializedArtifact = {
            id: 'puzzle',
            kind: 'wordsearch-puzzle',
            version: 1,
            fingerprintHash: 'regenerated',
            data: {board: 'regenerated'},
        };
        let createInitialCalls = 0;
        const store: ArtifactStore = {
            get() {
                return null;
            },
            manifest() {
                return [current];
            },
            serialize(id) {
                return id === current.id ? current : null;
            },
            load() {},
            createInitial() {
                createInitialCalls += 1;
                return [regenerated];
            },
        };

        expect(artifactsForPeerJsHistorySave(store)).toEqual([current]);
        expect(createInitialCalls).toBe(0);
    });
});
