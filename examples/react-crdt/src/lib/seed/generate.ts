/**
 * Deterministic seed database fixture generator for the React CRDT example.
 *
 * The generator builds a reusable in-memory fixture catalog, then projects it
 * to the server-shaped seed payload used by the Bun SQLite importer. Valid
 * fixture edits are applied through the real app schemas and CRDT command
 * pipeline before being serialized as server update or merge events, so the
 * generated documents exercise normal materialization and sync paths rather
 * than hand-written storage rows.
 *
 * Current fixtures cover small readable todo data, large todo item lists, long
 * multi-actor todo event logs, todo branch and merge topologies, todo array
 * deletion/reordering cases, large and dense whiteboards, whiteboard nested
 * element edits, tagged-union branch conflicts, old-schema migration seeds,
 * and separate malformed payloads for validation tests.
 *
 * `--date` anchors generated timestamps for stable output. `--size` scales the
 * item/event/element stress fixtures while preserving deterministic ids,
 * actors, branch names, and schema metadata.
 */
import {schemaFingerprint, schemaFingerprintHash} from 'umkehr/migration';
import type {DraftPatch, MaybeNested} from 'umkehr';
import {
    applyLocalCommand,
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtLocalHistory,
    type HlcTimestamp,
} from 'umkehr/crdt';
import type {IJsonSchemaCollection} from 'typia';
import {
    initialTodoTimestamp,
    initialTodoState,
    todoSchema,
    type Todo,
    type TodoState,
} from '../../apps/todos/schema';
import {
    initialWhiteboardTimestamp,
    initialWhiteboardState,
    whiteboardSchema,
    type WhiteboardElement,
    type WhiteboardState,
} from '../../apps/whiteboard/schema';
import {
    todoFixtureV1Fingerprint,
    todoFixtureV1FingerprintHash,
    todoFixtureV3Fingerprint,
    todoFixtureV3FingerprintHash,
    todoFixtureServerUpdateEventsV1,
    todoFixtureServerUpdateEventsV3,
    type TodoFixtureStateV1,
    type TodoFixtureStateV3,
} from '../../../../migration-fixtures/todos';
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
const TODO_APP_ID = 'todos';
const WHITEBOARD_APP_ID = 'whiteboard';
const TODO_MIGRATION_APP_ID = 'todos-migration-fixture';

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
    appId: string;
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
    histories: Record<string, CrdtLocalHistory<TState>>;
    state: TState;
};

