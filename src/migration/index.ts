import type {IJsonSchemaCollection, IValidation} from 'typia';
import {applyCrdtUpdate} from '../crdt/apply.js';
import {createCrdtDocument} from '../crdt/document.js';
import type {CrdtLocalHistory} from '../crdt/history.js';
import {versionOf} from '../crdt/metadata.js';
import type {
    CrdtDocument,
    CrdtPathSegment,
    CrdtUpdate,
    JsonValue,
    PendingUpdate,
} from '../crdt/types.js';
import type {LeafCrdtPluginAny} from '../crdt/plugins.js';
import {createCrdtUpdateValidator} from '../crdt/validation.js';
import {collectRequiredLeafPlugins} from '../crdt/schema.js';
import {deepEqual} from '../deepEqual.js';
import type {History} from '../history/history.js';
import {ops} from '../ops.js';
import type {PathSegment, Patch} from '../types.js';
import {createPatchValidator} from '../validation/index.js';

export type VersionedSchema<TState> = {
    version: number;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    fingerprint: string;
    fingerprintHash: string;
    tagKey: string;
    leafPlugins?: readonly LeafCrdtPluginAny[];
    validateState(input: unknown): IValidation<TState>;
};

export type SchemaMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprintHash: string;
    toFingerprintHash: string;
    migrateState(input: TFrom): TTo;
    migratePatch?(input: Patch<TFrom>): Patch<TTo> | Patch<TTo>[] | null;
    migrateCrdtUpdate?(input: CrdtUpdate): CrdtUpdate | CrdtUpdate[] | null;
};

export type ObjectDefaults = Record<string, JsonValue>;

export type SchemaMigrationConfig<TCurrent> = {
    current: VersionedSchema<TCurrent>;
    previous: VersionedSchema<unknown>[];
    migrations: SchemaMigration<unknown, unknown>[];
};

export type SchemaVersionMetadata = {
    schemaVersion: number;
    schemaFingerprintHash: string;
    schemaFingerprint?: string;
};

export type MigrationResult<T> = {
    value: T;
    migrationIds: string[];
    fromVersion: number;
    toVersion: number;
    fromFingerprintHash: string;
    toFingerprintHash: string;
};

export type MigrationErrorCode =
    | 'missing-source-schema'
    | 'missing-target-schema'
    | 'missing-migration-path'
    | 'unsupported-downgrade'
    | 'fingerprint-mismatch'
    | 'validation-failed'
    | 'replay-failed';

export class MigrationError extends Error {
    constructor(
        readonly code: MigrationErrorCode,
        message: string,
        readonly details: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = 'MigrationError';
    }
}

