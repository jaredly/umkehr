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
    it('auto-creates main and assigns contiguous update event indexes', () => {
        const store = createStore();
        store.ensureDocument('doc', 1, 'schema', 'schema-hash');

        expect(store.ensureMainBranch('doc').name).toBe('main');
        expect(store.listBranches('doc').map((branch) => branch.branchId)).toEqual(['main']);

        const first = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });
        const duplicate = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });
        const second = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '002:user:session',
            update: {op: 'set', path: [], value: {}, ts: '002:user:session'},
        });

        expect(first.eventIndex).toBe(1);
        expect(duplicate).toEqual(first);
        expect(second.eventIndex).toBe(2);
        expect(store.listEventsAfter('doc', 'main', 1)).toEqual([second]);
    });

    it('creates and renames branches with unique names', () => {
        const store = createStore();
        store.ensureDocument('doc', 1, 'schema', 'schema-hash');

        const branch = store.createBranch({
            docId: 'doc',
            branchId: 'feature',
            sourceBranchId: 'main',
            forkEventIndex: 0,
            name: 'Feature',
        });

        expect(branch.branchId).toBe('feature');
        expect(branch.sourceBranchId).toBe('main');
        expect(branch.forkEventIndex).toBe(0);
        expect(store.createBranch({
            docId: 'doc',
            branchId: 'feature',
            sourceBranchId: 'main',
            forkEventIndex: 0,
            name: 'Feature',
        })).toEqual(branch);

        const renamed = store.renameBranch({docId: 'doc', branchId: 'feature', name: 'Review'});
        expect(renamed.name).toBe('Review');
        expect(() =>
            store.createBranch({
                docId: 'doc',
                branchId: 'other',
                sourceBranchId: 'main',
                forkEventIndex: 0,
                name: 'Review',
            }),
        ).toThrow();
    });

    it('deduplicates merge events by mergeId', () => {
        const store = createStore();
        store.ensureDocument('doc', 1, 'schema', 'schema-hash');

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