export type SeedFixture<TState = unknown> = SeedDocument & {
    histories: Record<string, CrdtLocalHistory<TState>>;
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

export const seedUsers = users;
export const seedActors = actors;

const docClocks = new WeakMap<object, FixtureClock>();

if (isMainModule()) {
    const nodeProcess = nodeProcessGlobal();
    const payload = generateSeedDatabasePayload(parseArgs(nodeProcess.argv));
    nodeProcess.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function generateSeedDatabasePayload({
    date,
    size = 'default',
}: SeedGeneratorOptions = {}): SeedDatabasePayload {
    const catalog = generateSeedFixtureCatalog({date, size});
    return {
        generatedAt: catalog.generatedAt,
        users,
        documents: catalog.fixtures.map(fixtureToDocument),
    };
}

export function generateSeedFixtureCatalog({
    date,
    size = 'default',
}: SeedGeneratorOptions = {}): {
    generatedAt: string;
    users: ServerUser[];
    fixtures: SeedFixture[];
} {
    const clock = createClock(date);
    return {
        generatedAt: clock.generatedAt,
        users,
        fixtures: [
            todosSmall(clock),
            todosManyItems(clock, itemCountFor(size)),
            todosManyEvents(clock, eventCountFor(size)),
            todosBranches(clock),
            todosMergeReview(clock),
            todosConflictingFields(clock),
            todosArrayOperations(clock),
            todosDeletesAndReadds(clock),
            todosRecursiveMerges(clock),
            todosPartialRepeatMerge(clock),
            todosWideBranchList(clock),
            whiteboardManyElements(clock, whiteboardElementCountFor(size)),
            whiteboardBranches(clock),
            whiteboardElementEditing(clock),
            whiteboardDenseOverlap(clock, denseWhiteboardElementCountFor(size)),
            whiteboardConflictingElementEdits(clock),
            whiteboardManyEvents(clock, whiteboardEventCountFor(size)),
            todosMigrationV1Main(clock),
            todosMigrationV3Ahead(clock),
        ],
    };
}

export function listSeedDocumentSummaries({
    date,
    size = 'default',
    appId,
    branchFreeOnly = false,
}: SeedGeneratorOptions & {appId?: string; branchFreeOnly?: boolean} = {}) {
    return generateSeedFixtureCatalog({date, size}).fixtures
        .filter((fixture) => (appId ? fixture.appId === appId : true))
        .filter((fixture) => (branchFreeOnly ? isBranchFreeSeedFixture(fixture) : true))
        .map((fixture) => ({
            docId: fixture.docId,
            appId: fixture.appId,
            title: fixture.title,
            sizeLabel: fixture.sizeLabel,
            sizeRank: fixture.sizeRank,
            schemaVersion: fixture.schemaVersion,
            schemaFingerprint: fixture.schemaFingerprint,
            schemaFingerprintHash: fixture.schemaFingerprintHash,
            createdAt: fixture.createdAt,
            updatedAt: fixture.lastAccessedAt,
        }));
}

export function seedFixtureForDocId(
    docId: string,
    options: SeedGeneratorOptions & {appId?: string} = {},
) {
    const fixture = generateSeedFixtureCatalog(options).fixtures.find(
        (candidate) =>
            candidate.docId === docId && (options.appId ? candidate.appId === options.appId : true),
    );
    return fixture ?? null;
}

export function isBranchFreeSeedFixture(fixture: SeedFixture) {
    return fixture.branches.length === 1 && fixture.events.every((event) => event.kind === 'update');
}

export function assertBranchFreeSeedFixture(
    fixture: SeedFixture,
): asserts fixture is SeedFixture & {histories: {main: CrdtLocalHistory<unknown>}} {
    if (fixture.branches.length !== 1 || fixture.branches[0]?.branchId !== 'main') {
        throw new Error(`Seed fixture "${fixture.docId}" contains multiple branches.`);
    }
    if (fixture.events.some((event) => event.kind === 'merge')) {
        throw new Error(`Seed fixture "${fixture.docId}" contains merge events.`);
    }
    if (!fixture.histories.main) {
        throw new Error(`Seed fixture "${fixture.docId}" does not include a main history.`);
    }
}

export function mainBranchHistory<TState>(fixture: SeedFixture<TState>) {
    const history = fixture.histories.main;
    if (!history) throw new Error(`Seed fixture "${fixture.docId}" does not include a main history.`);
    return history;
}

export function mainBranchEvents(fixture: SeedFixture) {
    return fixture.events.filter((event) => event.branchId === 'main');
}

export function mainBranchState<TState>(fixture: SeedFixture<TState>) {
    return mainBranchHistory(fixture).doc.state;
}

export function generateMalformedSeedPayloads(
    options: SeedGeneratorOptions = {},
): Record<string, SeedDatabasePayload> {
    const base = generateSeedDatabasePayload({...options, size: options.size ?? 'small'});
    return {
        missingSourceBranch: mutateFirstDocument(base, (document) => {
            document.branches.push({
                ...document.branches[0],
                branchId: 'missing-source',
                name: 'Missing source',
                sourceBranchId: 'does-not-exist',
                forkEventIndex: 1,
                tipEventIndex: 0,
            });
        }),
        duplicateEventIndex: mutateFirstDocument(base, (document) => {
            const first = document.events.find((event) => event.kind === 'update');
            if (first) {
                document.events.push({
                    ...structuredClone(first),
                    hlcTimestamp: `${first.hlcTimestamp}-duplicate`,
                } as ServerBranchEvent);
            }
        }),
        mergePastSourceTip: mutateFirstDocument(base, (document) => {
            const branch = document.branches.find((candidate) => candidate.branchId !== 'main');
            if (!branch) return;
            const main = document.branches.find((candidate) => candidate.branchId === 'main');
            if (!main) return;
            main.tipEventIndex += 1;
            document.events.push({
                kind: 'merge',
                mergeId: 'malformed-merge-past-tip',
                docId: document.docId,
                branchId: 'main',
                eventIndex: main.tipEventIndex,
                sourceBranchId: branch.branchId,
                sourceThroughEventIndex: branch.tipEventIndex + 100,
                actor: actors.ada,
                createdAt: document.lastAccessedAt,
            });
        }),
        mismatchedSchemaHash: mutateFirstDocument(base, (document) => {
            document.schemaFingerprintHash = 'not-the-real-schema-hash';
        }),
        unknownActor: mutateFirstDocument(base, (document) => {
            const first = document.events.find((event) => event.kind === 'update');
            if (first?.kind === 'update') first.origin = 'missing-user:missing-session';
        }),
    };
}

function todosSmall(clock: FixtureClock): SeedFixture<TodoState> {
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
    updateTodoDone(doc, actors.ben, 'review', true);
    return finishDocument(doc);
}

function todosManyItems(clock: FixtureClock, count: number): SeedFixture<TodoState> {
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

function todosManyEvents(clock: FixtureClock, count: number): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-many-events',
        title: `Todos: ${count} updates`,
        sizeLabel: `${count} events`,
        sizeRank: 30,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#f8fafc',
        todos: Array.from({length: 12}, (_, index) => ({
            id: `slot-${index + 1}`,
            title: `Event target ${index + 1}`,
            done: false,
        })),
    });
    const actorList = [actors.ada, actors.ben, actors.cy, actors.dee];
    for (let index = 1; index < count; index++) {
        const state = branchState(doc);
        const target = index % state.todos.length;
        const targetTodo = state.todos[target];
        const actor = actorList[index % actorList.length];
        if (index % 7 === 0) {
            updateTodoBgcolor(doc, actor, index % 2 === 0 ? '#f8fafc' : '#ecfeff');
        } else if (index % 2 === 0) {
            updateTodoDone(doc, actor, targetTodo.id, !targetTodo.done);
        } else {
            updateTodoTitle(
                doc,
                actor,
                targetTodo.id,
                `Event ${index + 1} touched ${targetTodo.id}`,
            );
        }
    }
    return finishDocument(doc);
}