export function resolveMigrationPath<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    from: SchemaVersionMetadata,
): SchemaMigration<unknown, unknown>[] {
    const source = schemaFor(config, from);
    if (!source) {
        throw new MigrationError(
            'missing-source-schema',
            `No schema is registered for version ${from.schemaVersion} and fingerprint hash ${from.schemaFingerprintHash}.`,
            {from},
        );
    }
    assertFingerprintMatch(source, from);

    if (from.schemaVersion > config.current.version) {
        throw new MigrationError(
            'unsupported-downgrade',
            `Cannot migrate from future schema version ${from.schemaVersion} to ${config.current.version}.`,
            {fromVersion: from.schemaVersion, toVersion: config.current.version},
        );
    }

    if (from.schemaVersion === config.current.version) {
        if (from.schemaFingerprintHash !== config.current.fingerprintHash) {
            throw new MigrationError(
                'fingerprint-mismatch',
                `Schema version ${from.schemaVersion} has fingerprint hash ${from.schemaFingerprintHash}, not current hash ${config.current.fingerprintHash}.`,
                {
                    schemaVersion: from.schemaVersion,
                    expectedFingerprintHash: config.current.fingerprintHash,
                    actualFingerprintHash: from.schemaFingerprintHash,
                },
            );
        }
        return [];
    }

    const path: SchemaMigration<unknown, unknown>[] = [];
    let version = from.schemaVersion;
    let fingerprintHash = from.schemaFingerprintHash;
    const seen = new Set<string>();

    while (version < config.current.version) {
        const key = `${version}:${fingerprintHash}`;
        if (seen.has(key)) {
            throw new MigrationError('missing-migration-path', 'Migration path contains a cycle.', {
                from,
                currentVersion: version,
                currentFingerprintHash: fingerprintHash,
            });
        }
        seen.add(key);

        const next = config.migrations.find(
            (migration) =>
                migration.fromVersion === version &&
                migration.fromFingerprintHash === fingerprintHash &&
                migration.toVersion > migration.fromVersion &&
                migration.toVersion <= config.current.version,
        );
        if (!next) {
            throw new MigrationError(
                'missing-migration-path',
                `No migration step is registered from version ${version} and fingerprint hash ${fingerprintHash}.`,
                {from, currentVersion: version, currentFingerprintHash: fingerprintHash},
            );
        }

        const target = schemaFor(config, {
            schemaVersion: next.toVersion,
            schemaFingerprintHash: next.toFingerprintHash,
        });
        if (!target) {
            throw new MigrationError(
                'missing-target-schema',
                `No target schema is registered for migration "${next.id}".`,
                {
                    migrationId: next.id,
                    toVersion: next.toVersion,
                    toFingerprintHash: next.toFingerprintHash,
                },
            );
        }
        assertFingerprintMatch(target, {
            schemaVersion: next.toVersion,
            schemaFingerprintHash: next.toFingerprintHash,
        });

        path.push(next);
        version = next.toVersion;
        fingerprintHash = next.toFingerprintHash;
    }

    if (version !== config.current.version || fingerprintHash !== config.current.fingerprintHash) {
        throw new MigrationError(
            'missing-migration-path',
            `Migration path ended at version ${version} and fingerprint hash ${fingerprintHash}, not the current schema.`,
            {
                from,
                endedAtVersion: version,
                endedAtFingerprintHash: fingerprintHash,
                currentVersion: config.current.version,
                currentFingerprintHash: config.current.fingerprintHash,
            },
        );
    }

    return path;
}

export function migrateValue<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    value: unknown,
    from: SchemaVersionMetadata,
): MigrationResult<TCurrent> {
    const source = schemaFor(config, from);
    if (!source) {
        throw new MigrationError(
            'missing-source-schema',
            `No schema is registered for version ${from.schemaVersion} and fingerprint hash ${from.schemaFingerprintHash}.`,
            {from},
        );
    }
    assertFingerprintMatch(source, from);
    let currentValue = assertValid(source, value, 'source');
    const path = resolveMigrationPath(config, from);

    for (const migration of path) {
        currentValue = migration.migrateState(currentValue);
        const target = schemaFor(config, {
            schemaVersion: migration.toVersion,
            schemaFingerprintHash: migration.toFingerprintHash,
        });
        if (!target) {
            throw new MigrationError(
                'missing-target-schema',
                `No target schema is registered for migration "${migration.id}".`,
                {
                    migrationId: migration.id,
                    toVersion: migration.toVersion,
                    toFingerprintHash: migration.toFingerprintHash,
                },
            );
        }
        currentValue = assertValid(target, currentValue, 'target', migration.id);
    }

    const current = assertValid(config.current, currentValue, 'target');
    return {
        value: current,
        migrationIds: path.map((migration) => migration.id),
        fromVersion: from.schemaVersion,
        toVersion: config.current.version,
        fromFingerprintHash: from.schemaFingerprintHash,
        toFingerprintHash: config.current.fingerprintHash,
    };
}

