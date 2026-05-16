import type {OpenApi} from 'typia';

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

export type ArrayItemMeta = {
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: CrdtMeta;
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

export type CrdtMeta =
    | PrimitiveMeta
    | ObjectMeta
    | RecordMeta
    | ArrayMeta
    | TaggedUnionMeta
    | TombstoneMeta;

export type CrdtPathSegment =
    | {type: 'objectField'; key: string; parentCreated: HlcTimestamp}
    | {type: 'recordEntry'; key: string; parentCreated: HlcTimestamp}
    | {
          type: 'arrayItem';
          id: ItemId;
          parentCreated: HlcTimestamp;
          order?: {value: FractionalIndex; ts: HlcTimestamp};
      }
    | {
          type: 'taggedField';
          key: string;
          tagKey: string;
          tagValue: string;
          parentCreated: HlcTimestamp;
          tagTs: HlcTimestamp;
      };

export type CrdtSetUpdate = {
    op: 'set';
    path: CrdtPathSegment[];
    value: JsonValue;
    ts: HlcTimestamp;
};

export type CrdtDeleteUpdate = {
    op: 'delete';
    path: CrdtPathSegment[];
    ts: HlcTimestamp;
};

export type CrdtSetOrderUpdate = {
    op: 'setOrder';
    arrayPath: CrdtPathSegment[];
    orders: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp}>;
};

export type CrdtUpdate = CrdtSetUpdate | CrdtDeleteUpdate | CrdtSetOrderUpdate;

export type PendingUpdate = {
    update: CrdtUpdate;
    reason: 'missing-parent' | 'missing-tag-branch' | 'future-incarnation';
    queuedAt: HlcTimestamp;
};

export type CreateCrdtDocumentOptions = {
    timestamp: HlcTimestamp;
    tagKey?: string;
    schemaIndex?: number;
};