function todosBranches(clock: FixtureClock): SeedFixture<TodoState> {
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
    addTodo(doc, actors.ben, todo('copy', 'Write alternate copy'), 'feature-copy');
    updateTodoBgcolor(doc, actors.cy, '#fef2f2', 'feature-cleanup');
    updateTodoDone(doc, actors.dee, 'a', true);
    return finishDocument(doc);
}

function todosMergeReview(clock: FixtureClock): SeedFixture<TodoState> {
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
    updateTodoBgcolor(doc, actors.ben, '#f5f3ff', 'design');
    addTodo(doc, actors.cy, todo('test', 'Test migration path'), 'qa');
    addTodo(doc, actors.cy, todo('signoff', 'QA signoff'), 'qa');
    updateTodoDone(doc, actors.ada, 'plan', true);
    mergeBranch(doc, actors.dee, 'main', 'design', 1, 'merge-design');
    mergeBranch(doc, actors.dee, 'main', 'qa', 2, 'merge-qa');
    return finishDocument(doc);
}

function todosConflictingFields(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-conflicting-fields',
        title: 'Todos: conflicting fields',
        sizeLabel: '3 branches, same-path edits',
        sizeRank: 60,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#fff',
        todos: [
            todo('copy', 'Draft release copy'),
            todo('review', 'Review conflicts'),
            todo('ship', 'Ship conflict fixture'),
        ],
    });
    createBranchFromTip(doc, 'copy-a', 'Copy A', 'main');
    createBranchFromTip(doc, 'copy-b', 'Copy B', 'main');
    updateTodoTitle(doc, actors.ben, 'copy', 'Draft release copy - Ben', 'copy-a');
    updateTodoDone(doc, actors.ben, 'copy', true, 'copy-a');
    updateTodoTitle(doc, actors.cy, 'copy', 'Draft release copy - Cy', 'copy-b');
    updateTodoBgcolor(doc, actors.cy, '#ecfeff', 'copy-b');
    updateTodoTitle(doc, actors.ada, 'copy', 'Draft release copy - main');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'copy-a', 'merge-copy-a');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'copy-b', 'merge-copy-b');
    return finishDocument(doc);
}

function todosArrayOperations(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-array-operations',
        title: 'Todos: array operations',
        sizeLabel: 'insert, move, reorder',
        sizeRank: 70,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#f8fafc',
        todos: [
            todo('a', 'Alpha'),
            todo('b', 'Bravo'),
            todo('c', 'Charlie'),
            todo('d', 'Delta'),
        ],
    });
    insertTodoAt(doc, actors.ben, 0, todo('front', 'Inserted at front'));
    insertTodoAt(doc, actors.cy, 3, todo('middle', 'Inserted in middle'));
    addTodo(doc, actors.dee, todo('end', 'Inserted at end'));
    insertTodoAt(doc, actors.ada, 2, todo('near-a', 'Adjacent insert A'));
    insertTodoAt(doc, actors.ben, 3, todo('near-b', 'Adjacent insert B'));
    moveTodo(doc, actors.cy, 1, branchState(doc).todos.length - 1);
    reorderTodos(doc, actors.dee, [2, 0, 1, 3, 4, 5, 6, 7, 8]);
    updateTodoTitle(doc, actors.ada, 'middle', 'Edited after index shifts');
    return finishDocument(doc);
}

function todosDeletesAndReadds(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-deletes-and-readds',
        title: 'Todos: deletes and re-adds',
        sizeLabel: 'remove, branch edit, id reuse',
        sizeRank: 80,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#fff7ed',
        todos: [
            todo('keep', 'Keep this todo'),
            todo('reuse', 'Original reusable id'),
            todo('neighbor', 'Neighbor after delete'),
            todo('branch-only', 'Branch edit target'),
        ],
    });
    createBranchFromTip(doc, 'stale-edit', 'Stale edit', 'main');
    updateTodoTitle(doc, actors.ben, 'reuse', 'Branch edited deleted todo', 'stale-edit');
    removeTodoById(doc, actors.ada, 'reuse');
    updateTodoTitle(doc, actors.cy, 'neighbor', 'Neighbor edited after delete');
    addTodo(doc, actors.dee, todo('reuse', 'Re-added reusable id'));
    updateTodoDone(doc, actors.ada, 'reuse', true);
    mergeBranchThroughTip(doc, actors.dee, 'main', 'stale-edit', 'merge-stale-edit');
    return finishDocument(doc);
}