export function migrateHistory<TCurrent, An>(
    config: SchemaMigrationConfig<TCurrent>,
    history: History<unknown, An>,
    from: SchemaVersionMetadata,
): MigrationResult<History<TCurrent, An>> {
    const source = schemaFor(config, from);
    if (!source) {
        throw new MigrationError(
            'missing-source-schema',
            `No schema is registered for version ${from.schemaVersion} and fingerprint hash ${from.schemaFingerprintHash}.`,
            {from},
        );
    }
    assertFingerprintMatch(source, from);
    const path = resolveMigrationPath(config, from);
    const migratedInitial = migrateValue(config, history.initial, from).value;
    const migratedCurrent = migrateValue(config, history.current, from).value;
    const nodes: History<TCurrent, An>['nodes'] = {};

    for (const [id, node] of Object.entries(history.nodes)) {
        nodes[id] = {
            id: node.id,
            pid: node.pid,
            children: node.children.slice(),
            changes: migratePatchList(config, node.changes, from, path),
        };
    }

    const migrated: History<TCurrent, An> = {
        version: 2,
        initial: migratedInitial,
        nodes,
        annotations: history.annotations,
        root: history.root,
        tip: history.tip,
        current: migratedCurrent,
        undoTrail: history.undoTrail.slice(),
    };

    const replayed = replayHistory(migrated);
    if (!deepEqual(replayed.get(migrated.tip), migrated.current)) {
        throw new MigrationError(
            'replay-failed',
            'Migrated history replay does not match the migrated current state.',
            {
                tip: migrated.tip,
                replayed: replayed.get(migrated.tip),
                current: migrated.current,
            },
        );
    }
    return {
        value: migrated,
        migrationIds: path.map((migration) => migration.id),
        fromVersion: from.schemaVersion,
        toVersion: config.current.version,
        fromFingerprintHash: from.schemaFingerprintHash,
        toFingerprintHash: config.current.fingerprintHash,
    };
}

export function migrateCrdtHistory<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    history: CrdtLocalHistory<unknown>,
    from: SchemaVersionMetadata,
): MigrationResult<CrdtLocalHistory<TCurrent>> {
    const path = resolveMigrationPath(config, from);
    const settledBase = settlePendingDocument(history.base, 'base');
    const settledDoc = settlePendingDocument(history.doc, 'doc');
    const migratedBaseState = migrateValue(config, settledBase.state, from).value;
    const migratedRealizedState = migrateValue(config, settledDoc.state, from).value;
    const timestamp = versionOf(settledBase.meta) ?? '000000000000000:00000:migration';
    const migratedBase = createCrdtDocument(migratedBaseState, config.current.schema, {
        timestamp,
        tagKey: config.current.tagKey,
        leafPlugins: config.current.leafPlugins,
    });
    const migratedUpdates = migrateCrdtUpdateList(config, history.updates, from, path);
    let replayed = migratedBase;
    for (const update of migratedUpdates) replayed = applyCrdtUpdate(replayed, update);

    if (replayed.pending.length) {
        throw new MigrationError(
            'replay-failed',
            'Migrated CRDT updates left pending updates after replay.',
            {pending: replayed.pending},
        );
    }
    if (!deepEqual(replayed.state, migratedRealizedState)) {
        throw new MigrationError(
            'replay-failed',
            'Migrated CRDT update replay does not match the migrated realized state.',
            {replayed: replayed.state, realized: migratedRealizedState},
        );
    }

    return {
        value: {
            base: migratedBase,
            doc: replayed,
            updates: migratedUpdates,
        },
        migrationIds: path.map((migration) => migration.id),
        fromVersion: from.schemaVersion,
        toVersion: config.current.version,
        fromFingerprintHash: from.schemaFingerprintHash,
        toFingerprintHash: config.current.fingerprintHash,
    };
}

export function migrateCrdtUpdates<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    updates: CrdtUpdate[],
    from: SchemaVersionMetadata,
): MigrationResult<CrdtUpdate[]> {
    const path = resolveMigrationPath(config, from);
    const migratedUpdates = migrateCrdtUpdateList(config, updates, from, path);
    return {
        value: migratedUpdates,
        migrationIds: path.map((migration) => migration.id),
        fromVersion: from.schemaVersion,
        toVersion: config.current.version,
        fromFingerprintHash: from.schemaFingerprintHash,
        toFingerprintHash: config.current.fingerprintHash,
    };
}

