import {applyMany, materializeFormattedBlocks, type Op} from 'umkehr/block-crdt';
import * as hlc from '../../../src/crdt/hlc';
import {
    applyLocalChange,
    createDemoState,
    createDemoStateFromDocument,
    toggleOnline,
    type DemoState,
    type EditorId,
} from './blockEditorRuntime';
import {
    codePreviewKindForLanguage,
    isSlideDeckFooterMode,
    isSlideHexColor,
    isSlideTransition,
    type RichBlockMeta,
} from './blockMeta';
import {richTextCrdtConfig} from './editorCrdtConfig';
import {isPollMeta, isPollVote, type PollVoteCommandData} from './pollBlocks';
import type {RetainedSelectionSet} from './selectionSet';
import {isSerializedImageAttachment, type SerializedImageAttachment} from './attachments';
import type {ImportDocument} from './documentFormat';

export type HistoryAction =
    | {
          type: 'local-change';
          editorId: EditorId;
          ops: Array<Op<RichBlockMeta>>;
          selection: RetainedSelectionSet;
          command?: BlockCommandInfo;
      }
    | {
          type: 'toggle-online';
          editorId: EditorId;
      }
    | {
          type: 'replace-document';
          document: ImportDocument;
          fixtureId?: string;
      };

export type BlockCommandIntent = 'edit' | 'undo' | 'redo';

export type BlockCommandInfo = {
    id: string;
    actor: EditorId;
    intent: BlockCommandIntent;
    targetCommandId?: string;
    beforeSelection: RetainedSelectionSet;
    afterSelection: RetainedSelectionSet;
    label?: string;
    pollVote?: PollVoteCommandData;
};

export type HistoryState = {
    actions: HistoryAction[];
    cursor: number;
    keystrokes: HistoryKeystroke[];
};

export type HistoryKeystroke = {
    sequence: number;
    actionIndex: number;
    editorId: EditorId;
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    blockId: string;
};

export type HistorySnapshot = {
    left: ReplicaSnapshot;
    right: ReplicaSnapshot;
};

export type ReplicaSnapshot = {
    online: boolean;
    queueLength: number;
    blocks: Array<{id: string; depth: number; text: string}>;
    deletedBlockCount: number;
    joinCount: number;
};

export type ExportedHistory = {
    version: 1;
    app: 'examples/block-rich-text';
    actions: HistoryAction[];
    keystrokes: HistoryKeystroke[];
    attachments?: SerializedImageAttachment[];
    finalSnapshot: HistorySnapshot;
};

const EXPORT_VERSION = 1;
const EXPORT_APP = 'examples/block-rich-text';
const EDITOR_IDS = new Set(['left', 'right']);
const REMOVED_OP_TYPES = new Set(['block:status']);
const CURRENT_OP_TYPES = new Set([
    'char',
    'block',
    'char:move',
    'char:delete',
    'block:move',
    'block:delete',
    'block:meta',
    'mark',
    'split-record',
    'join-record',
]);

export const initialHistoryState = (): HistoryState => ({actions: [], cursor: 0, keystrokes: []});

export const resetHistoryState = initialHistoryState;

export const appendHistoryAction = (
    history: HistoryState,
    action: HistoryAction,
): HistoryState => {
    const prefix = history.actions.slice(0, clampCursor(history.cursor, history.actions.length));
    const keystrokes = history.keystrokes.filter((keystroke) => keystroke.actionIndex <= prefix.length);
    const actions = [...prefix, action];
    return {actions, cursor: actions.length, keystrokes};
};

export const appendHistoryKeystroke = (
    history: HistoryState,
    keystroke: Omit<HistoryKeystroke, 'sequence' | 'actionIndex'>,
): HistoryState => {
    const cursor = clampCursor(history.cursor, history.actions.length);
    const keystrokes = history.keystrokes
        .filter((entry) => entry.actionIndex <= cursor)
        .concat({
            ...keystroke,
            actionIndex: cursor,
            sequence: history.keystrokes.filter((entry) => entry.actionIndex <= cursor).length + 1,
        });
    return {...history, cursor, keystrokes};
};

