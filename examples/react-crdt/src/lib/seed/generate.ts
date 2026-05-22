import {schemaFingerprint, schemaFingerprintHash} from 'umkehr/migration';
import {hlc, type HlcTimestamp, type JsonValue} from 'umkehr/crdt';
import {
    initialTodoState,
    todoSchema,
    type Todo,
    type TodoState,
} from '../../apps/todos/schema';
import {
    initialWhiteboardState,
    whiteboardSchema,
    type WhiteboardElement,
    type WhiteboardState,
} from '../../apps/whiteboard/schema';
import type {
    SeedDatabasePayload,
    SeedDocument,
    ServerBranch,
    ServerBranchEvent,
    ServerMergeEvent,
    ServerUpdateEvent,
    ServerUser,
} from '../../../../react-crdt-server/src/types';

const TODO_SCHEMA_VERSION = 1;
const WHITEBOARD_SCHEMA_VERSION = 1;

export type SeedSize = 'small' | 'default' | 'large';

export type SeedGeneratorOptions = {
    date?: string;
    size?: SeedSize;
};

type FixtureClock = {
    generatedAt: string;
    timestamp(actor: string): HlcTimestamp;
    iso(): string;
};

type BranchBuilder<TState> = {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    createdAt: string;
    lastAccessedAt: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    branches: ServerBranch[];
    events: ServerBranchEvent[];
    state: TState;
};

const users: ServerUser[] = [
    {userId: 'seed-user-ada', nickname: 'Ada'},
    {userId: 'seed-user-ben', nickname: 'Ben'},
    {userId: 'seed-user-cy', nickname: 'Cy'},
    {userId: 'seed-user-dee', nickname: 'Dee'},
];

const actors = {
    ada: 'seed-user-ada:seed-session-ada',
    ben: 'seed-user-ben:seed-session-ben',
    cy: 'seed-user-cy:seed-session-cy',
    dee: 'seed-user-dee:seed-session-dee',
} as const;

const docClocks = new WeakMap<object, FixtureClock>();

