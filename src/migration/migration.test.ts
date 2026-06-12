import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {applyCrdtUpdate} from '../crdt/apply.js';
import {createCrdtDocument} from '../crdt/document.js';
import type {CrdtLocalHistory} from '../crdt/history.js';
import type {CrdtUpdate} from '../crdt/types.js';
import {
    allPermutationsBounded,
    applyAll,
    duplicateUpdates,
    expectConverged,
    expectNoReadyPending,
} from '../crdt/proofTestHelpers.js';
import type {History} from '../history/history.js';
import type {Patch} from '../types.js';
import {
    defaultCrdtSetObjectValue,
    defaultPatchObjectValue,
    dropCrdtObjectField,
    dropPatchObjectField,
    MigrationError,
    migrateCrdtHistory,
    migrateCrdtUpdates,
    migrateHistory,
    migrateValue,
    renameCrdtObjectField,
    renameCrdtTaggedBranch,
    renamePatchObjectField,
    renamePatchTag,
    resolveMigrationPath,
    type SchemaMigrationConfig,
    type VersionedSchema,
} from './index.js';
import {richTextLeafPlugin} from '../richtext/index.js';

type V1 = {title: string};
type V2 = {title: string; done: boolean};
type V3 = {label: string; done: boolean};

const schemaCollection = {version: '3.1', schemas: [{}], components: {schemas: {}}} as IJsonSchemaCollection<
    '3.1',
    [unknown]
>;
const v1Schema = objectSchema(['title'], {title: {type: 'string'}});
const v2Schema = objectSchema(['title', 'done'], {title: {type: 'string'}, done: {type: 'boolean'}});
const v3Schema = objectSchema(['label', 'done'], {label: {type: 'string'}, done: {type: 'boolean'}});

const v1 = versionedSchema<V1>(1, 'v1-hash', isV1);
const v2 = versionedSchema<V2>(2, 'v2-hash', isV2);
const v3 = versionedSchema<V3>(3, 'v3-hash', isV3);

const config: SchemaMigrationConfig<V3> = {
    current: v3,
    previous: [v1, v2],
    migrations: [
        {
            id: 'v1-to-v2',
            fromVersion: 1,
            toVersion: 2,
            fromFingerprintHash: 'v1-hash',
            toFingerprintHash: 'v2-hash',
            migrateState(input) {
                const state = input as V1;
                return {title: state.title, done: false} satisfies V2;
            },
        },
        {
            id: 'v2-to-v3',
            fromVersion: 2,
            toVersion: 3,
            fromFingerprintHash: 'v2-hash',
            toFingerprintHash: 'v3-hash',
            migrateState(input) {
                const state = input as V2;
                return {label: state.title, done: state.done} satisfies V3;
            },
            migratePatch(input) {
                return renamePatchObjectField(input, 'title', 'label');
            },
            migrateCrdtUpdate(input) {
                return renameCrdtObjectField(input, 'title', 'label');
            },
        },
    ],
};