export const setHistoryCursor = (history: HistoryState, cursor: number): HistoryState => ({
    actions: history.actions,
    keystrokes: history.keystrokes,
    cursor: clampCursor(cursor, history.actions.length),
});

export const replayHistory = (
    actions: HistoryAction[],
    cursor = actions.length,
): DemoState => {
    let demo = createDemoState();
    const limit = clampCursor(cursor, actions.length);

    for (const action of actions.slice(0, limit)) {
        demo = applyHistoryActionWithoutClockAdvance(demo, action);
    }

    return advanceReplicaCommandClocks(demo, actions.slice(0, limit));
};

export const applyHistoryAction = (demo: DemoState, action: HistoryAction): DemoState => {
    return advanceReplicaCommandClocks(applyHistoryActionWithoutClockAdvance(demo, action), [action]);
};

const applyHistoryActionWithoutClockAdvance = (demo: DemoState, action: HistoryAction): DemoState => {
    if (action.type === 'replace-document') {
        return createDemoStateFromDocument(action.document);
    }
    if (action.type === 'toggle-online') {
        return toggleOnline(demo, action.editorId);
    }

    const current = demo[action.editorId];
    return applyLocalChange(demo, {
        editorId: action.editorId,
        state: action.ops.length
            ? applyMany(current.state, action.ops, richTextCrdtConfig(current.state))
            : current.state,
        selection: action.selection,
        ops: action.ops,
    });
};

export const buildHistorySnapshot = (demo: DemoState): HistorySnapshot => ({
    left: snapshotReplica(demo.left),
    right: snapshotReplica(demo.right),
});

export const serializeHistory = (
    history: HistoryState,
    attachments: SerializedImageAttachment[] = [],
): string => {
    const actions = history.actions;
    const exported: ExportedHistory = {
        version: EXPORT_VERSION,
        app: EXPORT_APP,
        actions,
        keystrokes: history.keystrokes,
        ...(attachments.length ? {attachments} : {}),
        finalSnapshot: buildHistorySnapshot(replayHistory(actions, actions.length)),
    };
    return `${JSON.stringify(exported, null, 2)}\n`;
};

export const parseHistoryExport = (
    text: string,
): {history: HistoryState; attachments: SerializedImageAttachment[]} | {error: string} => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {error: 'Import file is not valid JSON.'};
    }

    if (!isRecord(parsed)) return {error: 'Import file must contain a JSON object.'};
    if (parsed.version !== EXPORT_VERSION) return {error: 'Unsupported history version.'};
    if (parsed.app !== EXPORT_APP) return {error: 'Import file is for a different app.'};
    if (!Array.isArray(parsed.actions)) return {error: 'Import file is missing actions.'};

    const actions: HistoryAction[] = [];
    for (const [index, action] of parsed.actions.entries()) {
        const valid = parseAction(action);
        if ('error' in valid) return {error: `Action ${index}: ${valid.error}`};
        actions.push(valid.action);
    }
    const keystrokes = parseKeystrokes(parsed.keystrokes);
    if ('error' in keystrokes) return {error: keystrokes.error};
    const attachments = parseAttachments(parsed.attachments);
    if ('error' in attachments) return {error: attachments.error};

    if (!isSnapshot(parsed.finalSnapshot)) {
        return {error: 'Import file has an invalid final snapshot.'};
    }

    try {
        replayHistory(actions, actions.length);
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : 'Import actions could not be replayed.',
        };
    }

    return {
        history: {actions, cursor: actions.length, keystrokes: keystrokes.keystrokes},
        attachments: attachments.attachments,
    };
};

const clampCursor = (cursor: number, max: number) => {
    if (!Number.isFinite(cursor)) return max;
    return Math.max(0, Math.min(Math.trunc(cursor), max));
};

const snapshotReplica = (replica: DemoState[EditorId]): ReplicaSnapshot => ({
    online: replica.online,
    queueLength: replica.queue.length,
    blocks: materializeFormattedBlocks(replica.state).map((block) => ({
        id: block.id,
        depth: block.depth,
        text: block.runs.map((run) => run.text).join(''),
    })),
    deletedBlockCount: Object.values(replica.state.state.blocks).filter((block) => block.deleted).length,
    joinCount: Object.keys(replica.state.state.joins).length,
});

