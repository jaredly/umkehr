import {_get, type EqualFn} from './internal';
import {createPatchBuilderWithContext} from './helper';
import {pathToString, type Patch, type DraftPatch} from './types';
import {ops, rebase} from './ops';

const describePath = (path: DraftPatch<unknown>['path']) => pathToString(path) || '<root>';

export function realizeDraftPatch<T, V, Tag extends PropertyKey, Extra>(
    base: T,
    draft: DraftPatch<V, Tag, Extra>,
): Patch<V> {
    switch (draft.op) {
        case 'add': {
            const prev = _get(base, draft.path);
            if (prev !== undefined) {
                throw new Error(`Cannot add "${describePath(draft.path)}": value already exists.`);
            }
            return draft;
        }
        case 'move':
            return draft;
        case 'replace': {
            const prev = _get(base, draft.path);
            if (prev === undefined) {
                return {...draft, op: 'add'};
            }
            return {...draft, previous: prev};
        }
        case 'remove': {
            const prev = _get(base, draft.path);
            if (prev === undefined) {
                throw new Error(`Cannot remove "${describePath(draft.path)}": value does not exist.`);
            }
            return {...draft, value: _get(base, draft.path)};
        }
        case 'push': {
            const arr = _get(base, draft.path);
            if (!Array.isArray(arr)) {
                throw new Error(`Cannot push to "${describePath(draft.path)}": value is not an array.`);
            }
            return {
                op: 'add',
                path: [...draft.path, {type: 'key', key: arr.length}],
                value: draft.value,
            } as Patch<V>;
        }
        case 'reorder': {
            const arr = _get(base, draft.path);
            if (!Array.isArray(arr)) {
                throw new Error(`Cannot reorder "${describePath(draft.path)}": value is not an array.`);
            }
            if (draft.indices.length !== arr.length) {
                throw new Error(
                    `Cannot reorder "${describePath(draft.path)}": indices length must match array length.`,
                );
            }
            const seen = new Set(draft.indices);
            if (
                seen.size !== arr.length ||
                draft.indices.some(
                    (index) => !Number.isInteger(index) || index < 0 || index >= arr.length,
                )
            ) {
                throw new Error(
                    `Cannot reorder "${describePath(draft.path)}": indices must be a permutation of array indices.`,
                );
            }
            return draft;
        }
        case 'nested': {
            throw new Error(`Cannot realize nested patch directly. Use resolveAndApply instead.`);
        }
    }
}

const asArray = <V>(v: V | V[]): V[] => (Array.isArray(v) ? v : [v]);
export type MaybeNested<T> = T | MaybeNested<T>[];

export const asFlat = <T>(v: MaybeNested<T>): T[] => asArray(v).flat() as T[];

export function resolveAndApply<T, Extra, Tag extends string = 'type'>(
    current: T,
    draft: MaybeNested<DraftPatch<T, Tag, Extra>>,
    extra: Extra,
    tag: Tag,
    equal: EqualFn,
): {current: T; changes: Patch<T>[]} {
    const changes = asFlat(draft).flatMap((op) => {
        if (op.op === 'nested') {
            const value = _get(current, op.path);
            const inner = op.make(value, createPatchBuilderWithContext(tag, extra));
            const next = resolveAndApply<T, Extra, Tag>(
                current,
                asArray(inner).map((i) => rebase(i, op.path) as DraftPatch<T, Tag, Extra>),
                extra,
                tag,
                equal,
            );
            current = next.current;
            return next.changes;
        }
        const ready = realizeDraftPatch(current, op);
        current = ops.apply(current, ready, equal);
        return ready;
    });
    return {current, changes};
}