if (isMainModule()) {
    const payload = generateSeedDatabasePayload(parseArgs(process.argv));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function generateSeedDatabasePayload({
    date,
    size = 'default',
}: SeedGeneratorOptions = {}): SeedDatabasePayload {
    const clock = createClock(date);
    return {
        generatedAt: clock.generatedAt,
        users,
        documents: [
            todosSmall(clock),
            todosManyItems(clock, itemCountFor(size)),
            todosManyEvents(clock, eventCountFor(size)),
            todosBranches(clock),
            todosMergeReview(clock),
            whiteboardManyElements(clock, whiteboardElementCountFor(size)),
            whiteboardBranches(clock),
        ],
    };
}

function todosSmall(clock: FixtureClock): SeedDocument {
    const doc = createTodoDoc({
        docId: 'todos-small',
        title: 'Todos: small baseline',
        sizeLabel: '4 todos, 2 events',
        sizeRank: 10,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#fff7ed',
        todos: [
            {id: 'setup', title: 'Create seed database', done: true},
            {id: 'review', title: 'Review seeded documents', done: false},
            {id: 'switch', title: 'Switch documents from the dropdown', done: false},
            {id: 'notes', title: 'Capture observations', done: false},
        ],
    });
    setTodos(doc, actors.ben, {
        ...doc.state,
        todos: doc.state.todos.map((todo) =>
            todo.id === 'review' ? {...todo, done: true} : todo,
        ),
    });
    return finishDocument(doc);
}

function todosManyItems(clock: FixtureClock, count: number): SeedDocument {
    const doc = createTodoDoc({
        docId: 'todos-many-items',
        title: `Todos: ${count} items`,
        sizeLabel: `${count} todos, 1 event`,
        sizeRank: 20,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#eef6ff',
        todos: Array.from({length: count}, (_, index) => ({
            id: `todo-${index + 1}`,
            title: `Generated todo ${index + 1}`,
            done: index % 3 === 0,
        })),
    });
    return finishDocument(doc);
}

function todosManyEvents(clock: FixtureClock, count: number): SeedDocument {
    const doc = createTodoDoc({
        docId: 'todos-many-events',
        title: `Todos: ${count} updates`,
        sizeLabel: `${count} events`,
        sizeRank: 30,
        clock,
    });
    let state: TodoState = {
        bgcolor: '#f8fafc',
        todos: Array.from({length: 12}, (_, index) => ({
            id: `slot-${index + 1}`,
            title: `Event target ${index + 1}`,
            done: false,
        })),
    };
    const actorList = [actors.ada, actors.ben, actors.cy, actors.dee];
    for (let index = 0; index < count; index++) {
        const target = index % state.todos.length;
        const todos = state.todos.map((todo, todoIndex) =>
            todoIndex === target
                ? {
                      ...todo,
                      title: `Event ${index + 1} touched ${todo.id}`,
                      done: index % 2 === 0,
                  }
                : todo,
        );
        state = {
            bgcolor: index % 2 === 0 ? '#f8fafc' : '#ecfeff',
            todos,
        };
        setTodos(doc, actorList[index % actorList.length], state);
    }
    return finishDocument(doc);
}

function todosBranches(clock: FixtureClock): SeedDocument {
    const doc = createTodoDoc({
        docId: 'todos-branches',
        title: 'Todos: branch fan-out',
        sizeLabel: '3 branches, 5 events',
        sizeRank: 40,
        clock,
    });
    const base: TodoState = {
        bgcolor: '#f7fee7',
        todos: [
            {id: 'a', title: 'Mainline task', done: false},
            {id: 'b', title: 'Branch task', done: false},
        ],
    };
    setTodos(doc, actors.ada, base);
    createBranch(doc, 'feature-copy', 'Feature copy', 'main', 1);
    createBranch(doc, 'feature-cleanup', 'Feature cleanup', 'main', 1);
    setTodos(doc, actors.ben, {...base, todos: [...base.todos, todo('copy', 'Write alternate copy')]}, 'feature-copy');
    setTodos(doc, actors.cy, {...base, bgcolor: '#fef2f2'}, 'feature-cleanup');
    setTodos(doc, actors.dee, {...base, todos: base.todos.map((item) => item.id === 'a' ? {...item, done: true} : item)});
    return finishDocument(doc);
}

function todosMergeReview(clock: FixtureClock): SeedDocument {
    const doc = createTodoDoc({
        docId: 'todos-merge-review',
        title: 'Todos: merge review',
        sizeLabel: '3 branches, 7 events',
        sizeRank: 50,
        clock,
    });
    const base: TodoState = {
        bgcolor: '#fff',
        todos: [todo('plan', 'Plan release'), todo('ship', 'Ship release')],
    };
    setTodos(doc, actors.ada, base);
    createBranch(doc, 'design', 'Design', 'main', 1);
    createBranch(doc, 'qa', 'QA', 'main', 1);
    setTodos(doc, actors.ben, {...base, bgcolor: '#f5f3ff'}, 'design');
    setTodos(doc, actors.cy, {...base, todos: [...base.todos, todo('test', 'Test migration path')]}, 'qa');
    setTodos(doc, actors.cy, {...base, todos: [...base.todos, todo('test', 'Test migration path'), todo('signoff', 'QA signoff')]}, 'qa');
    setTodos(doc, actors.ada, {...base, todos: base.todos.map((item) => item.id === 'plan' ? {...item, done: true} : item)});
    mergeBranch(doc, actors.dee, 'main', 'design', 1, 'merge-design');
    mergeBranch(doc, actors.dee, 'main', 'qa', 2, 'merge-qa');
    return finishDocument(doc);
}

function whiteboardManyElements(clock: FixtureClock, count: number): SeedDocument {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-many-elements',
        title: `Whiteboard: ${count} elements`,
        sizeLabel: `${count} elements, 1 event`,
        sizeRank: 60,
        clock,
    });
    setWhiteboard(doc, actors.ada, {
        background: '#f8fafc',
        elements: Object.fromEntries(
            Array.from({length: count}, (_, index) => {
                const element = noteElement(index, actors.ada, clock.generatedAt);
                return [element.id, element];
            }),
        ),
    });
    return finishDocument(doc);
}

function whiteboardBranches(clock: FixtureClock): SeedDocument {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-branches',
        title: 'Whiteboard: branches',
        sizeLabel: '3 branches, 6 events',
        sizeRank: 70,
        clock,
    });
    const base: WhiteboardState = {
        background: '#f8fafc',
        elements: {
            intro: noteElement(0, actors.ada, clock.generatedAt, 'intro', 'Kickoff'),
            sketch: strokeElement(1, actors.ada, clock.generatedAt, 'sketch'),
        },
    };
    setWhiteboard(doc, actors.ada, base);
    createBranch(doc, 'layout', 'Layout', 'main', 1);
    createBranch(doc, 'annotations', 'Annotations', 'main', 1);
    setWhiteboard(doc, actors.ben, {
        ...base,
        elements: {...base.elements, layout: noteElement(2, actors.ben, clock.generatedAt, 'layout', 'Layout pass')},
    }, 'layout');
    setWhiteboard(doc, actors.cy, {
        ...base,
        elements: {...base.elements, annotation: emojiElement(3, actors.cy, clock.generatedAt, 'annotation')},
    }, 'annotations');
    setWhiteboard(doc, actors.ada, {
        ...base,
        background: '#f0fdf4',
    });
    mergeBranch(doc, actors.dee, 'main', 'layout', 1, 'merge-layout');
    mergeBranch(doc, actors.dee, 'main', 'annotations', 1, 'merge-annotations');
    return finishDocument(doc);
}