describe('schema migration core', () => {
    it('finds multi-step migration paths', () => {
        const path = resolveMigrationPath(config, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(path.map((migration) => migration.id)).toEqual(['v1-to-v2', 'v2-to-v3']);
    });

    it('migrates a value through all steps and validates the result', () => {
        const result = migrateValue(config, {title: 'Ship'}, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(result).toMatchObject({
            value: {label: 'Ship', done: false},
            migrationIds: ['v1-to-v2', 'v2-to-v3'],
            fromVersion: 1,
            toVersion: 3,
            fromFingerprintHash: 'v1-hash',
            toFingerprintHash: 'v3-hash',
        });
    });

    it('returns the current value when metadata already matches the current schema', () => {
        const result = migrateValue(config, {label: 'Current', done: true}, {
            schemaVersion: 3,
            schemaFingerprintHash: 'v3-hash',
        });

        expect(result.value).toEqual({label: 'Current', done: true});
        expect(result.migrationIds).toEqual([]);
    });

    it('refuses missing previous schemas', () => {
        expect(() =>
            resolveMigrationPath(
                {...config, previous: [v2]},
                {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
            ),
        ).toThrowMigrationError('missing-source-schema');
    });

    it('refuses downgrades', () => {
        const future = versionedSchema(4, 'v4-hash', (input): input is {next: true} => {
            return isRecord(input) && input.next === true;
        });

        expect(() =>
            resolveMigrationPath(
                {...config, previous: [v1, v2, future]},
                {schemaVersion: 4, schemaFingerprintHash: 'v4-hash'},
            ),
        ).toThrowMigrationError('unsupported-downgrade');
    });

    it('refuses full fingerprint mismatches even when the hash matches', () => {
        expect(() =>
            resolveMigrationPath(config, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
                schemaFingerprint: 'unexpected-full-fingerprint',
            }),
        ).toThrowMigrationError('fingerprint-mismatch');
    });

    it('refuses missing migration paths', () => {
        expect(() =>
            resolveMigrationPath(
                {...config, migrations: [config.migrations[0]]},
                {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
            ),
        ).toThrowMigrationError('missing-migration-path');
    });

    it('propagates source validation failures', () => {
        expect(() =>
            migrateValue(config, {title: 123}, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });

    it('propagates target validation failures', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                {
                    ...config.migrations[0],
                    migrateState() {
                        return {title: 'Missing done'};
                    },
                },
                config.migrations[1],
            ],
        };

        expect(() =>
            migrateValue(badConfig, {title: 'Ship'}, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });
});

describe('history migration core', () => {
    it('migrates local history patches and verifies reachable node replay', () => {
        const result = migrateHistory(config, historyV1(), {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(result.value.initial).toEqual({label: 'Draft', done: false});
        expect(result.value.current).toEqual({label: 'Published', done: false});
        expect(result.value.nodes.edit.changes).toEqual([
            {
                op: 'replace',
                path: [{type: 'key', key: 'label'}],
                previous: 'Draft',
                value: 'Published',
            },
        ]);
        expect(result.value.nodes.branch.changes).toEqual([
            {
                op: 'replace',
                path: [{type: 'key', key: 'label'}],
                previous: 'Draft',
                value: 'Branch',
            },
        ]);
    });

    it('allows unchanged patches when they still validate against the target schema', () => {
        const result = migrateHistory(
            {
                current: v2,
                previous: [v1],
                migrations: [
                    {
                        id: 'v1-to-v2',
                        fromVersion: 1,
                        toVersion: 2,
                        fromFingerprintHash: 'v1-hash',
                        toFingerprintHash: 'v2-hash',
                        migrateState(input) {
                            const state = input as V1;
                            return {title: state.title, done: false} satisfies V2;
                        },
                    },
                ],
            },
            historyV1(),
            {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
        );

        expect(result.value.nodes.edit.changes[0].path).toEqual([{type: 'key', key: 'title'}]);
        expect(result.value.current).toEqual({title: 'Published', done: false});
    });

    it('fails when patch migration is missing for schema-dependent paths', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                config.migrations[0],
                {
                    ...config.migrations[1],
                    migratePatch: undefined,
                },
            ],
        };

        expect(() =>
            migrateHistory(badConfig, historyV1(), {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });

    it('fails when migrated patch replay does not match migrated current state', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                config.migrations[0],
                {
                    ...config.migrations[1],
                    migratePatch(input) {
                        if (input.op === 'replace' && input.path[0]?.type === 'key' && input.path[0].key === 'title') {
                            return {
                                ...input,
                                path: [{type: 'key', key: 'label'}],
                                value: 'Wrong',
                            };
                        }
                        return input;
                    },
                },
            ],
        };

        expect(() =>
            migrateHistory(badConfig, historyV1(), {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('replay-failed');
    });
});

describe('CRDT history migration core', () => {
    it('migrates CRDT history, rewrites update paths, and verifies replay', () => {
        const result = migrateCrdtHistory(config, crdtHistoryV1(), {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(result.value.base.state).toEqual({label: 'Draft', done: false});
        expect(result.value.doc.state).toEqual({label: 'Published', done: false});
        expect(result.value.updates).toHaveLength(1);
        const [update] = result.value.updates;
        expect(update.op).toBe('set');
        if (update.op === 'set') {
            expect(update.path[0]).toMatchObject({type: 'objectField', key: 'label'});
            expect(update.value).toBe('Published');
        }
    });

    it('allows unchanged CRDT updates when they still validate against the target schema', () => {
        const result = migrateCrdtHistory(
            {
                current: v2,
                previous: [v1],
                migrations: [
                    {
                        id: 'v1-to-v2',
                        fromVersion: 1,
                        toVersion: 2,
                        fromFingerprintHash: 'v1-hash',
                        toFingerprintHash: 'v2-hash',
                        migrateState(input) {
                            const state = input as V1;
                            return {title: state.title, done: false} satisfies V2;
                        },
                    },
                ],
            },
            crdtHistoryV1(),
            {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
        );

        expect(result.value.doc.state).toEqual({title: 'Published', done: false});
        const [update] = result.value.updates;
        expect(update.op).toBe('set');
        if (update.op === 'set') expect(update.path[0]).toMatchObject({key: 'title'});
    });

    it('migrates rich-text CRDT update paths through object field renames', () => {
        const richV1 = versionedSchema<unknown>(1, 'rich-v1-hash', (_): _ is unknown => true);
        const richV2 = versionedSchema<unknown>(2, 'rich-v2-hash', (_): _ is unknown => true);
        const update: CrdtUpdate = {
            op: 'leaf',
            plugin: 'umkehr.rich-text',
            path: [{type: 'objectField', key: 'body', parentCreated: baseTs}],
            ts: updateTs,
            change: {
                action: 'insert',
                opId: '1@local:main',
                afterId: null,
                char: 'h',
            },
        };

        const result = migrateCrdtUpdates(
            {
                current: richV2,
                previous: [richV1],
                migrations: [
                    {
                        id: 'rich-v1-to-v2',
                        fromVersion: 1,
                        toVersion: 2,
                        fromFingerprintHash: 'rich-v1-hash',
                        toFingerprintHash: 'rich-v2-hash',
                        migrateState(input) {
                            return input;
                        },
                        migrateCrdtUpdate(input) {
                            return renameCrdtObjectField(input, 'body', 'content');
                        },
                    },
                ],
            },
            [update],
            {schemaVersion: 1, schemaFingerprintHash: 'rich-v1-hash'},
        );

        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toMatchObject({
            op: 'leaf',
            plugin: 'umkehr.rich-text',
            path: [{type: 'objectField', key: 'content'}],
        });
    });

    it('fails when CRDT update migration is missing for renamed paths', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                config.migrations[0],
                {
                    ...config.migrations[1],
                    migrateCrdtUpdate: undefined,
                },
            ],
        };

        expect(() =>
            migrateCrdtHistory(badConfig, crdtHistoryV1(), {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });

    it('fails when migrated CRDT update replay does not match migrated realized state', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                config.migrations[0],
                {
                    ...config.migrations[1],
                    migrateCrdtUpdate(input) {
                        if (input.op === 'set') {
                            return {
                                ...input,
                                path:
                                    input.path[0]?.type === 'objectField' && input.path[0].key === 'title'
                                        ? [{...input.path[0], key: 'label'}, ...input.path.slice(1)]
                                        : input.path,
                                value: 'Wrong',
                            };
                        }
                        return input;
                    },
                },
            ],
        };

        expect(() =>
            migrateCrdtHistory(badConfig, crdtHistoryV1(), {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('replay-failed');
    });

    it('applies pending updates before migration when they can now be resolved', () => {
        const history = crdtHistoryV1();
        history.doc = {
            ...history.base,
            pending: [
                {
                    update: history.updates[0],
                    reason: 'missing-parent',
                    queuedAt: updateTs,
                },
            ],
        };

        const result = migrateCrdtHistory(config, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(result.value.doc.pending).toEqual([]);
        expect(result.value.doc.state).toEqual({label: 'Published', done: false});
    });

    it('fails when pending updates cannot be applied before migration', () => {
        const history = crdtHistoryV1();
        history.doc = {
            ...history.doc,
            pending: [
                {
                    update: {
                        op: 'set',
                        path: [
                            {type: 'objectField', key: 'missing', parentCreated: baseTs},
                            {type: 'objectField', key: 'title', parentCreated: updateTs},
                        ],
                        value: 'No parent',
                        ts: updateTs,
                    },
                    reason: 'missing-parent',
                    queuedAt: updateTs,
                },
            ],
        };

        expect(() =>
            migrateCrdtHistory(config, history, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('replay-failed');
    });
});

describe('CRDT migration invariants', () => {
    it('replays migrated history to the migrated realized state across delivery schedules', () => {
        const result = migrateCrdtHistory(config, crdtHistoryV1(), {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expectCrdtMigrationConverges(result.value);
    });

    it('preserves convergence for helper-driven object field rename', () => {
        const history = crdtHistoryV1();
        const migrated = migrateCrdtHistory(config, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        }).value;

        const [update] = migrated.updates;
        expect(update.op).toBe('set');
        if (update.op === 'set') expect(update.path[0]).toMatchObject({type: 'objectField', key: 'label'});
        expectCrdtMigrationConverges(migrated);
    });

    it('preserves convergence when helper-driven field drops remove obsolete updates', () => {
        type DropV1 = {title: string; obsolete: string};
        type DropV2 = {title: string};
        const dropV1 = versionedSchema<DropV1>(1, 'drop-v1-hash', (input): input is DropV1 => {
            return isRecord(input) && typeof input.title === 'string' && typeof input.obsolete === 'string';
        });
        const dropV2 = versionedSchema<DropV2>(2, 'drop-v2-hash', (input): input is DropV2 => {
            return isRecord(input) && typeof input.title === 'string' && !('obsolete' in input);
        });
        const dropConfig: SchemaMigrationConfig<DropV2> = {
            current: dropV2,
            previous: [dropV1],
            migrations: [
                {
                    id: 'drop-obsolete',
                    fromVersion: 1,
                    toVersion: 2,
                    fromFingerprintHash: 'drop-v1-hash',
                    toFingerprintHash: 'drop-v2-hash',
                    migrateState(input) {
                        return {title: (input as DropV1).title};
                    },
                    migrateCrdtUpdate(input) {
                        return dropCrdtObjectField(input, 'obsolete');
                    },
                },
            ],
        };
        const base = createCrdtDocument({title: 'Draft', obsolete: 'old'}, dropV1.schema, {
            timestamp: baseTs,
        });
        const obsoleteUpdate: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'obsolete', parentCreated: baseTs}],
            value: 'new',
            ts: updateTs,
        };
        const titleUpdate: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: baseTs}],
            value: 'Published',
            ts: '000000000000003:00000:local',
        };
        const history: CrdtLocalHistory<DropV1> = {
            base,
            doc: applyCrdtUpdate(applyCrdtUpdate(base, obsoleteUpdate), titleUpdate),
            updates: [obsoleteUpdate, titleUpdate],
        };

        const migrated = migrateCrdtHistory(dropConfig, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'drop-v1-hash',
        }).value;

        expect(migrated.updates).toHaveLength(1);
        expect(migrated.doc.state).toEqual({title: 'Published'});
        expectCrdtMigrationConverges(migrated);
    });

    it('preserves convergence for helper-driven defaults on object-valued updates', () => {
        type DefaultV1 = {item: {title: string}};
        type DefaultV2 = {item: {title: string; done: boolean}};
        const defaultV1 = versionedSchema<DefaultV1>(1, 'default-v1-hash', (input): input is DefaultV1 => {
            return isRecord(input) && isRecord(input.item) && typeof input.item.title === 'string';
        });
        const defaultV2 = versionedSchema<DefaultV2>(2, 'default-v2-hash', (input): input is DefaultV2 => {
            return (
                isRecord(input) &&
                isRecord(input.item) &&
                typeof input.item.title === 'string' &&
                typeof input.item.done === 'boolean'
            );
        });
        const defaultConfig: SchemaMigrationConfig<DefaultV2> = {
            current: defaultV2,
            previous: [defaultV1],
            migrations: [
                {
                    id: 'default-item-done',
                    fromVersion: 1,
                    toVersion: 2,
                    fromFingerprintHash: 'default-v1-hash',
                    toFingerprintHash: 'default-v2-hash',
                    migrateState(input) {
                        const state = input as DefaultV1;
                        return {item: {...state.item, done: false}};
                    },
                    migrateCrdtUpdate(input) {
                        return defaultCrdtSetObjectValue(input, {done: false});
                    },
                },
            ],
        };
        const base = createCrdtDocument({item: {title: 'Draft'}}, defaultV1.schema, {
            timestamp: baseTs,
        });
        const update: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'item', parentCreated: baseTs}],
            value: {title: 'Published'},
            ts: updateTs,
        };
        const history: CrdtLocalHistory<DefaultV1> = {
            base,
            doc: applyCrdtUpdate(base, update),
            updates: [update],
        };

        const migrated = migrateCrdtHistory(defaultConfig, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'default-v1-hash',
        }).value;

        expect(migrated.doc.state).toEqual({item: {title: 'Published', done: false}});
        expectCrdtMigrationConverges(migrated);
    });

    it('preserves replay order and convergence when one source update expands to many target updates', () => {
        type ExpandV1 = {title: string};
        type ExpandV2 = {label: string; done: boolean};
        const expandV1 = versionedSchema<ExpandV1>(1, 'expand-v1-hash', (input): input is ExpandV1 => {
            return isRecord(input) && typeof input.title === 'string';
        });
        const expandV2 = versionedSchema<ExpandV2>(2, 'expand-v2-hash', (input): input is ExpandV2 => {
            return isRecord(input) && typeof input.label === 'string' && typeof input.done === 'boolean';
        });
        const expandConfig: SchemaMigrationConfig<ExpandV2> = {
            current: expandV2,
            previous: [expandV1],
            migrations: [
                {
                    id: 'expand-title',
                    fromVersion: 1,
                    toVersion: 2,
                    fromFingerprintHash: 'expand-v1-hash',
                    toFingerprintHash: 'expand-v2-hash',
                    migrateState(input) {
                        return {label: (input as ExpandV1).title, done: false};
                    },
                    migrateCrdtUpdate(input) {
                        if (input.op !== 'set') return input;
                        return [
                            {
                                ...input,
                                path: [{...input.path[0], key: 'label'}, ...input.path.slice(1)],
                                value: input.value,
                            },
                            {
                                op: 'set',
                                path: [{type: 'objectField', key: 'done', parentCreated: baseTs}],
                                value: false,
                                ts: '000000000000002:00000:local~migration-default',
                            },
                        ];
                    },
                },
            ],
        };
        const base = createCrdtDocument({title: 'Draft'}, expandV1.schema, {timestamp: baseTs});
        const update: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: baseTs}],
            value: 'Published',
            ts: updateTs,
        };
        const history: CrdtLocalHistory<ExpandV1> = {
            base,
            doc: applyCrdtUpdate(base, update),
            updates: [update],
        };

        const migrated = migrateCrdtHistory(expandConfig, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'expand-v1-hash',
        }).value;

        expect(migrated.updates).toHaveLength(2);
        expect(migrated.doc.state).toEqual({label: 'Published', done: false});
        expectCrdtMigrationConverges(migrated);
    });

    it('preserves tagged-union branch incarnation safety through helper migration', () => {
        type TaggedV1 = {shape: {type: 'todo'; title: string} | {type: 'note'; text: string}};
        type TaggedV2 = {shape: {type: 'task'; title: string} | {type: 'note'; text: string}};
        const taggedV1 = versionedSchema<TaggedV1>(1, 'tagged-v1-hash', isTaggedV1);
        const taggedV2 = versionedSchema<TaggedV2>(2, 'tagged-v2-hash', isTaggedV2);
        const taggedConfig: SchemaMigrationConfig<TaggedV2> = {
            current: taggedV2,
            previous: [taggedV1],
            migrations: [
                {
                    id: 'todo-to-task',
                    fromVersion: 1,
                    toVersion: 2,
                    fromFingerprintHash: 'tagged-v1-hash',
                    toFingerprintHash: 'tagged-v2-hash',
                    migrateState(input) {
                        const state = input as TaggedV1;
                        return state.shape.type === 'todo'
                            ? {shape: {...state.shape, type: 'task'}}
                            : state;
                    },
                    migrateCrdtUpdate(input) {
                        return renameCrdtTaggedBranch(input, 'type', 'todo', 'task');
                    },
                },
            ],
        };
        const base = createCrdtDocument<TaggedV1>(
            {shape: {type: 'todo', title: 'Draft'}},
            taggedV1.schema,
            {timestamp: baseTs},
        );
        const update: CrdtUpdate = {
            op: 'set',
            path: [
                {type: 'objectField', key: 'shape', parentCreated: baseTs},
                {
                    type: 'taggedField',
                    key: 'title',
                    tagKey: 'type',
                    tagValue: 'todo',
                    parentCreated: baseTs,
                    tagTs: baseTs,
                },
            ],
            value: 'Published',
            ts: updateTs,
        };
        const history: CrdtLocalHistory<TaggedV1> = {
            base,
            doc: applyCrdtUpdate(base, update),
            updates: [update],
        };

        const migrated = migrateCrdtHistory(taggedConfig, history, {
            schemaVersion: 1,
            schemaFingerprintHash: 'tagged-v1-hash',
        }).value;

        const [migratedUpdate] = migrated.updates;
        expect(migratedUpdate.op).toBe('set');
        if (migratedUpdate.op === 'set') {
            expect(migratedUpdate.path[1]).toMatchObject({type: 'taggedField', tagValue: 'task'});
        }
        expect(migrated.doc.state).toEqual({shape: {type: 'task', title: 'Published'}});
        expectCrdtMigrationConverges(migrated);
    });
});

