import {
    applyMany,
    insertBlockOps,
    insertTextOps,
    markSelectionOps,
    parseLamportString,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {initialStateWithMeta} from 'umkehr/block-crdt/initialState';
import {cachedState, lamportToString} from 'umkehr/block-crdt';
import type {CachedState, HLC} from 'umkehr/block-crdt';
import type {PlimBlockMeta} from './plimBlockCrdtAdapter';

export const makeTs = (init = 1) => {
    let next = init;
    return () => (next++).toString().padStart(5, '0') as HLC;
};

export const createFixtureState = (): CachedState<PlimBlockMeta> => {
    const ts = makeTs();
    let state = cachedState(
        initialStateWithMeta<PlimBlockMeta>('alice', {
            type: 'paragraph',
            attrs: {tone: 'plain'},
            ts: ts(),
        }),
    );
    state = applyMany(
        state,
        insertTextOps(state, {
            actor: 'alice',
            block: [0, 'alice'],
            offset: 0,
            text: 'Hello 👩‍💻',
            ts,
        }),
    );
    state = applyMany(
        state,
        markSelectionOps(
            state,
            {
                anchor: {blockId: '0000-alice', offset: 0},
                focus: {blockId: '0000-alice', offset: 5},
            },
            'bold',
            undefined,
            false,
            {actor: 'alice'},
        ),
    );
    state = applyMany(
        state,
        insertBlockOps(state, {
            actor: 'alice',
            parent: [0, 'root'],
            before: [0, 'alice'],
            after: null,
            meta: {type: 'heading', attrs: {level: 2}, ts: ts()},
            ts: ts(),
            options: {random: () => 0},
        }),
    );
    const heading = parseLamportString(visibleBlockChildren(state, lamportToString([0, 'root']))[1]);
    state = applyMany(
        state,
        insertTextOps(state, {
            actor: 'alice',
            block: heading,
            offset: 0,
            text: 'Roadmap',
            ts,
        }),
    );
    state = applyMany(
        state,
        insertBlockOps(state, {
            actor: 'alice',
            parent: [0, 'alice'],
            before: null,
            after: null,
            meta: {type: 'todo', attrs: {checked: false}, ts: ts()},
            ts: ts(),
            options: {random: () => 0},
        }),
    );
    const child = parseLamportString(visibleBlockChildren(state, '0000-alice')[0]);
    state = applyMany(
        state,
        insertTextOps(state, {
            actor: 'alice',
            block: child,
            offset: 0,
            text: 'Ship adapter',
            ts,
        }),
    );
    return state;
};
