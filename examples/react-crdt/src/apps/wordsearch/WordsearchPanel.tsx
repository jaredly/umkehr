import {useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {colorForUserId} from '../../lib/server/presence';
import type {GridPoint, WordsearchPuzzleArtifact} from './artifacts';
import {
    clearSelectionMessage,
    currentWordsearchPuzzle,
    foundRootPath,
    selectionMessage,
    wordsearchSelectionKind,
    type WordsearchEphemeralData,
    type WordsearchSelectionEvent,
} from './model';
import type {WordsearchState} from './schema';
import {
    cellsForSelection,
    findTimestamp,
    findWordPatches,
    firstFinder,
    foundWordIndexes,
    isWordFound,
    matchingWordIndex,
    type WordsearchSelection,
} from './wordsearch';

type Highlight = {
    id: string;
    cells: GridPoint[];
    color: string;
    kind: 'found' | 'active' | 'remote';
};

export function WordsearchPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<WordsearchState, 'type', WordsearchEphemeralData>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const puzzle = currentWordsearchPuzzle();
    const found = useValue(editor.$.found);
    const [selection, setSelection] = useState<WordsearchSelection | null>(null);
    const selectionRef = useRef<WordsearchSelection | null>(null);
    const boardRef = useRef<HTMLDivElement | null>(null);
    const draggingRef = useRef(false);
    const [message, setMessage] = useState('');
    const activeCells = useMemo(() => (selection ? cellsForSelection(selection) : []), [selection]);
    const remoteSelections = editor.useEphemeral({
        path: foundRootPath(),
        kinds: [wordsearchSelectionKind],
    });
    const foundIndexes = foundWordIndexes({found});
    const highlights = useMemo(
        () => [
            ...foundHighlights(puzzle, found),
            ...(activeCells.length
                ? [{id: 'active', cells: activeCells, color: colorForUserId(actor), kind: 'active' as const}]
                : []),
            ...remoteSelections
                .filter((record) => record.message.actor !== actor)
                .flatMap((record) => {
                    const data = record.message.data;
                    if (!isSelectionEvent(data)) return [];
                    return [
                        {
                            id: record.message.id,
                            cells: data.cells,
                            color: colorForUserId(record.message.actor),
                            kind: 'remote' as const,
                        },
                    ];
                }),
        ],
        [activeCells, actor, found, puzzle, remoteSelections],
    );

    useEffect(() => {
        if (!selection || readOnly || !activeCells.length) {
            editor.publishEphemeral([clearSelectionMessage(actor)]);
            return;
        }
        editor.publishEphemeral([
            selectionMessage({
                actor,
                start: selection.start,
                end: selection.end,
                cells: activeCells,
            }),
        ]);
        return () => {
            editor.publishEphemeral([clearSelectionMessage(actor)]);
        };
    }, [activeCells, actor, editor, readOnly, selection]);

    if (!puzzle) {
        return (
            <section className="wordsearchPanel">
                <header className="wordsearchHeader">
                    <h1>{title}</h1>
                </header>
                <div className="wordsearchMissing">Missing puzzle artifact</div>
            </section>
        );
    }

    const startSelection = (point: GridPoint) => {
        if (readOnly) return;
        setMessage('');
        draggingRef.current = true;
        setLocalSelection({start: point, end: point});
    };

    const updateSelection = (point: GridPoint) => {
        if (!draggingRef.current || readOnly) return;
        const current = selectionRef.current;
        if (!current || sameGridPoint(current.end, point)) return;
        setLocalSelection({...current, end: point});
    };

    const finishSelection = () => {
        const currentSelection = selectionRef.current;
        if (readOnly || !currentSelection) {
            clearLocalSelection();
            return;
        }
        const wordIndex = matchingWordIndex(puzzle, currentSelection);
        if (wordIndex === null || wordIndex < 0) {
            clearLocalSelection();
            return;
        }
        const latest = editor.latest();
        if (isWordFound(latest.found[String(wordIndex)])) {
            setMessage(`${puzzle.words[wordIndex].text} is already found.`);
            clearLocalSelection();
            return;
        }
        const patches = findWordPatches(latest, wordIndex, actor, findTimestamp(actor));
        if (patches.length) editor.dispatch(patches);
        clearLocalSelection();
    };

    const setLocalSelection = (next: WordsearchSelection | null) => {
        selectionRef.current = next;
        setSelection(next);
    };

    const clearLocalSelection = () => {
        draggingRef.current = false;
        setLocalSelection(null);
        editor.publishEphemeral([clearSelectionMessage(actor)]);
    };

    const startSelectionFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        const point = pointFromBoardEvent(event);
        if (!point) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startSelection(point);
    };

    const updateSelectionFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        const point = pointFromBoardEvent(event);
        if (!point) return;
        updateSelection(point);
    };

    const finishSelectionFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        releasePointerCapture(event);
        finishSelection();
    };

    const cancelSelectionFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        releasePointerCapture(event);
        clearLocalSelection();
    };

    return (
        <section
            className={`wordsearchPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
            data-testid="wordsearch-panel"
        >
            <header className="wordsearchHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {puzzle.title} · {foundIndexes.size}/{puzzle.words.length} found
                    </p>
                </div>
                <div className="wordsearchActions">
                    <button type="button" onClick={() => editor.undo()} disabled={readOnly || !editor.canUndo()}>
                        Undo
                    </button>
                    <button type="button" onClick={() => editor.redo()} disabled={readOnly || !editor.canRedo()}>
                        Redo
                    </button>
                </div>
            </header>

            <div
                ref={boardRef}
                className="wordsearchBoard"
                onPointerDown={startSelectionFromPointer}
                onPointerMove={updateSelectionFromPointer}
                onPointerUp={finishSelectionFromPointer}
                onPointerCancel={cancelSelectionFromPointer}
            >
                <div className="wordsearchHighlights" aria-hidden="true">
                    {highlights.map((highlight) => (
                        <WordHighlight key={highlight.id} highlight={highlight} />
                    ))}
                </div>
                {puzzle.board.map((row, y) =>
                    row.map((letter, x) => {
                        const key = cellKey({x, y});
                        return (
                            <button
                                key={key}
                                type="button"
                                className="wordsearchCell"
                                disabled={readOnly}
                            >
                                {letter}
                            </button>
                        );
                    }),
                )}
            </div>

            <div className="wordsearchBank" aria-label="Word bank">
                {puzzle.words.map((word, index) => {
                    const winner = firstFinder(found[String(index)]);
                    return (
                        <span
                            key={word.text}
                            className={`wordsearchWord ${winner ? 'found' : ''}`}
                            style={{
                                '--wordsearch-found': winner ? colorForUserId(winner[0]) : undefined,
                            } as CSSProperties}
                        >
                            {word.text}
                        </span>
                    );
                })}
            </div>
            {message ? <p className="wordsearchStatus">{message}</p> : null}
        </section>
    );

    function pointFromBoardEvent(event: PointerEvent<HTMLDivElement>): GridPoint | null {
        if (readOnly) return null;
        const board = boardRef.current ?? event.currentTarget;
        const rect = board.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: clampGridIndex(Math.floor(((event.clientX - rect.left) / rect.width) * 8)),
            y: clampGridIndex(Math.floor(((event.clientY - rect.top) / rect.height) * 8)),
        };
    }
}

function clampGridIndex(index: number) {
    return Math.max(0, Math.min(7, index));
}

function releasePointerCapture(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
}

function sameGridPoint(a: GridPoint, b: GridPoint) {
    return a.x === b.x && a.y === b.y;
}

function isSelectionEvent(data: WordsearchEphemeralData): data is WordsearchSelectionEvent {
    return data.type === 'selection';
}

function WordHighlight({highlight}: {highlight: Highlight}) {
    const first = highlight.cells[0];
    const last = highlight.cells.at(-1);
    if (!first || !last) return null;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.hypot(dx, dy) + 1;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const centerX = (first.x + last.x + 1) / 2;
    const centerY = (first.y + last.y + 1) / 2;
    return (
        <div
            className={`wordsearchHighlight ${highlight.kind}`}
            style={{
                '--wordsearch-highlight-color': highlight.color,
                '--wordsearch-highlight-x': centerX,
                '--wordsearch-highlight-y': centerY,
                '--wordsearch-highlight-length': length,
                '--wordsearch-highlight-angle': `${angle}deg`,
            } as CSSProperties}
        />
    );
}

function foundHighlights(puzzle: WordsearchPuzzleArtifact, found: WordsearchState['found']): Highlight[] {
    const highlights: Highlight[] = [];
    puzzle.words.forEach((word, index) => {
        const winner = firstFinder(found[String(index)]);
        if (!winner) return;
        const color = colorForUserId(winner[0]);
        highlights.push({
            id: `found:${index}`,
            cells: cellsForSelection({start: word.start, end: word.end}),
            color,
            kind: 'found',
        });
    });
    return highlights;
}

function cellKey(point: GridPoint) {
    return `${point.x}:${point.y}`;
}