function todosRecursiveMerges(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-recursive-merges',
        title: 'Todos: recursive merges',
        sizeLabel: 'recursive merge topology',
        sizeRank: 90,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#f0fdf4',
        todos: [todo('base', 'Base task'), todo('dependency', 'Dependency task')],
    });
    createBranchFromTip(doc, 'dependency', 'Dependency', 'main');
    createBranchFromTip(doc, 'feature', 'Feature', 'main');
    createBranchFromTip(doc, 'direct', 'Direct dependency', 'main');
    updateTodoTitle(doc, actors.ben, 'dependency', 'Dependency branch edit', 'dependency');
    mergeBranchThroughTip(doc, actors.cy, 'feature', 'dependency', 'merge-feature-dependency');
    addTodo(doc, actors.cy, todo('feature-task', 'Feature task'), 'feature');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'feature', 'merge-main-feature');
    mergeBranchThroughTip(doc, actors.dee, 'direct', 'dependency', 'merge-direct-dependency');
    mergeBranchThroughTip(doc, actors.ada, 'main', 'direct', 'merge-main-direct');
    return finishDocument(doc);
}

function todosPartialRepeatMerge(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-partial-repeat-merge',
        title: 'Todos: partial repeat merge',
        sizeLabel: 'partial and repeated merges',
        sizeRank: 100,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#f8fafc',
        todos: [todo('one', 'One'), todo('two', 'Two'), todo('three', 'Three')],
    });
    createBranchFromTip(doc, 'source', 'Source', 'main');
    updateTodoTitle(doc, actors.ben, 'one', 'Source edit one', 'source');
    updateTodoDone(doc, actors.ben, 'two', true, 'source');
    mergeBranch(doc, actors.ada, 'main', 'source', 1, 'merge-source-partial');
    updateTodoTitle(doc, actors.cy, 'three', 'Source edit three', 'source');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'source', 'merge-source-rest');
    mergeBranch(doc, actors.dee, 'main', 'source', 1, 'merge-source-repeat');
    return finishDocument(doc);
}

function todosWideBranchList(clock: FixtureClock): SeedFixture<TodoState> {
    const doc = createTodoDoc({
        docId: 'todos-wide-branch-list',
        title: 'Todos: wide branch list',
        sizeLabel: '26 branches',
        sizeRank: 110,
        clock,
    });
    setTodos(doc, actors.ada, {
        bgcolor: '#eef6ff',
        todos: [todo('base', 'Wide branch base')],
    });
    for (let index = 1; index <= 25; index++) {
        const branchId = `branch-${String(index).padStart(2, '0')}`;
        createBranchFromTip(doc, branchId, `Branch ${index}`, 'main');
        addTodo(
            doc,
            [actors.ada, actors.ben, actors.cy, actors.dee][index % 4],
            todo(`branch-${index}`, `Branch ${index} task`),
            branchId,
        );
        if (index <= 5) {
            mergeBranchThroughTip(doc, actors.dee, 'main', branchId, `merge-${branchId}`);
        }
    }
    return finishDocument(doc);
}

function whiteboardManyElements(clock: FixtureClock, count: number): SeedFixture<WhiteboardState> {
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

function whiteboardBranches(clock: FixtureClock): SeedFixture<WhiteboardState> {
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
    addWhiteboardElement(
        doc,
        actors.ben,
        noteElement(2, actors.ben, clock.generatedAt, 'layout', 'Layout pass'),
        'layout',
    );
    addWhiteboardElement(
        doc,
        actors.cy,
        emojiElement(3, actors.cy, clock.generatedAt, 'annotation'),
        'annotations',
    );
    updateWhiteboardBackground(doc, actors.ada, '#f0fdf4');
    mergeBranch(doc, actors.dee, 'main', 'layout', 1, 'merge-layout');
    mergeBranch(doc, actors.dee, 'main', 'annotations', 1, 'merge-annotations');
    return finishDocument(doc);
}

function whiteboardElementEditing(clock: FixtureClock): SeedFixture<WhiteboardState> {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-element-editing',
        title: 'Whiteboard: element editing',
        sizeLabel: 'nested edits and archival',
        sizeRank: 130,
        clock,
    });
    setWhiteboard(doc, actors.ada, {
        background: '#f8fafc',
        elements: {
            note: noteElement(0, actors.ada, clock.generatedAt, 'note', 'Initial note'),
            stroke: strokeElement(1, actors.ben, clock.generatedAt, 'stroke'),
            emoji: emojiElement(2, actors.cy, clock.generatedAt, 'emoji'),
        },
    });
    replaceWhiteboardElementField(doc, actors.ben, 'note', 'position', {x: 140, y: 120});
    replaceWhiteboardElementField(doc, actors.ben, 'note', 'size', {width: 168, height: 96});
    replaceWhiteboardElementField(doc, actors.cy, 'note', 'text', 'Edited nested note text');
    replaceWhiteboardElementField(doc, actors.cy, 'note', 'color', '#bfdbfe');
    replaceWhiteboardElementField(doc, actors.dee, 'stroke', 'points', [
        {x: 0, y: 0, pressure: 0.3},
        {x: 48, y: 24, pressure: 0.7},
        {x: 96, y: 12, pressure: 0.5},
        {x: 144, y: 36, pressure: 0.8},
    ]);
    replaceWhiteboardElementField(doc, actors.dee, 'stroke', 'strokeWidth', 8);
    replaceWhiteboardElementField(doc, actors.ada, 'emoji', 'position', {x: 420, y: 260});
    replaceWhiteboardElementField(doc, actors.ada, 'emoji', 'size', 64);
    archiveWhiteboardElement(doc, actors.ben, 'note');
    recoverWhiteboardElement(doc, actors.cy, 'note');
    return finishDocument(doc);
}

