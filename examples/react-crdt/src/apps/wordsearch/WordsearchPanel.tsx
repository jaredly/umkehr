import {useEffect, useMemo, useState, type CSSProperties} from 'react';
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
    samePoint,
    type WordsearchSelection,
} from './wordsearch';

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
    const [dragging, setDragging] = useState(false);
    const [message, setMessage] = useState('');
    const activeCells = useMemo(() => (selection ? cellsForSelection(selection) : []), [selection]);
    const remoteSelections = editor.useEphemeral({
        path: foundRootPath(),
        kinds: [wordsearchSelectionKind],
    });
    const foundIndexes = foundWordIndexes({found});
    const foundCellColors = useMemo(() => foundCellColorMap(puzzle, found), [found, puzzle]);
    const activeCellKeys = new Set(activeCells.map(cellKey));

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
        setDragging(true);
        setSelection({start: point, end: point});
    };

    const updateSelection = (point: GridPoint) => {
        if (!dragging || readOnly) return;
        setSelection((current) => (current ? {...current, end: point} : current));
    };

    const finishSelection = () => {
        if (readOnly || !selection) {
            clearLocalSelection();
            return;
        }
        const wordIndex = matchingWordIndex(puzzle, selection);
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

    const clearLocalSelection = () => {
        setDragging(false);
        setSelection(null);
        editor.publishEphemeral([clearSelectionMessage(actor)]);
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
                className="wordsearchBoard"
                onPointerLeave={() => {
                    if (dragging) clearLocalSelection();
                }}
            >
                {puzzle.board.map((row, y) =>
                    row.map((letter, x) => {
                        const point = {x, y};
                        const key = cellKey(point);
                        const remote = remoteSelections.find(
                            (record) =>
                                record.message.actor !== actor &&
                                record.message.data.cells.some((cell) => samePoint(cell, point)),
                        );
                        const remoteColor = remote ? colorForUserId(remote.message.actor) : undefined;
                        return (
                            <button
                                key={key}
                                type="button"
                                className={`wordsearchCell ${
                                    activeCellKeys.has(key) ? 'active' : ''
                                } ${remote ? 'remoteActive' : ''} ${
                                    foundCellColors.has(key) ? 'found' : ''
                                }`}
                                style={{
                                    '--wordsearch-found': foundCellColors.get(key),
                                    '--wordsearch-remote': remoteColor,
                                } as CSSProperties}
                                disabled={readOnly}
                                onPointerDown={() => startSelection(point)}
                                onPointerEnter={() => updateSelection(point)}
                                onPointerUp={finishSelection}
                                onPointerCancel={clearLocalSelection}
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
}

function foundCellColorMap(
    puzzle: WordsearchPuzzleArtifact,
    found: WordsearchState['found'],
): Map<string, string> {
    const colors = new Map<string, string>();
    puzzle.words.forEach((word, index) => {
        const winner = firstFinder(found[String(index)]);
        if (!winner) return;
        const color = colorForUserId(winner[0]);
        for (const cell of cellsForSelection({start: word.start, end: word.end})) {
            colors.set(cellKey(cell), color);
        }
    });
    return colors;
}

function cellKey(point: GridPoint) {
    return `${point.x}:${point.y}`;
}
