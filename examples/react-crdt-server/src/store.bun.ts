import {afterEach, describe, expect, it} from 'bun:test';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ServerStore} from './store';

const dbPaths: string[] = [];

afterEach(() => {
    for (const path of dbPaths.splice(0)) {
        try {
            unlinkSync(path);
        } catch {
            // Temp database may already be gone.
        }
    }
});

function createStore() {
    const path = join(tmpdir(), `umkehr-server-store-${crypto.randomUUID()}.sqlite`);
    dbPaths.push(path);
    return new ServerStore(path);
}

describe('ServerStore', () => {
    it('deduplicates merge events by mergeId', () => {
        const store = createStore();
        store.ensureDocument('doc', 'schema');

        const first = store.appendMergeEvent({
            docId: 'doc',
            branchId: 'main',
            mergeId: 'merge-client-1',
            actor: 'user:session',
            sourceBranchId: 'main',
            sourceThroughEventIndex: 0,
        });
        const second = store.appendMergeEvent({
            docId: 'doc',
            branchId: 'main',
            mergeId: 'merge-client-1',
            actor: 'user:session',
            sourceBranchId: 'main',
            sourceThroughEventIndex: 0,
        });

        expect(second).toEqual(first);
        expect(store.listEventsAfter('doc', 'main', 0)).toEqual([first]);
        expect(store.ensureMainBranch('doc').tipEventIndex).toBe(1);
    });
});
