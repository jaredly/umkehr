import {EqualFn} from './internal';
import {ops} from './ops';
import {Patch} from './types';

export type History<T> = {ops: Patch<T>[]; ts: number};

const inverts = <T>(change: Patch<T>[]) => change.toReversed().map((op) => ops.invert(op));

export type State<T> = {value: T; history: History<T>[]; back: number};

export function initialState<T>(value: T): State<T> {
    return {value, history: [], back: 0};
}

export function undo<T>(state: State<T>, equal: EqualFn): State<T> {
    if (state.back >= state.history.length) return state;
    const last = state.history[state.history.length - 1 - state.back];
    let value = state.value;
    inverts(last.ops).forEach((op) => {
        value = ops.apply(value, op, equal);
    });
    return {value, history: state.history, back: state.back + 1};
}

export function redo<T>(state: State<T>, equal: EqualFn): State<T> {
    if (state.back < 1) return state;
    const last = state.history[state.history.length - state.back];
    let value = state.value;
    last.ops.forEach((op) => {
        value = ops.apply(value, op, equal);
    });
    return {value, history: state.history, back: state.back - 1};
}

export function update<T>(state: State<T>, update: Patch<T>[], equal: EqualFn): State<T> {
    const history = (state.back > 0 ? state.history.slice(0, -state.back) : state.history).concat([
        {ops: update, ts: Date.now()},
    ]);
    let value = state.value;
    update.forEach((op) => {
        value = ops.apply(value, op, equal);
    });
    return {value, history, back: 0};
}