describe('migration rewrite helpers', () => {
    it('rewrites and drops object-field patches and CRDT updates', () => {
        const patch = {
            op: 'replace',
            path: [{type: 'key', key: 'title'}],
            previous: 'Draft',
            value: 'Published',
        } satisfies Patch<V1>;
        const update: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'title', parentCreated: baseTs}],
            value: 'Published',
            ts: updateTs,
        };

        expect(renamePatchObjectField(patch, 'title', 'label').path).toEqual([{type: 'key', key: 'label'}]);
        expect(dropPatchObjectField(patch, 'title')).toBeNull();
        const renamed = renameCrdtObjectField(update, 'title', 'label');
        expect(renamed.op).toBe('set');
        if (renamed.op === 'set') expect(renamed.path[0]).toMatchObject({type: 'objectField', key: 'label'});
        expect(dropCrdtObjectField(update, 'title')).toBeNull();

        const richTextUpdate: CrdtUpdate = {
            op: 'leaf',
            plugin: 'umkehr.rich-text',
            path: [{type: 'objectField', key: 'title', parentCreated: baseTs}],
            ts: updateTs,
            change: {
                action: 'insert',
                opId: '1@local:main',
                afterId: null,
                char: 'x',
            },
        };
        expect(renameCrdtObjectField(richTextUpdate, 'title', 'label')).toMatchObject({
            op: 'leaf',
            plugin: 'umkehr.rich-text',
            path: [{type: 'objectField', key: 'label'}],
        });
        expect(dropCrdtObjectField(richTextUpdate, 'title')).toBeNull();
    });

    it('adds object defaults to object-valued patches and CRDT set updates', () => {
        const patch = {
            op: 'add',
            path: [],
            value: {title: 'Draft'},
        } satisfies Patch<V2>;
        const update: CrdtUpdate = {
            op: 'set',
            path: [{type: 'objectField', key: 'item', parentCreated: baseTs}],
            value: {title: 'Draft'},
            ts: updateTs,
        };

        expect(defaultPatchObjectValue(patch, {done: false})).toMatchObject({
            value: {title: 'Draft', done: false},
        });
        expect(defaultCrdtSetObjectValue(update, {done: false})).toMatchObject({
            value: {title: 'Draft', done: false},
        });
    });

    it('rewrites tagged union patch and CRDT branch references', () => {
        const patch = {
            op: 'replace',
            path: [
                {type: 'tag', key: 'type', value: 'todo'},
                {type: 'key', key: 'title'},
            ],
            previous: {type: 'todo', title: 'Draft'},
            value: {type: 'todo', title: 'Published'},
        } satisfies Patch<unknown>;
        const update: CrdtUpdate = {
            op: 'set',
            path: [
                {
                    type: 'taggedField',
                    key: 'title',
                    tagKey: 'type',
                    tagValue: 'todo',
                    parentCreated: baseTs,
                    tagTs: baseTs,
                },
            ],
            value: {type: 'todo', title: 'Published'},
            ts: updateTs,
        };

        expect(renamePatchTag(patch, 'type', 'todo', 'task')).toMatchObject({
            path: [
                {type: 'tag', key: 'type', value: 'task'},
                {type: 'key', key: 'title'},
            ],
            value: {type: 'task', title: 'Published'},
        });
        expect(renameCrdtTaggedBranch(update, 'type', 'todo', 'task')).toMatchObject({
            path: [{type: 'taggedField', tagKey: 'type', tagValue: 'task'}],
            value: {type: 'task', title: 'Published'},
        });
    });
});