function whiteboardDenseOverlap(
    clock: FixtureClock,
    count: number,
): SeedFixture<WhiteboardState> {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-dense-overlap',
        title: `Whiteboard: ${count} dense elements`,
        sizeLabel: `${count} overlapping elements`,
        sizeRank: 140,
        clock,
    });
    const elements: Record<string, WhiteboardElement> = {};
    for (let index = 0; index < count; index++) {
        const actor = [actors.ada, actors.ben, actors.cy, actors.dee][index % 4];
        const element =
            index % 3 === 0
                ? noteElement(index, actor, clock.generatedAt)
                : index % 3 === 1
                  ? strokeElement(index, actor, clock.generatedAt)
                  : emojiElement(index, actor, clock.generatedAt);
        element.position = {
            x: -120 + (index % 18) * 24,
            y: -80 + Math.floor(index / 18) * 18,
        };
        element.rotation = (index % 17) * 7 - 56;
        element.zOrder = zOrder(index % 50);
        if (index % 11 === 0) {
            element.archived = true;
            element.archivedBy = actor;
            element.archivedAt = clock.generatedAt;
        }
        elements[element.id] = element;
    }
    setWhiteboard(doc, actors.ada, {background: '#f8fafc', elements});
    return finishDocument(doc);
}

function whiteboardConflictingElementEdits(clock: FixtureClock): SeedFixture<WhiteboardState> {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-conflicting-element-edits',
        title: 'Whiteboard: conflicting element edits',
        sizeLabel: 'same element branch conflict',
        sizeRank: 150,
        clock,
    });
    setWhiteboard(doc, actors.ada, {
        background: '#fff',
        elements: {
            shared: noteElement(0, actors.ada, clock.generatedAt, 'shared', 'Shared note'),
        },
    });
    createBranchFromTip(doc, 'move', 'Move', 'main');
    createBranchFromTip(doc, 'copy', 'Copy', 'main');
    createBranchFromTip(doc, 'archive', 'Archive', 'main');
    replaceWhiteboardElementField(doc, actors.ben, 'shared', 'position', {x: 300, y: 180}, 'move');
    replaceWhiteboardElementField(doc, actors.ben, 'shared', 'text', 'Moved branch text', 'move');
    replaceWhiteboardElementField(doc, actors.cy, 'shared', 'position', {x: 80, y: 360}, 'copy');
    replaceWhiteboardElementField(doc, actors.cy, 'shared', 'text', 'Copy branch text', 'copy');
    archiveWhiteboardElement(doc, actors.dee, 'shared', 'archive');
    replaceWhiteboardElementField(doc, actors.ada, 'shared', 'text', 'Main branch text');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'move', 'merge-move');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'copy', 'merge-copy');
    mergeBranchThroughTip(doc, actors.dee, 'main', 'archive', 'merge-archive');
    return finishDocument(doc);
}

