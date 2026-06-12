import type {OpenApi} from 'typia';
import type {LeafCrdtPluginAny, LeafPluginDescriptor, LeafPluginRegistry} from './plugins.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue | undefined};
export type HlcTimestamp = string;
export type ItemId = string;
export type FractionalIndex = string;

export type Schema = OpenApi.IJsonSchema;
export type Components = OpenApi.IComponents;

export type CrdtDocument<T> = {
    state: T;
    meta: CrdtMeta;
    pending: PendingUpdate[];
    schema: CrdtSchemaContext;
};

export type CrdtSchemaContext = {
    root: Schema;
    components: Components;
    tagKey: string;
    leafPlugins: LeafPluginRegistry;
    requiredLeafPlugins: LeafPluginDescriptor[];
};

export type PrimitiveMeta = {
    kind: 'primitive';
    ts: HlcTimestamp;
    value: JsonPrimitive;
};

export type ObjectMeta = {
    kind: 'object';
    created: HlcTimestamp;
    fields: Record<string, CrdtMeta>;
};

export type RecordMeta = {
    kind: 'record';
    created: HlcTimestamp;
    entries: Record<string, CrdtMeta>;
};

export type ArrayMeta = {
    kind: 'array';
    created: HlcTimestamp;
    items: Record<ItemId, ArrayItemMeta>;
};

export type ArrayItemMeta =
    | {
          kind: 'live';
          order: {value: FractionalIndex; ts: HlcTimestamp};
          value: CrdtMeta;
      }
    | {
          kind: 'deleted';
          deleted: HlcTimestamp;
      };

export type TaggedUnionMeta = {
    kind: 'tagged';
    created: HlcTimestamp;
    tagKey: string;
    tagValue: string;
    tagTs: HlcTimestamp;
    fields: Record<string, CrdtMeta>;
};

export type TombstoneMeta = {
    kind: 'tombstone';
    deleted: HlcTimestamp;
};

export type LeafMeta<TData extends JsonValue = JsonValue> = {
    kind: 'leaf';
    plugin: string;
    created: HlcTimestamp;
    data: TData;
};

export type CrdtMeta =
    | PrimitiveMeta
    | ObjectMeta
    | RecordMeta
    | ArrayMeta
    | TaggedUnionMeta
    | TombstoneMeta
    | LeafMeta;

export type CrdtPathSegment =
    | {type: 'objectField'; key: string; parentCreated: HlcTimestamp}
    | {type: 'recordEntry'; key: string; parentCreated: HlcTimestamp}
    | {
          type: 'arrayItem';
          id: ItemId;
          parentCreated: HlcTimestamp;
      }
    | {
          type: 'taggedField';
          key: string;
          tagKey: string;
          tagValue: string;
          parentCreated: HlcTimestamp;
          tagTs: HlcTimestamp;
      };

export type CrdtCommandInfo = {
    commandId: HlcTimestamp;
    commandSeq: number;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: HlcTimestamp;
};

export type CrdtInsertUpdate = {
    op: 'insert';
    arrayPath: CrdtPathSegment[];
    id: ItemId;
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

export type CrdtSetUpdate = {
    op: 'set';
    path: CrdtPathSegment[];
    value: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

export type CrdtDeleteUpdate = {
    op: 'delete';
    path: CrdtPathSegment[];
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

export type CrdtSetOrderUpdate = {
    op: 'setOrder';
    arrayPath: CrdtPathSegment[];
    orders: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp}>;
    command?: CrdtCommandInfo;
};

export type CrdtLeafUpdate<TOperation extends JsonValue = JsonValue> = {
    op: 'leaf';
    plugin: string;
    path: CrdtPathSegment[];
    change: TOperation;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

export type CrdtUpdate =
    | CrdtInsertUpdate
    | CrdtSetUpdate
    | CrdtDeleteUpdate
    | CrdtSetOrderUpdate
    | CrdtLeafUpdate;

export type PendingUpdate = {
    update: CrdtUpdate;
    reason: 'missing-parent' | 'missing-tag-branch' | 'future-incarnation';
    queuedAt: HlcTimestamp;
};

export type CreateCrdtDocumentOptions = {
    timestamp: HlcTimestamp;
    tagKey?: string;
    schemaIndex?: number;
    leafPlugins?: readonly LeafCrdtPluginAny[];
    sessionId?: string;
};