export function renamePatchObjectField<T>(patch: Patch<T>, fromKey: string | number, toKey: string | number): Patch<T> {
    return {...patch, path: renamePatchPathKey(patch.path, fromKey, toKey)} as Patch<T>;
}

export function dropPatchObjectField<T>(patch: Patch<T>, key: string | number): Patch<T> | null {
    return patch.path[0]?.type === 'key' && patch.path[0].key === key ? null : patch;
}

export function defaultPatchObjectValue<T>(patch: Patch<T>, defaults: ObjectDefaults): Patch<T> {
    if (patch.op === 'replace') {
        return {
            ...patch,
            value: isRecord(patch.value) ? withObjectDefaults(patch.value, defaults) : patch.value,
            previous: isRecord(patch.previous) ? withObjectDefaults(patch.previous, defaults) : patch.previous,
        } as Patch<T>;
    }
    if ((patch.op === 'add' || patch.op === 'remove') && isRecord(patch.value)) {
        return {...patch, value: withObjectDefaults(patch.value, defaults)} as Patch<T>;
    }
    return patch;
}

export function renamePatchTag<T>(patch: Patch<T>, tagKey: string, fromValue: string, toValue: string): Patch<T> {
    const path = patch.path.map((segment) =>
        segment.type === 'tag' && segment.key === tagKey && segment.value === fromValue
            ? {...segment, value: toValue}
            : segment,
    );
    const next = {...patch, path} as Patch<T>;
    if (next.op === 'replace') {
        return {
            ...next,
            value: isRecord(next.value) ? renameTagValue(next.value, tagKey, fromValue, toValue) : next.value,
            previous: isRecord(next.previous)
                ? renameTagValue(next.previous, tagKey, fromValue, toValue)
                : next.previous,
        } as Patch<T>;
    }
    if ((next.op === 'add' || next.op === 'remove') && isRecord(next.value)) {
        return {...next, value: renameTagValue(next.value, tagKey, fromValue, toValue)} as Patch<T>;
    }
    return next;
}

export function renameCrdtObjectField(update: CrdtUpdate, fromKey: string, toKey: string): CrdtUpdate {
    if (update.op === 'setOrder') return {...update, arrayPath: renameCrdtPathObjectField(update.arrayPath, fromKey, toKey)};
    if (update.op === 'insert') return {...update, arrayPath: renameCrdtPathObjectField(update.arrayPath, fromKey, toKey)};
    return {...update, path: renameCrdtPathObjectField(update.path, fromKey, toKey)};
}

export function dropCrdtObjectField(update: CrdtUpdate, key: string): CrdtUpdate | null {
    const path = update.op === 'setOrder' || update.op === 'insert' ? update.arrayPath : update.path;
    return path[0]?.type === 'objectField' && path[0].key === key ? null : update;
}

export function defaultCrdtSetObjectValue(update: CrdtUpdate, defaults: ObjectDefaults): CrdtUpdate {
    if (update.op === 'set' && isJsonObject(update.value)) {
        return {...update, value: withJsonObjectDefaults(update.value, defaults)};
    }
    return update;
}

export function renameCrdtTaggedBranch(update: CrdtUpdate, tagKey: string, fromValue: string, toValue: string): CrdtUpdate {
    if (update.op === 'setOrder') {
        return {...update, arrayPath: renameCrdtTaggedPath(update.arrayPath, tagKey, fromValue, toValue)};
    }
    if (update.op === 'insert') {
        return {
            ...update,
            arrayPath: renameCrdtTaggedPath(update.arrayPath, tagKey, fromValue, toValue),
            value: isJsonObject(update.value)
                ? renameJsonTagValue(update.value, tagKey, fromValue, toValue)
                : update.value,
        };
    }
    const path = renameCrdtTaggedPath(update.path, tagKey, fromValue, toValue);
    if (update.op === 'set' && isJsonObject(update.value)) {
        return {...update, path, value: renameJsonTagValue(update.value, tagKey, fromValue, toValue)};
    }
    return {...update, path};
}

