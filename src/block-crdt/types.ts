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

export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent: {
        ts: HLC | [HLC, Lamport[], HLC];
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
    order: {index: LseqId; ts: HLC; parent: Lamport};
    status: {archived: boolean; ts: HLC};
};

export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    marks: Record<string, Mark>;
    splits: Record<string, SplitRecord>;
    maxSeenCount: number;
};

export type Cache = {
    blockChildren: Record<string, string[]>;
    charContents: Record<string, string[]>;
};

export type CachedState = {state: State; cache: Cache};
