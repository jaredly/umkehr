import type {DeletedState} from './types.js';

export const isDeleted = (record: {deleted?: DeletedState} | undefined): boolean =>
    record?.deleted?.value === true;

export const deletedStateWins = (
    incoming: DeletedState,
    current: DeletedState | undefined,
): boolean => !current || incoming.ts > current.ts;

export const mergeDeletedState = (
    current: DeletedState | undefined,
    incoming: DeletedState | undefined,
): DeletedState | undefined => (incoming && deletedStateWins(incoming, current) ? incoming : current);