expect.extend({
    toThrowMigrationError(received: () => unknown, code: string) {
        try {
            received();
        } catch (error) {
            const pass = error instanceof MigrationError && error.code === code;
            return {
                pass,
                message: () =>
                    pass
                        ? `expected function not to throw MigrationError ${code}`
                        : `expected MigrationError ${code}, got ${String(error)}`,
            };
        }
        return {
            pass: false,
            message: () => `expected function to throw MigrationError ${code}`,
        };
    },
});

declare module 'vitest' {
    interface Assertion<T = unknown> {
        toThrowMigrationError(code: string): T;
    }
}

function versionedSchema<T>(
    version: number,
    fingerprintHash: string,
    guard: (input: unknown) => input is T,
): VersionedSchema<T> {
    return {
        version,
        schema: schemaForHash(fingerprintHash) as IJsonSchemaCollection<'3.1', [T]>,
        fingerprint: `${fingerprintHash}-full`,
        fingerprintHash,
        tagKey: 'type',
        leafPlugins: fingerprintHash.startsWith('rich-') ? [richTextLeafPlugin] : undefined,
        validateState(input): IValidation<T> {
            return guard(input)
                ? {success: true, data: input}
                : {success: false, data: input, errors: [{path: '$input', expected: 'test schema'}]};
        },
    };
}