function whiteboardManyEvents(
    clock: FixtureClock,
    count: number,
): SeedFixture<WhiteboardState> {
    const doc = createWhiteboardDoc({
        docId: 'whiteboard-many-events',
        title: `Whiteboard: ${count} updates`,
        sizeLabel: `${count} events`,
        sizeRank: 160,
        clock,
    });
    setWhiteboard(doc, actors.ada, {
        background: '#f8fafc',
        elements: Object.fromEntries(
            Array.from({length: 18}, (_, index) => {
                const actor = [actors.ada, actors.ben, actors.cy, actors.dee][index % 4];
                const element =
                    index % 3 === 0
                        ? noteElement(index, actor, clock.generatedAt)
                        : index % 3 === 1
                          ? strokeElement(index, actor, clock.generatedAt)
                          : emojiElement(index, actor, clock.generatedAt);
                return [element.id, element];
            }),
        ),
    });
    const actorList = [actors.ada, actors.ben, actors.cy, actors.dee];
    for (let index = 1; index < count; index++) {
        const ids = Object.keys(branchState(doc).elements).sort();
        const id = ids[index % ids.length];
        const element = branchState(doc).elements[id];
        const actor = actorList[index % actorList.length];
        if (index % 17 === 0) {
            replaceWhiteboardElementField(doc, actor, id, 'archived', true);
        } else if (index % 17 === 1 && element.archived) {
            replaceWhiteboardElementField(doc, actor, id, 'archived', false);
        } else if (element.type === 'note' && index % 3 === 0) {
            replaceWhiteboardElementField(doc, actor, id, 'text', `Edited note ${index}`);
        } else if (element.type === 'stroke' && index % 3 === 1) {
            replaceWhiteboardElementField(doc, actor, id, 'strokeWidth', 2 + (index % 9));
        } else if (element.type === 'emoji') {
            replaceWhiteboardElementField(doc, actor, id, 'size', 32 + (index % 48));
        } else {
            replaceWhiteboardElementField(doc, actor, id, 'position', {
                x: element.position.x + (index % 5) * 3,
                y: element.position.y + (index % 7) * 2,
            });
        }
    }
    return finishDocument(doc);
}

function todosMigrationV1Main(clock: FixtureClock): SeedFixture<TodoFixtureStateV1> {
    const docId = 'todos-migration-v1-main';
    const createdAt = clock.iso();
    const events = todoFixtureServerUpdateEventsV1().map((event) => ({
        ...event,
        docId,
        receivedAt: createdAt,
    }));
    return {
        appId: TODO_MIGRATION_APP_ID,
        docId,
        title: 'Migration: todos fixture v1',
        sizeLabel: 'old schema v1',
        sizeRank: 170,
        createdAt,
        lastAccessedAt: createdAt,
        schemaVersion: 1,
        schemaFingerprint: todoFixtureV1Fingerprint,
        schemaFingerprintHash: todoFixtureV1FingerprintHash,
        branches: [{
            docId,
            branchId: 'main',
            name: 'main',
            tipEventIndex: events.length,
            createdAt,
            updatedAt: createdAt,
        }],
        events,
        histories: {},
    };
}

function todosMigrationV3Ahead(clock: FixtureClock): SeedFixture<TodoFixtureStateV3> {
    const docId = 'todos-migration-v3-ahead';
    const createdAt = clock.iso();
    const events = todoFixtureServerUpdateEventsV3({docId, receivedAt: createdAt});
    return {
        appId: TODO_MIGRATION_APP_ID,
        docId,
        title: 'Migration: todos fixture v3 ahead',
        sizeLabel: 'future schema v3',
        sizeRank: 171,
        createdAt,
        lastAccessedAt: createdAt,
        schemaVersion: 3,
        schemaFingerprint: todoFixtureV3Fingerprint,
        schemaFingerprintHash: todoFixtureV3FingerprintHash,
        branches: [{
            docId,
            branchId: 'main',
            name: 'main',
            tipEventIndex: events.length,
            createdAt,
            updatedAt: createdAt,
        }],
        events,
        histories: {},
    };
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
        appId: TODO_APP_ID,
        title,
        sizeLabel,
        sizeRank,
        schemaVersion: TODO_SCHEMA_VERSION,
        schemaFingerprint: schemaFingerprint(todoSchema, 'type'),
        schemaFingerprintHash: schemaFingerprintHash(todoSchema, 'type'),
        schema: todoSchema,
        initialState: initialTodoState,
        initialTimestamp: initialTodoTimestamp,
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
        appId: WHITEBOARD_APP_ID,
        title,
        sizeLabel,
        sizeRank,
        schemaVersion: WHITEBOARD_SCHEMA_VERSION,
        schemaFingerprint: schemaFingerprint(whiteboardSchema, 'type'),
        schemaFingerprintHash: schemaFingerprintHash(whiteboardSchema, 'type'),
        schema: whiteboardSchema,
        initialState: initialWhiteboardState,
        initialTimestamp: initialWhiteboardTimestamp,
        clock,
    });
}

function createDoc<TState>({
    docId,
    appId,
    title,
    sizeLabel,
    sizeRank,
    schemaVersion,
    schemaFingerprint,
    schemaFingerprintHash,
    schema,
    initialState,
    initialTimestamp,
    clock,
}: {
    docId: string;
    appId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    initialState: TState;
    initialTimestamp: HlcTimestamp;
    clock: FixtureClock;
}): BranchBuilder<TState> {
    const now = clock.iso();
    const initialHistory = createCrdtLocalHistory(
        createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
    );
    return {
        docId,
        appId,
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
        histories: {main: initialHistory},
        state: structuredClone(initialState),
    };
}

function setTodos(
    doc: BranchBuilder<TodoState>,
    actor: string,
    state: TodoState,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [],
        value: state,
    });
}