const parseAction = (value: unknown): {action: HistoryAction} | {error: string} => {
    if (!isRecord(value)) return {error: 'must be an object.'};

    if (value.type === 'replace-document') {
        if (!Array.isArray(value.document)) return {error: 'replace-document document must be an array.'};
        if (value.fixtureId !== undefined && typeof value.fixtureId !== 'string') {
            return {error: 'replace-document fixtureId must be a string.'};
        }
        return {
            action: {
                type: 'replace-document',
                document: value.document as ImportDocument,
                ...(typeof value.fixtureId === 'string' ? {fixtureId: value.fixtureId} : {}),
            },
        };
    }

    if (!isEditorId(value.editorId)) return {error: 'has an invalid editorId.'};

    if (value.type === 'toggle-online') {
        return {action: {type: 'toggle-online', editorId: value.editorId}};
    }

    if (value.type !== 'local-change') return {error: 'has an invalid action type.'};
    if (!Array.isArray(value.ops)) return {error: 'local-change ops must be an array.'};
    for (const [index, op] of value.ops.entries()) {
        const opError = validateOp(op);
        if (opError) return {error: `op ${index} ${opError}`};
    }
    if (!isRetainedSelectionSet(value.selection)) {
        return {error: 'local-change selection must be a retained selection set.'};
    }
    const command = parseCommandInfo(value.command);
    if ('error' in command) return {error: `local-change command ${command.error}`};

    return {
        action: {
            type: 'local-change',
            editorId: value.editorId,
            ops: value.ops as Array<Op<RichBlockMeta>>,
            selection: value.selection,
            ...(command.command ? {command: command.command} : {}),
        },
    };
};

const parseCommandInfo = (
    value: unknown,
): {command?: BlockCommandInfo} | {error: string} => {
    if (value === undefined) return {};
    if (!isRecord(value)) return {error: 'must be an object.'};
    if (typeof value.id !== 'string') return {error: 'id must be a string.'};
    if (!isEditorId(value.actor)) return {error: 'actor must be left or right.'};
    if (value.intent !== 'edit' && value.intent !== 'undo' && value.intent !== 'redo') {
        return {error: 'intent must be edit, undo, or redo.'};
    }
    if (value.intent === 'edit' && value.targetCommandId !== undefined) {
        return {error: 'edit must not include targetCommandId.'};
    }
    if ((value.intent === 'undo' || value.intent === 'redo') && typeof value.targetCommandId !== 'string') {
        return {error: 'undo and redo require targetCommandId.'};
    }
    if (!isRetainedSelectionSet(value.beforeSelection)) {
        return {error: 'beforeSelection must be a retained selection set.'};
    }
    if (!isRetainedSelectionSet(value.afterSelection)) {
        return {error: 'afterSelection must be a retained selection set.'};
    }
    if (value.label !== undefined && typeof value.label !== 'string') {
        return {error: 'label must be a string.'};
    }
    if (value.pollVote !== undefined && !isPollVoteCommandData(value.pollVote)) {
        return {error: 'pollVote must be a valid poll vote command.'};
    }
    const targetCommandId = typeof value.targetCommandId === 'string' ? value.targetCommandId : undefined;
    const label = typeof value.label === 'string' ? value.label : undefined;
    return {
        command: {
            id: value.id,
            actor: value.actor,
            intent: value.intent,
            ...(targetCommandId ? {targetCommandId} : {}),
            beforeSelection: value.beforeSelection,
            afterSelection: value.afterSelection,
            ...(label ? {label} : {}),
            ...(value.pollVote ? {pollVote: value.pollVote} : {}),
        },
    };
};

const isPollVoteCommandData = (value: unknown): value is PollVoteCommandData =>
    isRecord(value) &&
    typeof value.blockId === 'string' &&
    typeof value.userId === 'string' &&
    value.userId.length > 0 &&
    (value.before === undefined || isPollVote(value.before)) &&
    isPollVote(value.after);

