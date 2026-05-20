import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {createCrdtUpdateValidator} from './index.js';

type State = {
    title: string;
    items: Array<{id: string; done: boolean}>;
    byId: Record<string, number>;
    shape: {type: 'circle'; radius: number} | {type: 'rect'; width: number};
};

const schemas: IJsonSchemaCollection<'3.1', [State]> = {
    version: '3.1',
    schemas: [{$ref: '#/components/schemas/State'}],
    components: {
        schemas: {
            State: {
                type: 'object',
                required: ['title', 'items', 'byId', 'shape'],
                properties: {
                    title: {type: 'string'},
                    items: {$ref: '#/components/schemas/Items'},
                    byId: {
                        type: 'object',
                        additionalProperties: {type: 'number'},
                    },
                    shape: {
                        oneOf: [
                            {$ref: '#/components/schemas/Circle'},
                            {$ref: '#/components/schemas/Rect'},
                        ],
                        discriminator: {propertyName: 'type'},
                    },
                },
            },
            Items: {
                type: 'array',
                items: {$ref: '#/components/schemas/Item'},
            },
            Item: {
                type: 'object',
                required: ['id', 'done'],
                properties: {
                    id: {type: 'string'},
                    done: {type: 'boolean'},
                },
            },
            Circle: {
                type: 'object',
                required: ['type', 'radius'],
                properties: {
                    type: {const: 'circle'},
                    radius: {type: 'number'},
                },
            },
            Rect: {
                type: 'object',
                required: ['type', 'width'],
                properties: {
                    type: {const: 'rect'},
                    width: {type: 'number'},
                },
            },
        },
    },
};

const ts = '000000000000001:00000:left';
const validator = createCrdtUpdateValidator(schemas);

describe('CRDT update validation', () => {
    it('accepts a set update whose value matches the schema at the CRDT path', () => {
        expect(
            validator.is({
                op: 'set',
                path: [{type: 'objectField', key: 'title', parentCreated: ts}],
                value: 'Published',
                ts,
            }),
        ).toBe(true);
    });

    it('accepts update metadata', () => {
        expect(
            validator.is({
                op: 'set',
                path: [{type: 'objectField', key: 'title', parentCreated: ts}],
                value: 'Published',
                ts,
                meta: {
                    commandId: ts,
                    commandSeq: 0,
                    intent: 'edit',
                },
            }),
        ).toBe(true);
    });

    it('accepts suffixed HLC timestamps', () => {
        const suffixed = `${ts}~migration-1`;
        expect(
            validator.is({
                op: 'set',
                path: [{type: 'objectField', key: 'title', parentCreated: suffixed}],
                value: 'Published',
                ts: suffixed,
            }),
        ).toBe(true);
    });

    it('rejects malformed HLC timestamps', () => {
        const result = validator.validate({
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: ts}],
            value: 'Published',
            ts: 'not-a-timestamp',
        });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.errors[0].path).toBe('ts');
    });

    it('rejects undo metadata without a target command', () => {
        const result = validator.validate({
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: ts}],
            value: 'Published',
            ts,
            meta: {
                commandId: ts,
                commandSeq: 0,
                intent: 'undo',
            },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'meta/targetCommandId',
            });
        }
    });

    it('rejects edit metadata with a target command', () => {
        const result = validator.validate({
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: ts}],
            value: 'Published',
            ts,
            meta: {
                commandId: ts,
                commandSeq: 0,
                intent: 'edit',
                targetCommandId: ts,
            },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'meta/targetCommandId',
            });
        }
    });

    it('rejects a set update whose value does not match the schema at the CRDT path', () => {
        const result = validator.validate({
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: ts}],
            value: 123,
            ts,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'value',
                expected: 'string',
            });
        }
    });

    it('walks array item schemas', () => {
        expect(
            validator.is({
                op: 'set',
                path: [
                    {type: 'objectField', key: 'items', parentCreated: ts},
                    {
                        type: 'arrayItem',
                        id: 'item-a',
                        parentCreated: ts,
                        order: {value: 'a0', ts},
                    },
                ],
                value: {id: 'a', done: false},
                ts,
            }),
        ).toBe(true);
    });

    it('walks record value schemas', () => {
        expect(
            validator.is({
                op: 'set',
                path: [
                    {type: 'objectField', key: 'byId', parentCreated: ts},
                    {type: 'recordEntry', key: 'abc', parentCreated: ts},
                ],
                value: 1,
                ts,
            }),
        ).toBe(true);
    });

    it('rejects objectField where the schema requires a recordEntry segment', () => {
        const result = validator.validate({
            op: 'set',
            path: [
                {type: 'objectField', key: 'byId', parentCreated: ts},
                {type: 'objectField', key: 'abc', parentCreated: ts},
            ],
            value: 1,
            ts,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0].message).toContain('not defined by the object schema');
        }
    });

    it('uses taggedField segments to select tagged-union branches', () => {
        expect(
            validator.is({
                op: 'set',
                path: [
                    {type: 'objectField', key: 'shape', parentCreated: ts},
                    {
                        type: 'taggedField',
                        key: 'radius',
                        tagKey: 'type',
                        tagValue: 'circle',
                        parentCreated: ts,
                        tagTs: ts,
                    },
                ],
                value: 2,
                ts,
            }),
        ).toBe(true);
    });

    it('rejects tagged-union navigation without a taggedField segment', () => {
        const result = validator.validate({
            op: 'set',
            path: [
                {type: 'objectField', key: 'shape', parentCreated: ts},
                {type: 'objectField', key: 'radius', parentCreated: ts},
            ],
            value: 2,
            ts,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0].message).toContain('Tagged-union paths must use a taggedField segment');
        }
    });

    it('accepts setOrder updates whose arrayPath points to an array', () => {
        expect(
            validator.is({
                op: 'setOrder',
                arrayPath: [{type: 'objectField', key: 'items', parentCreated: ts}],
                orders: {
                    'item-a': {value: 'a0', ts},
                    'item-b': {value: 'a1', ts},
                },
            }),
        ).toBe(true);
    });

    it('rejects setOrder updates whose arrayPath does not point to an array', () => {
        const result = validator.validate({
            op: 'setOrder',
            arrayPath: [{type: 'objectField', key: 'title', parentCreated: ts}],
            orders: {'item-a': {value: 'a0', ts}},
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'arrayPath',
                expected: 'array',
            });
        }
    });

    it('rejects structurally invalid updates before schema validation', () => {
        const result = validator.validate({
            op: 'delete',
            path: [{type: 'arrayItem', id: '', parentCreated: ts}],
            ts,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'path/0/id',
            });
        }
    });
});
