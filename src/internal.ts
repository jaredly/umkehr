// biome-ignore-all lint/suspicious/noExplicitAny : this is internal and fine

import {type PathSegment, pathToString} from './types.js';

const describePath = (path: PathSegment[]) => pathToString(path) || '<root>';

export function _get(base: any, at: PathSegment[]) {
    for (let i = 0; i < at.length; i++) {
        const key = at[i];
        if (!base) {
            throw new Error(
                `Cannot read path "${describePath(at)}": missing value at "${describePath(at.slice(0, i))}".`,
            );
        }
        if (key.type === 'tag') {
            if (!(key.key in base)) {
                throw new Error(`Expected tagged union with tag "${key.key}" at "${describePath(at.slice(0, i))}".`);
            }
            if (base[key.key] !== key.value) {
                throw new Error(
                    `Tagged union at "${describePath(at.slice(0, i))}" has tag "${key.key}"="${base[key.key]}", expected "${key.value}".`,
                );
            }
            continue;
        }
        if (Array.isArray(base)) {
            if (typeof key.key !== 'number') {
                throw new Error(`Expected numeric array index at "${describePath(at.slice(0, i))}", got "${key.key}".`);
            }
        } else if (typeof base !== 'object') {
            throw new Error(`Cannot read key "${key.key}" at "${describePath(at.slice(0, i))}": value is not an object.`);
        }
        base = base[key.key];
    }
    return base;
}

function _getCloned(root: any, at: PathSegment[]) {
    root = Array.isArray(root) ? root.slice() : {...root};
    let base = root;
    let parent: any = null;
    let parentKey: PathSegment | null = null;
    const setIntoParent = (next: any) => {
        if (!parentKey) {
            root = next;
        } else {
            if (parentKey.type !== 'key')
                throw new Error(`Cannot clone path with final segment type "${parentKey.type}".`);
            parent[parentKey.key] = next;
        }
        base = next;
    };

    for (let i = 0; i < at.length; i++) {
        const key = at[i];
        if (!base) {
            throw new Error(
                `Cannot clone path "${describePath(at)}": missing value at "${describePath(at.slice(0, i))}".`,
            );
        }
        if (key.type === 'tag') {
            if (!(key.key in base)) {
                throw new Error(`Expected tagged union with tag "${key.key}" at "${describePath(at.slice(0, i))}".`);
            }
            if (base[key.key] !== key.value) {
                throw new Error(
                    `Tagged union at "${describePath(at.slice(0, i))}" has tag "${key.key}"="${base[key.key]}", expected "${key.value}".`,
                );
            }
            continue;
        }
        if (Array.isArray(base)) {
            if (typeof key.key !== 'number') {
                throw new Error(`Expected numeric array index at "${describePath(at.slice(0, i))}", got "${key.key}".`);
            }
        } else if (typeof base !== 'object') {
            throw new Error(`Cannot clone key "${key.key}" at "${describePath(at.slice(0, i))}": value is not an object.`);
        }
        parent = base;
        parentKey = key;
        base[key.key] = Array.isArray(base[key.key]) ? base[key.key].slice() : {...base[key.key]};
        base = base[key.key];
    }
    return {root, base};
}

export type EqualFn = (a: any, b: any) => boolean;

export function _replace(base: any, at: PathSegment[], previous: any, value: any, equal: EqualFn) {
    if (!at.length) {
        if (!equal(previous, base)) {
            throw new Error(`Cannot replace "<root>": previous value does not match current value.`);
        }
        return value;
    }
    at = at.slice();
    while (at[at.length - 1].type !== 'key') {
        at.pop();
    }
    let root: any;
    ({root, base} = _getCloned(base, at.slice(0, -1)));
    const key = at[at.length - 1];
    if (key.type !== 'key') {
        throw new Error(`Cannot replace "${describePath(at)}": final path segment must be a key.`);
    }
    if (Array.isArray(base)) {
        if (typeof key.key !== 'number') {
            throw new Error(`Expected numeric array index at "${describePath(at.slice(0, -1))}", got "${key.key}".`);
        }
    } else if (typeof base !== 'object') {
        throw new Error(`Cannot replace "${describePath(at)}": parent value is not an object.`);
    }
    if (!equal(previous, base[key.key])) {
        throw new Error(`Cannot replace "${describePath(at)}": previous value does not match current value.`);
    }
    base[key.key] = value;
    return root;
}

export function _add(base: any, at: PathSegment[], value: any) {
    let root: any;
    ({root, base} = _getCloned(base, at.slice(0, -1)));
    const key = at[at.length - 1];
    if (key.type !== 'key') {
        throw new Error(`Cannot add "${describePath(at)}": final path segment must be a key.`);
    }
    if (Array.isArray(base)) {
        if (typeof key.key !== 'number') {
            throw new Error(`Expected numeric array index at "${describePath(at.slice(0, -1))}", got "${key.key}".`);
        }
        base.splice(key.key, 0, value);
    } else if (typeof base !== 'object') {
        throw new Error(`Cannot add "${describePath(at)}": parent value is not an object.`);
    } else if (key.key in base && base[key.key] !== undefined) {
        throw new Error(`Cannot add "${describePath(at)}": key already exists. Use replace instead.`);
    } else {
        base[key.key] = value;
    }
    return root;
}

export function _remove(base: any, at: PathSegment[], value: any, equal: EqualFn) {
    let root: any;
    ({root, base} = _getCloned(base, at.slice(0, -1)));
    const key = at[at.length - 1];
    if (key.type !== 'key') {
        throw new Error(`Cannot remove "${describePath(at)}": final path segment must be a key.`);
    }
    if (Array.isArray(base)) {
        if (typeof key.key !== 'number') {
            throw new Error(`Expected numeric array index at "${describePath(at.slice(0, -1))}", got "${key.key}".`);
        }
        if (key.key < 0 || key.key >= base.length) {
            throw new Error(`Cannot remove "${describePath(at)}": key does not exist.`);
        }
        if (!equal(value, base[key.key])) {
            throw new Error(`Cannot remove "${describePath(at)}": expected value does not match current value.`);
        }
        base.splice(key.key, 1);
    } else if (typeof base !== 'object') {
        throw new Error(`Cannot remove "${describePath(at)}": parent value is not an object.`);
    } else if (!(key.key in base)) {
        throw new Error(`Cannot remove "${describePath(at)}": key does not exist.`);
    } else {
        if (!equal(value, base[key.key])) {
            throw new Error(`Cannot remove "${describePath(at)}": expected value does not match current value.`);
        }
        delete base[key.key];
    }
    return root;
}