const parseKeystrokes = (
    value: unknown,
): {keystrokes: HistoryKeystroke[]} | {error: string} => {
    if (value === undefined) return {keystrokes: []};
    if (!Array.isArray(value)) return {error: 'Import file keystrokes must be an array.'};
    const keystrokes: HistoryKeystroke[] = [];
    for (const [index, entry] of value.entries()) {
        if (!isKeystroke(entry)) return {error: `Keystroke ${index} has an invalid shape.`};
        keystrokes.push(entry);
    }
    return {keystrokes};
};

const parseAttachments = (
    value: unknown,
): {attachments: SerializedImageAttachment[]} | {error: string} => {
    if (value === undefined) return {attachments: []};
    if (!Array.isArray(value)) return {error: 'Import file attachments must be an array.'};
    const attachments: SerializedImageAttachment[] = [];
    const seen = new Set<string>();
    for (const [index, attachment] of value.entries()) {
        if (!isSerializedImageAttachment(attachment)) {
            return {error: `Attachment ${index} has an invalid shape.`};
        }
        if (seen.has(attachment.id)) return {error: `Attachment ${index} duplicates an id.`};
        seen.add(attachment.id);
        attachments.push(attachment);
    }
    return {attachments};
};

const isKeystroke = (value: unknown): value is HistoryKeystroke =>
    isRecord(value) &&
    Number.isInteger(value.sequence) &&
    Number.isInteger(value.actionIndex) &&
    isEditorId(value.editorId) &&
    typeof value.key === 'string' &&
    typeof value.code === 'string' &&
    typeof value.altKey === 'boolean' &&
    typeof value.ctrlKey === 'boolean' &&
    typeof value.metaKey === 'boolean' &&
    typeof value.shiftKey === 'boolean' &&
    typeof value.repeat === 'boolean' &&
    typeof value.blockId === 'string';

const validateOp = (value: unknown): string | null => {
    if (!isRecord(value)) return 'must be an object.';
    if (typeof value.type !== 'string') return 'is missing a type.';
    if (REMOVED_OP_TYPES.has(value.type)) return 'uses removed block:status shape.';
    if (!CURRENT_OP_TYPES.has(value.type)) return 'has an unknown type.';

    if ((value.type === 'block' || value.type === 'block:move') && 'order' in value) {
        if (!isBlockOrder(value.order)) return 'has invalid block order.';
    }
    if (value.type === 'block') {
        if (!isRecord(value.block)) return 'has invalid block record.';
        if (typeof value.block.deleted !== 'boolean') return 'block must use deleted boolean.';
        if (!isBlockOrder(value.block.order)) return 'block has invalid order.';
        if ('status' in value.block) return 'block uses removed status shape.';
        if (!isRichBlockMeta(value.block.meta)) {
            return 'block has invalid rich block metadata.';
        }
    }
    if (value.type === 'block:meta') {
        if (!isRichBlockMeta(value.meta)) {
            return 'has invalid rich block metadata.';
        }
    }
    if (value.type === 'join-record' && !isRecord(value.join)) {
        return 'has invalid join record.';
    }
    return null;
};

const isBlockOrder = (value: unknown) =>
    isRecord(value) &&
    isLamport(value.id) &&
    Array.isArray(value.path) &&
    value.path.length > 0 &&
    value.path.every(isLamport) &&
    isRecord(value.index) &&
    isBlockOrderTs(value.ts);

const isBlockOrderTs = (value: unknown): boolean =>
    typeof value === 'string' ||
    (Array.isArray(value) &&
        value.length === 3 &&
        typeof value[0] === 'string' &&
        isRecord(value[1]) &&
        typeof value[2] === 'string');

