import type {IJsonSchemaCollection, IValidation} from 'typia';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import type {SyncedContext, SyncedTransport} from 'umkehr/react-crdt';
import type {ReactElement} from 'react';

export type GridSlot = 'left' | 'right';

export type AppPanelProps = {
    actor: string;
    title: string;
    queued?: number;
    gridSlot?: GridSlot | 'full';
};

export type SyncedProvider<TState> = (props: {
    children: ReactElement;
    initial: CrdtLocalHistory<TState>;
    transport: SyncedTransport;
    save?(history: CrdtLocalHistory<TState>): void;
}) => ReactElement;

export type CrdtAppDefinition<TState> = {
    id: string;
    title: string;
    docId: string;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
    createInitialHistory(): CrdtLocalHistory<TState>;
    Provider: SyncedProvider<TState>;
    useSyncedContext(): SyncedContext<TState>;
    renderPanel(props: AppPanelProps): ReactElement;
};
