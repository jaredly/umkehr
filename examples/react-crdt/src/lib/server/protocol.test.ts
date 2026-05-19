import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {parseServerMessage} from './protocol';

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

describe('parseServerMessage', () => {
    it('parses branch metadata and merge acknowledgements', () => {
        expect(
            parseServerMessage(
                {
                    kind: 'branchUpdate',
                    version: 3,
                    docId: 'doc',
                    branch: {
                        docId: 'doc',
                        branchId: 'feature',
                        name: 'Feature',
                        sourceBranchId: 'main',
                        forkEventIndex: 2,
                        tipEventIndex: 5,
                        createdAt: 'created',
                        updatedAt: 'updated',
                    },
                },
                {docId: 'doc', schema},
            )?.kind,
        ).toBe('branchUpdate');

        expect(
            parseServerMessage(
                {
                    kind: 'ack',
                    version: 3,
                    docId: 'doc',
                    branchId: 'main',
                    mergeId: 'merge-1',
                    eventIndex: 4,
                },
                {docId: 'doc', schema},
            )?.kind,
        ).toBe('ack');
    });

    it('rejects branch messages for another document or malformed branches', () => {
        expect(
            parseServerMessage(
                {
                    kind: 'branchUpdate',
                    version: 3,
                    docId: 'other',
                    branch: {
                        docId: 'other',
                        branchId: 'feature',
                        name: 'Feature',
                        tipEventIndex: 0,
                        createdAt: 'created',
                        updatedAt: 'updated',
                    },
                },
                {docId: 'doc', schema},
            ),
        ).toBeNull();

        expect(
            parseServerMessage(
                {
                    kind: 'branchUpdate',
                    version: 3,
                    docId: 'doc',
                    branch: {
                        docId: 'doc',
                        branchId: '',
                        name: 'Feature',
                        tipEventIndex: 0,
                        createdAt: 'created',
                        updatedAt: 'updated',
                    },
                },
                {docId: 'doc', schema},
            ),
        ).toBeNull();
    });
});