function historyV1(): History<V1, never> {
    return {
        version: 2,
        initial: {title: 'Draft'},
        current: {title: 'Published'},
        root: 'root',
        tip: 'edit',
        undoTrail: [],
        annotations: {},
        nodes: {
            root: {id: 'root', pid: 'root', children: ['edit', 'branch'], changes: []},
            edit: {
                id: 'edit',
                pid: 'root',
                children: [],
                changes: [
                    {
                        op: 'replace',
                        path: [{type: 'key', key: 'title'}],
                        previous: 'Draft',
                        value: 'Published',
                    },
                ],
            },
            branch: {
                id: 'branch',
                pid: 'root',
                children: [],
                changes: [
                    {
                        op: 'replace',
                        path: [{type: 'key', key: 'title'}],
                        previous: 'Draft',
                        value: 'Branch',
                    },
                ],
            },
        },
    };
}

const baseTs = '000000000000001:00000:seed';
const updateTs = '000000000000002:00000:local';

function crdtHistoryV1(): CrdtLocalHistory<V1> {
    const base = createCrdtDocument({title: 'Draft'}, v1.schema, {
        timestamp: baseTs,
        tagKey: 'type',
    });
    const update: CrdtUpdate = {
        op: 'set',
        path: [{type: 'objectField', key: 'title', parentCreated: baseTs}],
        value: 'Published',
        ts: updateTs,
    };
    return {
        base,
        doc: applyCrdtUpdate(base, update),
        updates: [update],
    };
}

