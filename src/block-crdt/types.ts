import {LseqId} from './lseq';

export type Lamport = [number, string];
export type HLC = string;
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {[key: string]: JsonValue};

export type Boundary = {
    id: Lamport;
    at: 'before' | 'after';
};

export type Mark = {
    id: Lamport;
    start: Boundary;
    end: Boundary;
    remove: boolean;
    type: string;
    data?: JsonValue;
    crossedSplits: Lamport[];
};

export type SplitRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
};

export type JoinRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    tail: Lamport;
    ts: HLC;
};

export type CharParentTs = HLC | [HLC, Lamport[], HLC];
export type IncidentalBlockOrderTs = [HLC, LseqId, HLC];
export type BlockOrderTs = HLC | IncidentalBlockOrderTs;

export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent: {
        ts: CharParentTs;
        id: Lamport;
    };
    // NOTE: getting formatting to be happy will have some 'markOpsBefore/markOpsAfter' stuff going on.
    // as well as privenance for splits or somehting like that
};

export type Block = {
    id: Lamport;
    meta:
        | {type: 'paragraph'; ts: HLC}
        | {type: 'blockquote'; ts: HLC}
        | {type: 'bullets'; ts: HLC}
        | {type: 'checkboxes'; ts: HLC; checked: Record<string, {ts: HLC; checked: boolean}>};
    order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
    deleted: boolean;
};

export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    marks: Record<string, Mark>;
    splits: Record<string, SplitRecord>;
    joins: Record<string, JoinRecord>;
    maxSeenCount: number;
};

export type Cache = {
    blockChildren: Record<string, string[]>;
    charContents: Record<string, string[]>;
    joinSentinels: Record<string, JoinRecord>;
    joinedBlocks: Record<string, JoinRecord>;
};

export type CachedState = {state: State; cache: Cache};
