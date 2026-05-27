import type {EphemeralMessage, SyncedContext} from '../src/react-crdt';

type State = {title: string};
type PreviewData = {value: string};
type OtherData = {other: string};

declare const typedCtx: SyncedContext<State, 'type', PreviewData>;
declare const defaultCtx: SyncedContext<State>;
declare const previewMessage: EphemeralMessage<PreviewData>;
declare const otherMessage: EphemeralMessage<OtherData>;

typedCtx.publishEphemeral([previewMessage]);

// @ts-expect-error Ephemeral payload type is fixed by SyncedContext.
typedCtx.publishEphemeral([otherMessage]);

// @ts-expect-error Contexts without an ephemeral payload type default to never.
defaultCtx.publishEphemeral([previewMessage]);