function schemaForHash(fingerprintHash: string) {
    if (fingerprintHash === 'v1-hash') return v1Schema;
    if (fingerprintHash === 'v2-hash') return v2Schema;
    if (fingerprintHash === 'v3-hash') return v3Schema;
    if (fingerprintHash === 'drop-v1-hash') {
        return objectSchema(['title', 'obsolete'], {
            title: {type: 'string'},
            obsolete: {type: 'string'},
        });
    }
    if (fingerprintHash === 'drop-v2-hash') {
        return objectSchema(['title'], {title: {type: 'string'}});
    }
    if (fingerprintHash === 'default-v1-hash') {
        return objectSchema(['item'], {
            item: objectSchemaValue(['title'], {title: {type: 'string'}}),
        });
    }
    if (fingerprintHash === 'default-v2-hash') {
        return objectSchema(['item'], {
            item: objectSchemaValue(['title', 'done'], {
                title: {type: 'string'},
                done: {type: 'boolean'},
            }),
        });
    }
    if (fingerprintHash === 'expand-v1-hash') {
        return objectSchema(['title'], {title: {type: 'string'}});
    }
    if (fingerprintHash === 'expand-v2-hash') {
        return objectSchema(['label', 'done'], {
            label: {type: 'string'},
            done: {type: 'boolean'},
        });
    }
    if (fingerprintHash === 'tagged-v1-hash') return taggedSchema('todo');
    if (fingerprintHash === 'tagged-v2-hash') return taggedSchema('task');
    if (fingerprintHash === 'rich-v1-hash') return richTextObjectSchema('body');
    if (fingerprintHash === 'rich-v2-hash') return richTextObjectSchema('content');
    return schemaCollection;
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
    return {
        version: '3.1',
        schemas: [
            {
                type: 'object',
                required,
                properties,
                additionalProperties: false,
            },
        ],
        components: {schemas: {}},
    } as IJsonSchemaCollection<'3.1', [unknown]>;
}