const isRichBlockMeta = (value: unknown): value is RichBlockMeta => {
    if (!isRecord(value) || typeof value.type !== 'string' || typeof value.ts !== 'string') {
        return false;
    }
    switch (value.type) {
        case 'paragraph':
        case 'blockquote':
        case 'table':
        case 'kanban':
            return true;
        case 'slide_deck':
            return (
                Number.isInteger(value.width) &&
                (value.width as number) > 0 &&
                Number.isInteger(value.height) &&
                (value.height as number) > 0 &&
                isSlideDeckFooterMode(value.footer)
            );
        case 'slide':
            return (
                typeof value.showTitle === 'boolean' &&
                isSlideHexColor(value.backgroundColor) &&
                isSlideTransition(value.transition)
            );
        case 'poll':
            return isPollMeta(value);
        case 'heading':
            return value.level === 1 || value.level === 2 || value.level === 3;
        case 'list_item':
            return value.kind === 'ordered' || value.kind === 'unordered';
        case 'todo':
            return typeof value.checked === 'boolean';
        case 'code':
            return (
                typeof value.language === 'string' &&
                (value.preview === undefined ||
                    ((value.preview === 'mermaid' || value.preview === 'vega-lite') &&
                        codePreviewKindForLanguage(value.language) === value.preview))
            );
        case 'callout':
            return value.kind === 'info' || value.kind === 'warning' || value.kind === 'error';
        case 'image':
            return (
                typeof value.attachmentId === 'string' &&
                value.attachmentId.length > 0 &&
                isImagePresentationSize(value.size)
            );
        case 'preview':
            return typeof value.url === 'string' && (value.preview === null || isPreviewMetadata(value.preview));
        default:
            return false;
    }
};

const isPreviewMetadata = (value: unknown): boolean =>
    isRecord(value) &&
    optionalString(value.title) &&
    optionalString(value.description) &&
    optionalString(value.siteName) &&
    optionalString(value.imageUrl) &&
    optionalString(value.resolvedUrl) &&
    optionalString(value.fetchedAt);

const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

const isImagePresentationSize = (value: unknown): boolean =>
    value === 'small' || value === 'medium' || value === 'large' || value === 'original';

const isRetainedSelectionSet = (value: unknown): value is RetainedSelectionSet => {
    if (!isRecord(value) || typeof value.primaryId !== 'string' || !Array.isArray(value.entries)) {
        return false;
    }
    return value.entries.every(
        (entry) =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            isRetainedSelection(entry.selection),
    );
};

const isRetainedSelection = (value: unknown): boolean => {
    if (!isRecord(value) || typeof value.type !== 'string') return false;
    if (value.type === 'caret') return isRetainedPoint(value.point);
    if (value.type === 'range') return isRetainedPoint(value.anchor) && isRetainedPoint(value.focus);
    return false;
};

const isRetainedPoint = (value: unknown): boolean =>
    isRecord(value) &&
    typeof value.blockId === 'string' &&
    (value.affinity === 'before' || value.affinity === 'after') &&
    (value.charId === null || typeof value.charId === 'string');

const isSnapshot = (value: unknown): value is HistorySnapshot =>
    isRecord(value) && isReplicaSnapshot(value.left) && isReplicaSnapshot(value.right);

const isReplicaSnapshot = (value: unknown): value is ReplicaSnapshot =>
    isRecord(value) &&
    typeof value.online === 'boolean' &&
    typeof value.queueLength === 'number' &&
    typeof value.deletedBlockCount === 'number' &&
    typeof value.joinCount === 'number' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
        (block) =>
            isRecord(block) &&
            typeof block.id === 'string' &&
            typeof block.depth === 'number' &&
            typeof block.text === 'string',
    );

const advanceReplicaCommandClocks = (demo: DemoState, actions: HistoryAction[]): DemoState => {
    let leftClock = demo.left.clock;
    let rightClock = demo.right.clock;
    for (const action of actions) {
        if (action.type !== 'local-change' || !action.command) continue;
        const timestamp = hlc.tryUnpack(action.command.id);
        if (!timestamp) continue;
        if (action.command.actor === 'left') {
            leftClock = hlc.recv(leftClock, timestamp, 0);
        } else {
            rightClock = hlc.recv(rightClock, timestamp, 0);
        }
    }
    return {
        left: {...demo.left, clock: leftClock},
        right: {...demo.right, clock: rightClock},
    };
};

const isLamport = (value: unknown): value is [number, string] =>
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    typeof value[1] === 'string';

const isEditorId = (value: unknown): value is EditorId =>
    typeof value === 'string' && EDITOR_IDS.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
