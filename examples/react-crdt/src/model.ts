import typia from 'typia';
import {createPatchBuilder, type DraftPatch} from 'umkehr';
import {hlc, type CrdtUpdate} from 'umkehr/crdt';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type State = {
    todos: Todo[];
};

export type ReplicaId = string;
export type TodoDraft = DraftPatch<State, 'type', undefined>;
export type ReceiveUpdate = (update: CrdtUpdate) => void;
export type RegisterReplica = (id: ReplicaId, receive: ReceiveUpdate) => () => void;
export type GridSlot = 'left' | 'right';
export type QueueCount = {label: string; count: number};

export const replicas = [
    {id: 'replica-a', title: 'Replica A', label: 'A'},
    {id: 'replica-b', title: 'Replica B', label: 'B'},
] as const;

export const schema = typia.json.schemas<[State], '3.1'>();
export const $ = createPatchBuilder<State>();

export const initialState: State = {
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Try CRDT sync', done: false},
    ],
};

export const initialTimestamp = hlc.pack(hlc.init('seed', 0));