function objectSchemaValue(required: string[], properties: Record<string, unknown>) {
    return {
        type: 'object',
        required,
        properties,
        additionalProperties: false,
    };
}

function richTextObjectSchema(field: string) {
    return objectSchema([field], {
        [field]: {
            type: 'object',
            properties: {
                kind: {const: 'rich-text'},
                version: {const: 1},
            },
            required: ['kind', 'version'],
            'x-umkehr-leaf-crdt': 'umkehr.rich-text',
            'x-umkehr-leaf-crdt-version': 1,
        },
    });
}

function taggedSchema(todoTag: 'todo' | 'task') {
    return objectSchema(['shape'], {
        shape: {
            discriminator: {propertyName: 'type'},
            oneOf: [
                {
                    type: 'object',
                    required: ['type', 'title'],
                    properties: {
                        type: {const: todoTag},
                        title: {type: 'string'},
                    },
                },
                {
                    type: 'object',
                    required: ['type', 'text'],
                    properties: {
                        type: {const: 'note'},
                        text: {type: 'string'},
                    },
                },
            ],
        },
    });
}

function isV1(input: unknown): input is V1 {
    return isRecord(input) && typeof input.title === 'string';
}

function isV2(input: unknown): input is V2 {
    return isRecord(input) && typeof input.title === 'string' && typeof input.done === 'boolean';
}

