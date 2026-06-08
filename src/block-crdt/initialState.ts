import {State} from './types';
import {lamportToString} from './utils';

export const initialState = (session: string, ts: string): State => ({
    chars: {},
    blocks: {
        [lamportToString([0, session])]: {
            id: [0, session],
            meta: {type: 'paragraph', ts: ts},
            order: {
                index: {path: [1], opId: {actorId: session, counter: 0}},
                ts: ts,
                parent: [0, 'root'],
            },
            deleted: false,
        },
    },
    marks: {},
    splits: {},
    maxSeenCount: 0,
});
