import type {CrdtDocument} from 'umkehr/crdt';
import type {LocalFirstRole, PersistedBatch, VersionVector} from './types';

export const LOCAL_FIRST_PROTOCOL_VERSION = 1;

export type LocalFirstMessage<TState> =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          peerId?: string;
          docId: string;
          role: LocalFirstRole;
          vector: VersionVector;
      }
    | {
          kind: 'updates';
          version: 1;
          actor: string;
          docId: string;
          batch: PersistedBatch;
      }
    | {
          kind: 'syncRequest';
          version: 1;
          actor: string;
          docId: string;
          vector: VersionVector;
      }
    | {
          kind: 'syncResponse';
          version: 1;
          actor: string;
          docId: string;
          since: VersionVector;
          batches: PersistedBatch[];
          requiresSnapshot?: boolean;
      }
    | {
          kind: 'snapshot';
          version: 1;
          actor: string;
          docId: string;
          document: CrdtDocument<TState>;
          compactedThrough: VersionVector;
      };
