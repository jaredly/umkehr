import {ServerStore} from './store';
import {databasePathFromArgs} from './cli';

const args = parseArgs(Bun.argv);
const store = new ServerStore(databasePathFromArgs(Bun.argv));
const result = store.beginMigration({
    docId: args.docId,
    ownerActor: args.ownerActor,
    ownerUserId: args.ownerUserId,
    ownerSessionId: args.ownerSessionId,
    targetSchemaVersion: args.targetSchemaVersion,
    targetSchemaFingerprint: args.targetSchemaFingerprint,
    targetSchemaFingerprintHash: args.targetSchemaFingerprintHash,
});

console.log(JSON.stringify(result));

function parseArgs(argv: string[]) {
    const ownerActor = requiredArg(argv, '--owner-actor');
    const [ownerUserId, ownerSessionId] = ownerActor.split(':');
    if (!ownerUserId || !ownerSessionId) {
        throw new Error('--owner-actor must be formatted as userId:sessionId.');
    }
    return {
        docId: requiredArg(argv, '--doc'),
        ownerActor,
        ownerUserId,
        ownerSessionId,
        targetSchemaVersion: Number(requiredArg(argv, '--target-version')),
        targetSchemaFingerprint: requiredArg(argv, '--target-fingerprint'),
        targetSchemaFingerprintHash: requiredArg(argv, '--target-fingerprint-hash'),
    };
}

function requiredArg(argv: string[], name: string) {
    const index = argv.indexOf(name);
    const value = argv[index + 1]?.trim();
    if (index === -1 || !value) throw new Error(`${name} requires a value.`);
    return value;
}