export function schemaFingerprintInput<TState>(
    schema: IJsonSchemaCollection<'3.1', [TState]>,
    tagKey = 'type',
) {
    return {
        root: schema.schemas[0],
        components: schema.components,
        tagKey,
        leafPlugins: collectRequiredLeafPlugins(schema.schemas[0], schema.components),
    };
}

export function schemaFingerprint<TState>(
    schema: IJsonSchemaCollection<'3.1', [TState]>,
    tagKey = 'type',
) {
    return stableStringify(schemaFingerprintInput(schema, tagKey));
}

export function schemaFingerprintHash<TState>(
    schema: IJsonSchemaCollection<'3.1', [TState]>,
    tagKey = 'type',
) {
    return sha256Hex(schemaFingerprint(schema, tagKey));
}

export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

export function sha256Hex(input: string): string {
    const bytes = utf8Bytes(input);
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 4, bitLength, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let i = 0; i < 64; i++) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
        .map((word) => word.toString(16).padStart(8, '0'))
        .join('');
}

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number) {
    return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(input: string) {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff) {
            const next = input.charCodeAt(++i);
            code = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        } else {
            bytes.push(
                0xe0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        }
    }
    return new Uint8Array(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renamePatchPathKey(path: PathSegment[], fromKey: string | number, toKey: string | number): PathSegment[] {
    return path.map((segment) =>
        segment.type === 'key' && segment.key === fromKey ? {...segment, key: toKey} : segment,
    );
}

function renameCrdtPathObjectField(path: CrdtUpdatePath, fromKey: string, toKey: string): CrdtUpdatePath {
    return path.map((segment) =>
        segment.type === 'objectField' && segment.key === fromKey ? {...segment, key: toKey} : segment,
    );
}

function renameCrdtTaggedPath(path: CrdtUpdatePath, tagKey: string, fromValue: string, toValue: string): CrdtUpdatePath {
    return path.map((segment) =>
        segment.type === 'taggedField' && segment.tagKey === tagKey && segment.tagValue === fromValue
            ? {...segment, tagValue: toValue}
            : segment,
    );
}

type CrdtUpdatePath = CrdtPathSegment[];

function withObjectDefaults(value: Record<string, unknown>, defaults: ObjectDefaults): Record<string, unknown> {
    const next = {...value};
    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (!(key in next)) next[key] = defaultValue;
    }
    return next;
}

function renameTagValue(value: Record<string, unknown>, tagKey: string, fromValue: string, toValue: string) {
    return value[tagKey] === fromValue ? {...value, [tagKey]: toValue} : value;
}

type JsonObject = {[key: string]: JsonValue | undefined};

function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withJsonObjectDefaults(value: JsonObject, defaults: ObjectDefaults): JsonObject {
    const next: JsonObject = {...value};
    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (!(key in next)) next[key] = defaultValue;
    }
    return next;
}

function renameJsonTagValue(value: JsonObject, tagKey: string, fromValue: string, toValue: string): JsonObject {
    return value[tagKey] === fromValue ? {...value, [tagKey]: toValue} : value;
}

function migratePatchList<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    patches: Patch<unknown>[],
    from: SchemaVersionMetadata,
    path: SchemaMigration<unknown, unknown>[],
): Patch<TCurrent>[] {
    let currentPatches = patches;
    let currentSchema = requiredSchemaFor(config, from);
    validatePatches(currentSchema, currentPatches, 'source');

    for (const migration of path) {
        currentPatches = currentPatches.flatMap((patch) => {
            const migrated = migration.migratePatch
                ? migration.migratePatch(patch)
                : patch;
            if (migrated === null) return [];
            return Array.isArray(migrated) ? migrated : [migrated];
        });
        currentSchema = requiredSchemaFor(config, {
            schemaVersion: migration.toVersion,
            schemaFingerprintHash: migration.toFingerprintHash,
        });
        validatePatches(currentSchema, currentPatches, 'target', migration.id);
    }

    return currentPatches as Patch<TCurrent>[];
}

