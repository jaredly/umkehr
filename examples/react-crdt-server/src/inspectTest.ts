import {ServerStore} from './store';
import {databasePathFromArgs} from './cli';

const {docId} = parseArgs(Bun.argv);
const store = new ServerStore(databasePathFromArgs(Bun.argv));
const document = store.getDocument(docId);
const branches = store.listBranches(docId);
const events = branches.flatMap((branch) => store.listEventsAfter(docId, branch.branchId, 0));

console.log(
    JSON.stringify({
        document,
        archivedSchemaHashes: store.archivedSchemaHashes(docId),
        branches,
        eventCount: events.length,
        activeMigrationLock: store.activeMigrationLock(docId),
    }),
);

function parseArgs(argv: string[]) {
    const docIndex = argv.indexOf('--doc');
    const docId = argv[docIndex + 1]?.trim();
    if (docIndex === -1 || !docId) throw new Error('--doc requires a document id.');
    return {docId};
}
