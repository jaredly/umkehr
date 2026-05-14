import { _get, EqualFn } from "./internal";
import { createPatchBuilder } from "./helper";
import type { Patch, DraftPatch } from "./types";
import { ops, rebase } from "./ops";

export function realizeDraftPatch<T, V, Tag extends PropertyKey, Extra>(
    base: T,
    draft: DraftPatch<V, Tag, Extra>,
): Patch<V> {
    switch (draft.op) {
        case "add": {
            const prev = _get(base, draft.path);
            if (prev !== undefined) {
                throw new Error(`cant add whats already there`);
            }
            return draft;
        }
        case "move":
        case "copy":
            return draft;
        case "replace": {
            const prev = _get(base, draft.path);
            if (prev === undefined) {
                return { ...draft, op: "add" };
            }
            return { ...draft, previous: prev };
        }
        case "remove": {
            const prev = _get(base, draft.path);
            if (prev === undefined) {
                throw new Error("nothing to remove");
            }
            return { ...draft, value: _get(base, draft.path) };
        }
        case "push": {
            const arr = _get(base, draft.path);
            if (!Array.isArray(arr)) {
                throw new Error("not an array");
            }
            return {
                op: "add",
                path: [...draft.path, { type: "key", key: arr.length }],
                value: draft.value,
            } as Patch<V>;
        }
        case "reorder": {
            const arr = _get(base, draft.path);
            if (!Array.isArray(arr)) {
                throw new Error("not an array");
            }
            if (draft.indices.length !== arr.length) {
                throw new Error("reorder indices must match array length");
            }
            const seen = new Set(draft.indices);
            if (
                seen.size !== arr.length ||
                draft.indices.some(
                    (index) =>
                        !Number.isInteger(index) || index < 0 || index >= arr.length,
                )
            ) {
                throw new Error(
                    "reorder indices must be a permutation of array indices",
                );
            }
            return draft;
        }
        case "nested": {
            throw new Error(
                `Nested needs to be resolved before calling realizeDraftPatch`,
            );
        }
    }
}

const asArray = <V>(v: V | V[]): V[] => (Array.isArray(v) ? v : [v]);
export type MaybeNested<T> = T | MaybeNested<T>[];

export const asFlat = <T>(v: MaybeNested<T>): T[] => asArray(v).flat() as T[];

export function resolveAndApply<T, Extra, Tag extends string = "type">(
    current: T,
    draft: MaybeNested<DraftPatch<T, Tag, Extra>>,
    extra: Extra,
    tag: Tag,
    equal: EqualFn,
): { current: T; changes: Patch<T>[] } {
    const changes = asFlat(draft).flatMap((op) => {
        if (op.op === "nested") {
            const value = _get(current, op.path);
            const inner = op.make(value, createPatchBuilder(tag, extra));
            const next = resolveAndApply<T, Extra, Tag>(
                current,
                asArray(inner).map(
                    (i) => rebase(i, op.path) as DraftPatch<T, Tag, Extra>,
                ),
                extra,
                tag,
                equal,
            );
            current = next.current;
            return next.changes;
        }
        try {
            const ready = realizeDraftPatch(current, op);
            current = ops.apply(current, ready, equal);
            return ready;
        } catch (err) {
            console.log("Tried to realizeDraftPatch, but failed");
            console.log(current, op);
            throw err;
        }
    });
    return { current, changes };
}
