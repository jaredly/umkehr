import typia from 'typia';
import {type History, type Patch} from 'umkehr';
import {schemaFingerprint, schemaFingerprintHash} from 'umkehr/migration';
import {createPatchValidator} from 'umkehr/validation';
import {todoSchema, type TodoState} from './model';

const STORAGE_KEY = 'umkehr.react-example.history.v1';
const SCHEMA_VERSION = 1;

const validateState = typia.createValidate<TodoState>();
const patchValidator = createPatchValidator<TodoState>(todoSchema);
const currentSchemaFingerprint = schemaFingerprint(todoSchema);
const currentSchemaFingerprintHash = schemaFingerprintHash(todoSchema);

type PersistedHistory = {
    storageVersion: 1;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    history: History<TodoState, never>;
};

export function loadPersistedHistory(): History<TodoState, never> | null {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const persisted = validatePersistedHistory(parsed);
        if (!persisted) {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return persisted.history;
    } catch (error) {
        console.warn('Ignoring invalid persisted Umkehr history.', error);
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

export function savePersistedHistory(history: History<TodoState, never>) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            storageVersion: 1,
            schemaVersion: SCHEMA_VERSION,
            schemaFingerprint: currentSchemaFingerprint,
            schemaFingerprintHash: currentSchemaFingerprintHash,
            history,
        } satisfies PersistedHistory),
    );
}

function validatePersistedHistory(input: unknown): PersistedHistory | null {
    if (isRecord(input) && input.storageVersion === 1) {
        if (input.schemaVersion !== SCHEMA_VERSION) return null;
        if (input.schemaFingerprintHash !== currentSchemaFingerprintHash) return null;
        if (input.schemaFingerprint !== currentSchemaFingerprint) return null;
        const history = validateHistory(input.history);
        return history
            ? {
                  storageVersion: 1,
                  schemaVersion: SCHEMA_VERSION,
                  schemaFingerprint: currentSchemaFingerprint,
                  schemaFingerprintHash: currentSchemaFingerprintHash,
                  history,
              }
            : null;
    }
    const legacy = validateHistory(input);
    return legacy
        ? {
              storageVersion: 1,
              schemaVersion: SCHEMA_VERSION,
              schemaFingerprint: currentSchemaFingerprint,
              schemaFingerprintHash: currentSchemaFingerprintHash,
              history: legacy,
          }
        : null;
}

function validateHistory(input: unknown): History<TodoState, never> | null {
    if (!isRecord(input)) return null;
    if (input.version !== 2) return null;
    if (typeof input.root !== 'string' || typeof input.tip !== 'string') return null;
    if (!Array.isArray(input.undoTrail) || !input.undoTrail.every((id) => typeof id === 'string')) {
        return null;
    }
    const initial = validateState(input.initial);
    const current = validateState(input.current);
    if (!initial.success || !current.success) return null;
    if (!isRecord(input.nodes) || !isRecord(input.annotations)) return null;
    if (!Object.values(input.annotations).every(isRecord)) return null;

    const nodes: History<TodoState, never>['nodes'] = {};
    for (const [id, node] of Object.entries(input.nodes)) {
        const validated = validateHistoryNode(id, node);
        if (!validated) return null;
        nodes[id] = validated;
    }

    if (!nodes[input.root] || !nodes[input.tip]) return null;
    for (const node of Object.values(nodes)) {
        if (!nodes[node.pid]) return null;
        if (!node.children.every((id) => Boolean(nodes[id]))) return null;
    }

    return {
        version: 2,
        initial: initial.data,
        nodes,
        annotations: input.annotations as History<TodoState, never>['annotations'],
        root: input.root,
        tip: input.tip,
        current: current.data,
        undoTrail: input.undoTrail,
    };
}

function validateHistoryNode(
    id: string,
    input: unknown,
): History<TodoState, never>['nodes'][string] | null {
    if (!isRecord(input)) return null;
    if (input.id !== id) return null;
    if (typeof input.pid !== 'string') return null;
    if (!Array.isArray(input.children) || !input.children.every((child) => typeof child === 'string')) {
        return null;
    }
    if (!Array.isArray(input.changes)) return null;

    const changes: Patch<TodoState>[] = [];
    for (const change of input.changes) {
        const result = patchValidator.validate(change);
        if (!result.success) return null;
        changes.push(result.data);
    }

    return {
        id,
        pid: input.pid,
        children: input.children,
        changes,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
