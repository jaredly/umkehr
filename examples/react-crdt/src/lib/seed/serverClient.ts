import type {PersistedServerBranch, PersistedServerReplica, ServerBranchEvent} from '../server/types';
import {SERVER_PROTOCOL_VERSION} from '../server/protocol';
import type {SeedFixture} from './generate';

export type ServerClientSeedScenario = 'cached' | 'pending-uploads' | 'stale-schema';

export function createServerClientSeedReplica<TState>({
    fixture,
    scenario = 'cached',
}: {
    fixture: SeedFixture<TState>;
    scenario?: ServerClientSeedScenario;
}): PersistedServerReplica<TState> {
    const pending = scenario === 'pending-uploads';
    const branches = Object.fromEntries(
        fixture.branches.map((branch) => {
            const history = fixture.histories[branch.branchId] ?? fixture.histories.main;
            if (!history) {
                throw new Error(`Seed fixture "${fixture.docId}" is missing ${branch.branchId} history.`);
            }
            return [
                branch.branchId,
                {
                    branchId: branch.branchId,
                    sourceBranchId: branch.sourceBranchId,
                    forkEventIndex: branch.forkEventIndex,
                    history: structuredClone(history),
                    lastSeenEventIndex: pending ? 0 : branch.tipEventIndex,
                    undoCheckpointEventIndex: 0,
                    events: fixture.events
                        .filter((event) => event.branchId === branch.branchId)
                        .map((event) => markRecorded(event, !pending)),
                    mirrored: !pending,
                } satisfies PersistedServerBranch<TState>,
            ];
        }),
    );

    return {
        docId: fixture.docId,
        appId: fixture.appId ?? '',
        storageVersion: 4,
        protocolVersion: SERVER_PROTOCOL_VERSION,
        schemaVersion: fixture.schemaVersion,
        schemaFingerprint: fixture.schemaFingerprint,
        schemaFingerprintHash:
            scenario === 'stale-schema'
                ? `stale-${fixture.schemaFingerprintHash}`
                : fixture.schemaFingerprintHash,
        activeBranchId: 'main',
        branches,
        branchList: fixture.branches.map((branch) => ({
            ...branch,
            pending: pending && branch.branchId !== 'main',
        })),
        updatedAt: fixture.lastAccessedAt,
    };
}

function markRecorded(event: ServerBranchEvent, recorded: boolean): ServerBranchEvent {
    return {...structuredClone(event), recorded} as ServerBranchEvent;
}
