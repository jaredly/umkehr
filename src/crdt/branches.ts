import {
    applyRemoteHistoryUpdate,
    latestCrdtUpdateTimestamp,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from './index.js';
import type {BranchAdapter, UpdateEvent} from '../branches/index.js';

export type JsonCrdtBranchAdapterOptions<TState> = {
    createInitialHistory(): CrdtLocalHistory<TState>;
};

export function createJsonCrdtBranchAdapter<TState>({
    createInitialHistory,
}: JsonCrdtBranchAdapterOptions<TState>): BranchAdapter<CrdtLocalHistory<TState>, CrdtUpdate> {
    return {
        createInitialHistory,
        applyUpdate(history, update, options) {
            if (options.recordHistory) return applyRemoteHistoryUpdate(history, update);
            return {...history, doc: applyRemoteHistoryUpdate(history, update).doc};
        },
        sameContents(left, right) {
            return (
                JSON.stringify(left.doc.state) === JSON.stringify(right.doc.state) &&
                JSON.stringify(left.doc.meta) === JSON.stringify(right.doc.meta)
            );
        },
    };
}

export function eventIdForCrdtUpdate(update: CrdtUpdate): string {
    const eventId = latestCrdtUpdateTimestamp(update);
    if (!eventId) throw new Error('CRDT branch update is missing a timestamp event id.');
    return eventId;
}

export function crdtUpdateEvent<TUpdate extends CrdtUpdate>({
    branchId,
    eventIndex,
    update,
    recorded,
    receivedAt,
}: {
    branchId: string;
    eventIndex: number;
    update: TUpdate;
    recorded?: boolean;
    receivedAt?: string;
}): UpdateEvent<TUpdate> {
    return {
        kind: 'update',
        branchId,
        eventIndex,
        eventId: eventIdForCrdtUpdate(update),
        update,
        recorded,
        receivedAt,
    };
}
