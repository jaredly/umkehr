import { _add, _get, _remove, _replace, type EqualFn } from "./internal";
import type {
	AddOp,
	Patch,
	MoveOp,
	Path,
	DraftPatch,
	RemoveOp,
	ReplaceOp,
	ReorderOp,
} from "./types";

function add<T, V>(base: T, op: AddOp<V>) {
	return _add(base, op.path, op.value);
}
function remove<T, V>(base: T, op: RemoveOp<V>, equal: EqualFn) {
	return _remove(base, op.path, op.value, equal);
}
function replace<T, V>(base: T, op: ReplaceOp<V>, equal: EqualFn) {
	return _replace(base, op.path, op.previous, op.value, equal);
}
function move<T>(base: T, op: MoveOp<T>, equal: EqualFn) {
	const value = _get(base, op.from);
	const removed = _remove(base, op.from, value, equal);
	return _add(removed, op.path, value);
}
function reorder<T, V>(base: T, op: ReorderOp<V>, equal: EqualFn) {
	const value = _get(base, op.path);
	if (!Array.isArray(value)) {
		throw new Error("not an array");
	}
	if (op.indices.length !== value.length) {
		throw new Error("reorder indices must match array length");
	}
	const seen = new Set(op.indices);
	if (
		seen.size !== value.length ||
		op.indices.some(
			(index) => !Number.isInteger(index) || index < 0 || index >= value.length,
		)
	) {
		throw new Error("reorder indices must be a permutation of array indices");
	}
	return _replace(
		base,
		op.path,
		value,
		op.indices.map((index) => value[index]),
		equal,
	);
}

export function rebase<T, A extends PropertyKey, B>(
	op: DraftPatch<T, A, B>,
	path: Path,
): DraftPatch<T, A, B> {
	switch (op.op) {
		case "move":
			return {
				...op,
				path: [...path, ...op.path],
				from: [...path, ...op.from],
			};
		case "add":
		case "push":
		case "reorder":
		case "replace":
		case "remove":
			return { ...op, path: [...path, ...op.path] };
		case "nested":
			throw new Error(
				"A nested patch's 'make()' function returned another nested patch, which is unsupported.",
			);
	}
}

function invert<T>(op: Patch<T>): Patch<T> {
	switch (op.op) {
		case "add":
			return { op: "remove", path: op.path, value: op.value } as Patch<T>;
		case "replace":
			return { ...op, value: op.previous, previous: op.value };
		case "remove":
			return { op: "add", path: op.path, value: op.value } as Patch<T>;
		case "move":
			return { op: "move", from: op.path, path: op.from } as Patch<T>;
		case "reorder": {
			const inverse: number[] = [];
			op.indices.forEach((originalIndex, newIndex) => {
				inverse[originalIndex] = newIndex;
			});
			return { ...op, indices: inverse };
		}
	}
}

function apply<T>(base: T, op: Patch<T>, equal: EqualFn) {
	switch (op.op) {
		case "add":
			return add(base, op);
		case "replace":
			return replace(base, op, equal);
		case "remove":
			return remove(base, op, equal);
		case "move":
			return move(base, op, equal);
		case "reorder":
			return reorder(base, op, equal);
	}
}

export const ops = { apply, invert };