function migrateCrdtUpdateList<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    updates: CrdtUpdate[],
    from: SchemaVersionMetadata,
    path: SchemaMigration<unknown, unknown>[],
): CrdtUpdate[] {
    let currentUpdates = updates.slice();
    let currentSchema = requiredSchemaFor(config, from);
    validateCrdtUpdates(currentSchema, currentUpdates, 'source');

    for (const migration of path) {
        currentUpdates = currentUpdates.flatMap((update) => {
            const migrated = migration.migrateCrdtUpdate
                ? migration.migrateCrdtUpdate(update)
                : update;
            if (migrated === null) return [];
            return Array.isArray(migrated) ? migrated : [migrated];
        });
        currentSchema = requiredSchemaFor(config, {
            schemaVersion: migration.toVersion,
            schemaFingerprintHash: migration.toFingerprintHash,
        });
        validateCrdtUpdates(currentSchema, currentUpdates, 'target', migration.id);
    }

    return currentUpdates;
}

function validateCrdtUpdates(
    schema: VersionedSchema<unknown>,
    updates: CrdtUpdate[],
    stage: 'source' | 'target',
    migrationId?: string,
) {
    const validator = createCrdtUpdateValidator(schema.schema, {
        tagKey: schema.tagKey,
        leafPlugins: schema.leafPlugins,
    });
    for (let index = 0; index < updates.length; index++) {
        const result = validator.validate(updates[index]);
        if (result.success) {
            updates[index] = result.data;
            continue;
        }
        throw new MigrationError(
            'validation-failed',
            `${stage === 'source' ? 'Source' : 'Migrated'} CRDT update ${index} does not match schema version ${schema.version}.`,
            {
                stage: `${stage}-crdt-update`,
                migrationId,
                updateIndex: index,
                schemaVersion: schema.version,
                schemaFingerprintHash: schema.fingerprintHash,
                errors: result.errors,
            },
        );
    }
}

function settlePendingDocument<T>(doc: CrdtDocument<T>, label: 'base' | 'doc'): CrdtDocument<T> {
    if (!doc.pending.length) return doc;
    const pending = doc.pending.slice();
    let current: CrdtDocument<T> = {...doc, pending: []};
    for (const entry of pending) current = applyCrdtUpdate(current, entry.update);
    if (current.pending.length) {
        throw new MigrationError(
            'replay-failed',
            `Cannot migrate CRDT ${label}: pending updates could not be applied first.`,
            {pending: describePending(current.pending)},
        );
    }
    return current;
}

function describePending(pending: PendingUpdate[]) {
    return pending.map(({reason, queuedAt, update}) => ({reason, queuedAt, update}));
}

function validatePatches(
    schema: VersionedSchema<unknown>,
    patches: Patch<unknown>[],
    stage: 'source' | 'target',
    migrationId?: string,
) {
    const validator = createPatchValidator(schema.schema);
    for (let index = 0; index < patches.length; index++) {
        const result = validator.validate(patches[index]);
        if (result.success) {
            patches[index] = result.data;
            continue;
        }
        throw new MigrationError(
            'validation-failed',
            `${stage === 'source' ? 'Source' : 'Migrated'} patch ${index} does not match schema version ${schema.version}.`,
            {
                stage: `${stage}-patch`,
                migrationId,
                patchIndex: index,
                schemaVersion: schema.version,
                schemaFingerprintHash: schema.fingerprintHash,
                errors: result.errors,
            },
        );
    }
}

