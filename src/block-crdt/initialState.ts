import {State} from './types';
import {lamportToString} from './utils';

export const initialState = (session: string, ts: string): State => ({
    chars: {},
    blocks: {
        [lamportToString([0, session])]: {
            id: [0, session],
            meta: {type: 'paragraph', ts: ts},
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