function setWhiteboard(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    state: WhiteboardState,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [],
        value: state,
    });
}

function updateTodoTitle(
    doc: BranchBuilder<TodoState>,
    actor: string,
    todoId: string,
    title: string,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: todoFieldPath(doc, branchId, todoId, 'title'),
        value: title,
    });
}

function updateTodoDone(
    doc: BranchBuilder<TodoState>,
    actor: string,
    todoId: string,
    done: boolean,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: todoFieldPath(doc, branchId, todoId, 'done'),
        value: done,
    });
}

function updateTodoBgcolor(
    doc: BranchBuilder<TodoState>,
    actor: string,
    bgcolor: string,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [{type: 'key', key: 'bgcolor'}],
        value: bgcolor,
    });
}

function insertTodoAt(
    doc: BranchBuilder<TodoState>,
    actor: string,
    index: number,
    todo: Todo,
    branchId = 'main',
) {
    addTodo(doc, actor, todo, branchId);
    const lastIndex = branchState(doc, branchId).todos.length - 1;
    if (index < lastIndex) moveTodo(doc, actor, lastIndex, index, branchId);
}

function addTodo(
    doc: BranchBuilder<TodoState>,
    actor: string,
    todo: Todo,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'push',
        path: [{type: 'key', key: 'todos'}],
        value: todo,
    });
}

function removeTodoById(
    doc: BranchBuilder<TodoState>,
    actor: string,
    todoId: string,
    branchId = 'main',
) {
    const index = branchState(doc, branchId).todos.findIndex((todoItem) => todoItem.id === todoId);
    if (index < 0) throw new Error(`Missing todo ${todoId} in ${doc.docId}/${branchId}.`);
    appendCommand(doc, branchId, actor, {
        op: 'remove',
        path: [{type: 'key', key: 'todos'}, {type: 'key', key: index}],
    });
}

function moveTodo(
    doc: BranchBuilder<TodoState>,
    actor: string,
    fromIdx: number,
    targetIdx: number,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'move',
        path: [{type: 'key', key: 'todos'}],
        fromIdx,
        targetIdx,
        after: false,
    });
}

function reorderTodos(
    doc: BranchBuilder<TodoState>,
    actor: string,
    indices: number[],
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'reorder',
        path: [{type: 'key', key: 'todos'}],
        indices,
    });
}

function addWhiteboardElement(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    element: WhiteboardElement,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [{type: 'key', key: 'elements'}, {type: 'key', key: element.id}],
        value: element,
    });
}

function replaceWhiteboardElementField(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    elementId: string,
    field: string,
    value: unknown,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}, {type: 'key', key: field}],
        value,
    });
}

function removeWhiteboardElementField(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    elementId: string,
    field: string,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'remove',
        path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}, {type: 'key', key: field}],
    });
}

function archiveWhiteboardElement(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    elementId: string,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, [
        {
            op: 'replace',
            path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}, {type: 'key', key: 'archived'}],
            value: true,
        },
        {
            op: 'replace',
            path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}, {type: 'key', key: 'archivedBy'}],
            value: actor,
        },
        {
            op: 'replace',
            path: [{type: 'key', key: 'elements'}, {type: 'key', key: elementId}, {type: 'key', key: 'archivedAt'}],
            value: nextIso(doc, actor),
        },
    ]);
}

function recoverWhiteboardElement(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    elementId: string,
    branchId = 'main',
) {
    replaceWhiteboardElementField(doc, actor, elementId, 'archived', false, branchId);
    removeWhiteboardElementField(doc, actor, elementId, 'archivedBy', branchId);
    removeWhiteboardElementField(doc, actor, elementId, 'archivedAt', branchId);
}

function updateWhiteboardBackground(
    doc: BranchBuilder<WhiteboardState>,
    actor: string,
    background: string,
    branchId = 'main',
) {
    appendCommand(doc, branchId, actor, {
        op: 'replace',
        path: [{type: 'key', key: 'background'}],
        value: background,
    });
}

function appendCommand<TState>(
    doc: BranchBuilder<TState>,
    branchId: string,
    actor: string,
    draft: MaybeNested<DraftPatch<TState, 'type', undefined>>,
) {
    const branch = branchFor(doc, branchId);
    const history = doc.histories[branchId];
    if (!history) throw new Error(`Missing history for branch ${branchId} in ${doc.docId}.`);

    const baseTimestamp = nextTimestamp(doc, actor);
    const baseClock = hlc.unpack(baseTimestamp);
    const now = baseClock.ts;
    const originalDateNow = Date.now;
    let result;
    Date.now = () => now;
    try {
        result = applyLocalCommand(history, draft, baseClock);
    } finally {
        Date.now = originalDateNow;
    }

    doc.histories[branchId] = result.history;
    for (const update of result.updates) {
        const ts = latestCrdtUpdateTimestamp(update);
        if (!ts) continue;
        const receivedAt = new Date(hlc.unpack(ts).ts).toISOString();
        const event: ServerUpdateEvent = {
            kind: 'update',
            docId: doc.docId,
            branchId,
            eventIndex: branch.tipEventIndex + 1,
            origin: actor,
            hlcTimestamp: ts,
            receivedAt,
            update,
        };
        doc.events.push(event);
        branch.tipEventIndex = event.eventIndex;
        branch.updatedAt = receivedAt;
        doc.lastAccessedAt = receivedAt;
    }
    if (branchId === 'main') doc.state = structuredClone(result.history.doc.state);
}