function replayHistory<TCurrent, An>(history: History<TCurrent, An>) {
    const root = history.nodes[history.root];
    if (!root) {
        throw new MigrationError('replay-failed', `Migrated history root "${history.root}" is missing.`, {
            root: history.root,
        });
    }
    const states = new Map<string, TCurrent>();
    const visiting = new Set<string>();

    const replayNode = (id: string): TCurrent => {
        const existing = states.get(id);
        if (existing !== undefined) return existing;
        if (visiting.has(id)) {
            throw new MigrationError('replay-failed', 'Migrated history graph contains a cycle.', {
                nodeId: id,
            });
        }
        const node = history.nodes[id];
        if (!node) {
            throw new MigrationError('replay-failed', `Migrated history references missing node "${id}".`, {
                nodeId: id,
            });
        }
        visiting.add(id);
        const parent =
            id === history.root || node.pid === id ? history.initial : replayNode(node.pid);
        let current = parent;
        for (const patch of node.changes) current = ops.apply(current, patch, deepEqual);
        states.set(id, current);
        visiting.delete(id);
        return current;
    };

    replayNode(history.root);
    for (const node of Object.values(history.nodes)) {
        replayNode(node.id);
        for (const child of node.children) {
            if (!history.nodes[child]) {
                throw new MigrationError(
                    'replay-failed',
                    `Migrated history node "${node.id}" references missing child "${child}".`,
                    {nodeId: node.id, childId: child},
                );
            }
        }
    }
    if (!history.nodes[history.tip]) {
        throw new MigrationError('replay-failed', `Migrated history tip "${history.tip}" is missing.`, {
            tip: history.tip,
        });
    }
    for (const id of history.undoTrail) {
        if (!history.nodes[id]) {
            throw new MigrationError(
                'replay-failed',
                `Migrated history undo trail references missing node "${id}".`,
                {nodeId: id},
            );
        }
    }
    return states;
}

function schemaFor<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    metadata: SchemaVersionMetadata,
): VersionedSchema<unknown> | null {
    if (
        config.current.version === metadata.schemaVersion &&
        config.current.fingerprintHash === metadata.schemaFingerprintHash
    ) {
        return config.current as VersionedSchema<unknown>;
    }
    return (
        config.previous.find(
            (schema) =>
                schema.version === metadata.schemaVersion &&
                schema.fingerprintHash === metadata.schemaFingerprintHash,
        ) ?? null
    );
}

function requiredSchemaFor<TCurrent>(
    config: SchemaMigrationConfig<TCurrent>,
    metadata: SchemaVersionMetadata,
): VersionedSchema<unknown> {
    const schema = schemaFor(config, metadata);
    if (!schema) {
        throw new MigrationError(
            'missing-target-schema',
            `No schema is registered for version ${metadata.schemaVersion} and fingerprint hash ${metadata.schemaFingerprintHash}.`,
            {metadata},
        );
    }
    assertFingerprintMatch(schema, metadata);
    return schema;
}

function assertFingerprintMatch(schema: VersionedSchema<unknown>, metadata: SchemaVersionMetadata) {
    if (schema.fingerprintHash !== metadata.schemaFingerprintHash) {
        throw new MigrationError(
            'fingerprint-mismatch',
            `Schema version ${metadata.schemaVersion} has fingerprint hash ${metadata.schemaFingerprintHash}, not ${schema.fingerprintHash}.`,
            {
                schemaVersion: metadata.schemaVersion,
                expectedFingerprintHash: schema.fingerprintHash,
                actualFingerprintHash: metadata.schemaFingerprintHash,
            },
        );
    }
    if (metadata.schemaFingerprint !== undefined && schema.fingerprint !== metadata.schemaFingerprint) {
        throw new MigrationError(
            'fingerprint-mismatch',
            `Schema version ${metadata.schemaVersion} has a full fingerprint that does not match the registered schema.`,
            {schemaVersion: metadata.schemaVersion},
        );
    }
}

function assertValid<T>(
    schema: VersionedSchema<T>,
    value: unknown,
    stage: 'source' | 'target',
    migrationId?: string,
): T {
    const result = schema.validateState(value);
    if (result.success) return result.data;
    throw new MigrationError(
        'validation-failed',
        `${stage === 'source' ? 'Source' : 'Migrated'} value does not match schema version ${schema.version}.`,
        {
            stage,
            migrationId,
            schemaVersion: schema.version,
            schemaFingerprintHash: schema.fingerprintHash,
            errors: result.errors,
        },
    );
}
