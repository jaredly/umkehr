import {State, TimestampedBlockMeta} from './types.js';
import {lamportToString} from './ids.js';

export const initialState = (session: string, ts: string): State => ({
    chars: {},
    blocks: {
        [lamportToString([0, session])]: {
            id: [0, session],
            meta: {type: 'paragraph', ts: ts},
            style: {},
            order: {
                id: [0, session],
                path: [[0, session]],
                index: {path: [1], opId: {actorId: session, counter: 0}},
                ts: ts,
            },
            deleted: false,
        },
    },
    marks: {},
    splits: {},
    joins: {},
    maxSeenCount: 0,
});

export const initialStateWithMeta = <M extends TimestampedBlockMeta>(
    session: string,
    meta: M,
): State<M> => ({
    chars: {},
    blocks: {
        [lamportToString([0, session])]: {
            id: [0, session],
            meta,
            style: {},
            order: {
                id: [0, session],
                path: [[0, session]],
                index: {path: [1], opId: {actorId: session, counter: 0}},
                ts: meta.ts,
            },
            deleted: false,
        },
    },
    marks: {},
    splits: {},
    joins: {},
    maxSeenCount: 0,
});