function isV3(input: unknown): input is V3 {
    return isRecord(input) && typeof input.label === 'string' && typeof input.done === 'boolean';
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isTaggedV1(input: unknown): input is {shape: {type: 'todo'; title: string} | {type: 'note'; text: string}} {
    if (!isRecord(input) || !isRecord(input.shape)) return false;
    return (
        (input.shape.type === 'todo' && typeof input.shape.title === 'string') ||
        (input.shape.type === 'note' && typeof input.shape.text === 'string')
    );
}

function isTaggedV2(input: unknown): input is {shape: {type: 'task'; title: string} | {type: 'note'; text: string}} {
    if (!isRecord(input) || !isRecord(input.shape)) return false;
    return (
        (input.shape.type === 'task' && typeof input.shape.title === 'string') ||
        (input.shape.type === 'note' && typeof input.shape.text === 'string')
    );
}

function expectCrdtMigrationConverges(history: CrdtLocalHistory<unknown>) {
    const schedules = [
        history.updates,
        history.updates.toReversed(),
        ...allPermutationsBounded(history.updates, 24),
        duplicateUpdates(history.updates.toReversed(), 'all'),
    ];
    const docs = schedules.map((updates) => applyAll(history.base, updates));
    expectConverged([history.doc, ...docs]);
    for (const doc of docs) {
        expectNoReadyPending(doc);
        expect(doc.pending).toEqual([]);
    }
}
