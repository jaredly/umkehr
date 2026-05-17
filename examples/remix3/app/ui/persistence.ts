import type {History, Patch} from 'umkehr';
import type {State} from './model.ts';

const STORAGE_KEY = 'umkehr.remix3-example.history.v1';

export function loadPersistedHistory(): History<State, never> | null {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const history = validateHistory(parsed);
        if (!history) {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return history;
    } catch (error) {
        console.warn('Ignoring invalid persisted Umkehr history.', error);
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

export function savePersistedHistory(history: History<State, never>) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function validateHistory(input: unknown): History<State, never> | null {
    if (!isRecord(input)) return null;
    if (input.version !== 2) return null;
    if (!isState(input.initial) || !isState(input.current)) return null;
    if (typeof input.root !== 'string' || typeof input.tip !== 'string') return null;
    if (!Array.isArray(input.undoTrail) || !input.undoTrail.every((id) => typeof id === 'string')) {
        return null;
    }
    if (!isRecord(input.nodes) || !isRecord(input.annotations)) return null;
    if (!Object.values(input.annotations).every(isRecord)) return null;

    const nodes: History<State, never>['nodes'] = {};
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
        initial: input.initial,
        nodes,
        annotations: input.annotations as History<State, never>['annotations'],
        root: input.root,
        tip: input.tip,
        current: input.current,
        undoTrail: input.undoTrail,
    };
}

function validateHistoryNode(id: string, input: unknown): History<State, never>['nodes'][string] | null {
    if (!isRecord(input)) return null;
    if (input.id !== id) return null;
    if (typeof input.pid !== 'string') return null;
    if (!Array.isArray(input.children) || !input.children.every((child) => typeof child === 'string')) {
        return null;
    }
    if (!Array.isArray(input.changes) || !input.changes.every(isPatch)) return null;

    return {
        id,
        pid: input.pid,
        children: input.children,
        changes: input.changes as Patch<State>[],
    };
}

function isPatch(input: unknown): input is Patch<State> {
    if (!isRecord(input) || typeof input.op !== 'string' || !Array.isArray(input.path)) return false;
    return ['add', 'replace', 'remove', 'move', 'reorder'].includes(input.op);
}

function isState(input: unknown): input is State {
    if (!isRecord(input)) return false;
    if (typeof input.bgcolor !== 'string') return false;
    if (!Array.isArray(input.todos)) return false;
    return input.todos.every(
        (todo) =>
            isRecord(todo) &&
            typeof todo.id === 'string' &&
            typeof todo.title === 'string' &&
            typeof todo.done === 'boolean',
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
