import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {createPatchValidator} from './index';

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

const validator = createPatchValidator(schemas);

describe('patch validation', () => {
    it('accepts a replace with a value matching the schema at the path', () => {
        expect(
            validator.is({
                op: 'replace',
                path: [{type: 'key', key: 'title'}],
                previous: 'Draft',
                value: 'Published',
            }),
        ).toBe(true);
    });

    it('rejects a replace whose value does not match the schema at the path', () => {
        const result = validator.validate({
            op: 'replace',
            path: [{type: 'key', key: 'title'}],
            previous: 'Draft',
            value: 123,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'value',
                expected: 'string',
            });
        }
    });

    it('walks array element schemas', () => {
        expect(
            validator.is({
                op: 'add',
                path: [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 0},
                ],
                value: {id: 'a', done: false},
            }),
        ).toBe(true);
    });

    it('walks record value schemas', () => {
        expect(
            validator.is({
                op: 'add',
                path: [
                    {type: 'key', key: 'byId'},
                    {type: 'key', key: 'abc'},
                ],
                value: 1,
            }),
        ).toBe(true);
    });

    it('requires tagged-union paths to use a tag segment before variant fields', () => {
        const result = validator.validate({
            op: 'replace',
            path: [
                {type: 'key', key: 'shape'},
                {type: 'key', key: 'radius'},
            ],
            previous: 1,
            value: 2,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0].message).toContain('Tagged-union paths must use a tag segment');
        }
    });

    it('uses tag segments to select a union variant', () => {
        expect(
            validator.is({
                op: 'replace',
                path: [
                    {type: 'key', key: 'shape'},
                    {type: 'tag', key: 'type', value: 'circle'},
                    {type: 'key', key: 'radius'},
                ],
                previous: 1,
                value: 2,
            }),
        ).toBe(true);
    });

    it('rejects reorder patches whose path does not point to an array', () => {
        const result = validator.validate({
            op: 'reorder',
            path: [{type: 'key', key: 'title'}],
            indices: [0],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'path',
                expected: 'array',
            });
        }
    });

    it('accepts array move patches', () => {
        expect(
            validator.is({
                op: 'move',
                path: [{type: 'key', key: 'items'}],
                fromIdx: 0,
                targetIdx: 1,
                after: true,
            }),
        ).toBe(true);
    });

    it('rejects move patches whose path does not point to an array', () => {
        const result = validator.validate({
            op: 'move',
            path: [{type: 'key', key: 'title'}],
            fromIdx: 0,
            targetIdx: 1,
            after: false,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'path',
                expected: 'array',
            });
        }
    });

    it('rejects old path-to-path move patches', () => {
        const result = validator.validate({
            op: 'move',
            from: [{type: 'key', key: 'title'}],
            path: [{type: 'key', key: 'items'}],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                path: 'fromIdx',
            });
        }
    });
});