function createBranch<TState>(
    doc: BranchBuilder<TState>,
    branchId: string,
    name: string,
    sourceBranchId: string,
    forkEventIndex: number,
) {
    const now = doc.lastAccessedAt;
    const sourceHistory = doc.histories[sourceBranchId];
    if (!sourceHistory) throw new Error(`Cannot fork from unknown branch ${sourceBranchId}.`);
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
    doc.histories[branchId] = sourceHistory;
}

function createBranchFromTip<TState>(
    doc: BranchBuilder<TState>,
    branchId: string,
    name: string,
    sourceBranchId: string,
) {
    createBranch(doc, branchId, name, sourceBranchId, branchTip(doc, sourceBranchId));
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

function mergeBranchThroughTip<TState>(
    doc: BranchBuilder<TState>,
    actor: string,
    targetBranchId: string,
    sourceBranchId: string,
    mergeId: string,
) {
    mergeBranch(doc, actor, targetBranchId, sourceBranchId, branchTip(doc, sourceBranchId), mergeId);
}

function finishDocument<TState>(doc: BranchBuilder<TState>): SeedFixture<TState> {
    return {
        appId: doc.appId,
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
        histories: doc.histories,
    };
}

function fixtureToDocument(fixture: SeedFixture): SeedDocument {
    return {
        appId: fixture.appId,
        docId: fixture.docId,
        title: fixture.title,
        sizeLabel: fixture.sizeLabel,
        sizeRank: fixture.sizeRank,
        createdAt: fixture.createdAt,
        lastAccessedAt: fixture.lastAccessedAt,
        schemaVersion: fixture.schemaVersion,
        schemaFingerprint: fixture.schemaFingerprint,
        schemaFingerprintHash: fixture.schemaFingerprintHash,
        branches: fixture.branches,
        events: fixture.events,
    };
}

function branchFor<TState>(doc: BranchBuilder<TState>, branchId: string) {
    const branch = doc.branches.find((candidate) => candidate.branchId === branchId);
    if (!branch) throw new Error(`Unknown branch ${branchId} in ${doc.docId}.`);
    return branch;
}

function branchTip<TState>(doc: BranchBuilder<TState>, branchId: string) {
    return branchFor(doc, branchId).tipEventIndex;
}

function branchState<TState>(doc: BranchBuilder<TState>, branchId = 'main') {
    const history = doc.histories[branchId];
    if (!history) throw new Error(`Missing history for branch ${branchId} in ${doc.docId}.`);
    return history.doc.state;
}

function todoFieldPath(
    doc: BranchBuilder<TodoState>,
    branchId: string,
    todoId: string,
    field: keyof Pick<Todo, 'title' | 'done'>,
) {
    const index = branchState(doc, branchId).todos.findIndex((todoItem) => todoItem.id === todoId);
    if (index < 0) throw new Error(`Missing todo ${todoId} in ${doc.docId}/${branchId}.`);
    return [
        {type: 'key' as const, key: 'todos'},
        {type: 'key' as const, key: index},
        {type: 'key' as const, key: field},
    ];
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

function denseWhiteboardElementCountFor(size: SeedSize) {
    if (size === 'small') return 45;
    if (size === 'large') return 600;
    return 180;
}

function whiteboardEventCountFor(size: SeedSize) {
    if (size === 'small') return 150;
    if (size === 'large') return 3000;
    return 1200;
}

function mutateFirstDocument(
    payload: SeedDatabasePayload,
    mutate: (document: SeedDocument) => void,
): SeedDatabasePayload {
    const next = structuredClone(payload);
    const document = next.documents[0];
    if (!document) throw new Error('Expected at least one seed document.');
    mutate(document);
    return next;
}

function isMainModule() {
    const nodeProcess = nodeProcessGlobal();
    return nodeProcess.argv[1]
        ? import.meta.url === new URL(`file://${nodeProcess.argv[1]}`).href
        : false;
}

function nodeProcessGlobal(): {
    argv: string[];
    stdout: {write(value: string): void};
} {
    const maybeProcess = (globalThis as {
        process?: {
            argv?: string[];
            stdout?: {write(value: string): void};
        };
    }).process;
    return {
        argv: maybeProcess?.argv ?? [],
        stdout: maybeProcess?.stdout ?? {write() {}},
    };
}