function createTodoDoc({
    docId,
    title,
    sizeLabel,
    sizeRank,
    clock,
}: {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    clock: FixtureClock;
}): BranchBuilder<TodoState> {
    return createDoc({
        docId,
        title,
        sizeLabel,
        sizeRank,
        schemaVersion: TODO_SCHEMA_VERSION,
        schemaFingerprint: schemaFingerprint(todoSchema, 'type'),
        schemaFingerprintHash: schemaFingerprintHash(todoSchema, 'type'),
        initialState: initialTodoState,
        clock,
    });
}

function createWhiteboardDoc({
    docId,
    title,
    sizeLabel,
    sizeRank,
    clock,
}: {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    clock: FixtureClock;
}): BranchBuilder<WhiteboardState> {
    return createDoc({
        docId,
        title,
        sizeLabel,
        sizeRank,
        schemaVersion: WHITEBOARD_SCHEMA_VERSION,
        schemaFingerprint: schemaFingerprint(whiteboardSchema, 'type'),
        schemaFingerprintHash: schemaFingerprintHash(whiteboardSchema, 'type'),
        initialState: initialWhiteboardState,
        clock,
    });
}

function createDoc<TState>({
    docId,
    title,
    sizeLabel,
    sizeRank,
    schemaVersion,
    schemaFingerprint,
    schemaFingerprintHash,
    initialState,
    clock,
}: {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    initialState: TState;
    clock: FixtureClock;
}): BranchBuilder<TState> {
    const now = clock.iso();
    return {
        docId,
        title,
        sizeLabel,
        sizeRank,
        createdAt: now,
        lastAccessedAt: now,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        branches: [{
            docId,
            branchId: 'main',
            name: 'main',
            tipEventIndex: 0,
            createdAt: now,
            updatedAt: now,
        }],
        events: [],
        state: structuredClone(initialState),
    };
}

function setTodos(
    doc: BranchBuilder<TodoState>,
    actor: string,
    state: TodoState,
    branchId = 'main',
) {
    appendSetUpdate(doc, branchId, actor, state);
}

function setWhiteboard(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    state: WhiteboardState,
    branchId = 'main',
) {
    appendSetUpdate(doc, branchId, actor, state);
}

function appendSetUpdate<TState>(
    doc: BranchBuilder<TState>,
    branchId: string,
    actor: string,
    state: TState,
) {
    const branch = branchFor(doc, branchId);
    const eventIndex = branch.tipEventIndex + 1;
    const ts = nextTimestamp(doc, actor);
    const receivedAt = doc.lastAccessedAt;
    const event: ServerUpdateEvent = {
        kind: 'update',
        docId: doc.docId,
        branchId,
        eventIndex,
        origin: actor,
        hlcTimestamp: ts,
        receivedAt,
        update: {
            op: 'set',
            path: [],
            value: structuredClone(state) as JsonValue,
            ts,
        },
    };
    doc.events.push(event);
    branch.tipEventIndex = eventIndex;
    branch.updatedAt = receivedAt;
    doc.state = structuredClone(state);
}

function createBranch<TState>(
    doc: BranchBuilder<TState>,
    branchId: string,
    name: string,
    sourceBranchId: string,
    forkEventIndex: number,
) {
    const now = doc.lastAccessedAt;
    doc.branches.push({
        docId: doc.docId,
        branchId,
        name,
        sourceBranchId,
        forkEventIndex,
        tipEventIndex: 0,
        createdAt: now,
        updatedAt: now,
    });
}

function mergeBranch<TState>(
    doc: BranchBuilder<TState>,
    actor: string,
    targetBranchId: string,
    sourceBranchId: string,
    sourceThroughEventIndex: number,
    mergeId: string,
) {
    const branch = branchFor(doc, targetBranchId);
    const eventIndex = branch.tipEventIndex + 1;
    const createdAt = nextIso(doc, actor);
    const event: ServerMergeEvent = {
        kind: 'merge',
        mergeId,
        docId: doc.docId,
        branchId: targetBranchId,
        eventIndex,
        sourceBranchId,
        sourceThroughEventIndex,
        actor,
        createdAt,
    };
    doc.events.push(event);
    branch.tipEventIndex = eventIndex;
    branch.updatedAt = createdAt;
}

function finishDocument<TState>(doc: BranchBuilder<TState>): SeedDocument {
    return {
        docId: doc.docId,
        title: doc.title,
        sizeLabel: doc.sizeLabel,
        sizeRank: doc.sizeRank,
        createdAt: doc.createdAt,
        lastAccessedAt: doc.lastAccessedAt,
        schemaVersion: doc.schemaVersion,
        schemaFingerprint: doc.schemaFingerprint,
        schemaFingerprintHash: doc.schemaFingerprintHash,
        branches: doc.branches,
        events: doc.events,
    };
}

