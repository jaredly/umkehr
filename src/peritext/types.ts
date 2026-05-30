export type RichTextJsonPrimitive = string | number | boolean | null;
export type RichTextJsonValue =
    | RichTextJsonPrimitive
    | RichTextJsonValue[]
    | {[key: string]: RichTextJsonValue | undefined};

export type RichTextActorId = `${string}:${string}`;
export type RichTextOpId = `${number}@${RichTextActorId}`;

export type RichTextAnchor =
    | {type: 'startOfText'}
    | {type: 'endOfText'}
    | {type: 'before' | 'after'; opId: RichTextOpId};

export type RichTextInsertOperation = {
    action: 'insert';
    opId: RichTextOpId;
    afterId: RichTextOpId | null;
    char: string;
};

export type RichTextRemoveOperation = {
    action: 'remove';
    opId: RichTextOpId;
    removedId: RichTextOpId;
};

export type RichTextAddMarkOperation = {
    action: 'addMark';
    opId: RichTextOpId;
    start: RichTextAnchor;
    end: RichTextAnchor;
    markType: string;
    value?: RichTextJsonValue;
};

export type RichTextRemoveMarkOperation = {
    action: 'removeMark';
    opId: RichTextOpId;
    start: RichTextAnchor;
    end: RichTextAnchor;
    markType: string;
};

export type RichTextMarkOperation = RichTextAddMarkOperation | RichTextRemoveMarkOperation;

export type RichTextOperation =
    | RichTextInsertOperation
    | RichTextRemoveOperation
    | RichTextAddMarkOperation
    | RichTextRemoveMarkOperation;

export type RichTextCharMeta = {
    opId: RichTextOpId;
    afterId: RichTextOpId | null;
    char: string;
    deleted: boolean;
    markOpsBefore?: RichTextMarkOperation[];
    markOpsAfter?: RichTextMarkOperation[];
};

export type RichTextState = {
    chars: RichTextCharMeta[];
    pending?: RichTextOperation[];
};

export type RichTextSpan = {
    text: string;
    marks?: Record<string, RichTextJsonValue>;
};

export type RichTextRenderView = {
    spans: RichTextSpan[];
    plainText: string;
};

export type RichTextImportSnapshot = {
    spans: RichTextSpan[];
};