function branchFor<TState>(doc: BranchBuilder<TState>, branchId: string) {
    const branch = doc.branches.find((candidate) => candidate.branchId === branchId);
    if (!branch) throw new Error(`Unknown branch ${branchId} in ${doc.docId}.`);
    return branch;
}

function nextTimestamp<TState>(doc: BranchBuilder<TState>, actor: string) {
    const timestamp = docClock(doc).timestamp(actor);
    doc.lastAccessedAt = new Date(hlc.unpack(timestamp).ts).toISOString();
    return timestamp;
}

function nextIso<TState>(doc: BranchBuilder<TState>, actor: string) {
    const timestamp = nextTimestamp(doc, actor);
    return new Date(hlc.unpack(timestamp).ts).toISOString();
}

function docClock<TState>(doc: BranchBuilder<TState>) {
    let clock = docClocks.get(doc) as FixtureClock | undefined;
    if (!clock) {
        clock = createClock(doc.createdAt);
        docClocks.set(doc, clock);
    }
    return clock;
}

function todo(id: string, title: string): Todo {
    return {id, title, done: false};
}

function noteElement(
    index: number,
    actor: string,
    at: string,
    id = `note-${index + 1}`,
    text = `Generated note ${index + 1}`,
): WhiteboardElement {
    return {
        type: 'note',
        id,
        position: {
            x: 80 + (index % 20) * 110,
            y: 80 + Math.floor(index / 20) * 92,
        },
        rotation: (index % 7) - 3,
        zOrder: zOrder(index),
        createdBy: actor,
        createdAt: at,
        archived: false,
        size: {width: 96, height: 64},
        color: ['#fde68a', '#bfdbfe', '#fecdd3', '#bbf7d0'][index % 4],
        text,
    };
}

function strokeElement(index: number, actor: string, at: string, id = `stroke-${index + 1}`): WhiteboardElement {
    return {
        type: 'stroke',
        id,
        position: {x: 180 + index * 24, y: 220 + index * 18},
        rotation: 0,
        zOrder: zOrder(index),
        createdBy: actor,
        createdAt: at,
        archived: false,
        color: '#2563eb',
        strokeWidth: 5,
        points: [
            {x: 0, y: 0, pressure: 0.5},
            {x: 40, y: 18, pressure: 0.7},
            {x: 84, y: 10, pressure: 0.6},
        ],
    };
}

function emojiElement(index: number, actor: string, at: string, id = `emoji-${index + 1}`): WhiteboardElement {
    return {
        type: 'emoji',
        id,
        position: {x: 360 + index * 36, y: 180 + index * 24},
        rotation: 0,
        zOrder: zOrder(index),
        createdBy: actor,
        createdAt: at,
        archived: false,
        emoji: ['OK', 'WIP', '*', '!'][index % 4],
        size: 42,
    };
}

function zOrder(index: number) {
    return `z${String(index + 1).padStart(5, '0')}`;
}

function createClock(dateInput?: string): FixtureClock {
    const base = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(base.getTime())) throw new Error(`Invalid --date value: ${dateInput}`);
    const baseMs = base.getTime();
    let tick = 0;
    return {
        generatedAt: base.toISOString(),
        timestamp(actor: string) {
            tick += 1;
            return hlc.pack({ts: baseMs + tick * 1000, count: 0, node: actor});
        },
        iso() {
            tick += 1;
            return new Date(baseMs + tick * 1000).toISOString();
        },
    };
}

function parseArgs(argv: string[]) {
    let date: string | undefined;
    let size: SeedSize = 'default';
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--date':
                date = requiredValue(argv, ++index, '--date');
                break;
            case '--size': {
                const value = requiredValue(argv, ++index, '--size');
                if (value !== 'small' && value !== 'default' && value !== 'large') {
                    throw new Error('--size must be small, default, or large.');
                }
                size = value;
                break;
            }
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return {date, size};
}

function requiredValue(argv: string[], index: number, name: string) {
    const value = argv[index]?.trim();
    if (!value) throw new Error(`${name} requires a value.`);
    return value;
}

function itemCountFor(size: SeedSize) {
    if (size === 'small') return 100;
    if (size === 'large') return 2500;
    return 1000;
}

function eventCountFor(size: SeedSize) {
    if (size === 'small') return 200;
    if (size === 'large') return 5000;
    return 2000;
}

function whiteboardElementCountFor(size: SeedSize) {
    if (size === 'small') return 60;
    if (size === 'large') return 1000;
    return 400;
}

function isMainModule() {
    return process.argv[1] ? import.meta.url === new URL(`file://${process.argv[1]}`).href : false;
}
