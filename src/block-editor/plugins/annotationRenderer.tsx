import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
} from 'react';

import {materializeFormattedBlocks, orderedCharIdsForBlock} from '../../block-crdt/index.js';
import type {CachedState} from '../../block-crdt/types.js';
import type {FormattedBlock} from '../../block-crdt/index.js';
import {
    annotationVirtualParents,
    clearAnnotationBodyCodeLanguage,
    deleteAnnotationBodyBackward,
    deleteAnnotationBodyForward,
    pasteAnnotationBodyTextWithMarkdownShortcuts,
    replaceAnnotationBodySelection,
    removeAnnotationBodyCodeMark,
    removeAnnotationBodyLink,
    setAnnotationBodyCodeMark,
    setAnnotationBodyLink,
    splitAnnotationBodyBlock,
    toggleAnnotationBodyCodeMark,
    toggleAnnotationBodyMark,
    type RenderedAnnotation,
} from '../annotations.js';
import {
    closeRetainedInlineMarkSessions,
    insertTextWithMarkdownShortcuts,
    insertTextWithRetainedMarks,
    type CommandContext,
    type CommandResult,
    type RetainedInlineMarkSession,
} from '../blockCommands.js';
import type {RichBlockMeta} from '../blockMeta.js';
import {
    BLOCK_RICH_TEXT_MIME,
    htmlWithClipboardPayload,
    parseBlockRichTextClipboardHtml,
    parseBlockRichTextClipboardPayload,
    serializeSelectionToClipboardPayload,
    type RichClipboardPayload,
} from '../clipboard.js';
import {readSelectionFromDom} from '../domSelection.js';
import {
    CodeFloatingPopover,
    CodeHoverPopover,
    LinkFloatingPopover,
    LinkHoverPopover,
} from '../floatingPopovers.js';
import {
    CODE_MARK,
    codeRangeAroundOffsetInRuns,
    isLinkLikeText,
    linkHrefForSelectionSegments,
    linkRangeAroundOffsetInRuns,
    textForSelectionSegments,
    type CodeTargetRange,
    type LinkTargetRange,
} from '../inlineMarks.js';
import {
    caret,
    focusPoint,
    type EditorSelection,
} from '../selectionModel.js';
import {
    primarySelection,
    resolveSelectionSet,
    singleRetainedSelectionSet,
} from '../selectionSet.js';
import type {
    CodeHoverPopoverState,
    CodePopoverState,
    LinkHoverPopoverState,
    LinkPopoverState,
} from '../blockEditorTypes.js';
import {pasteRichClipboardEverywhere} from '../multiSelectionCommands.js';
import type {BlockEditorDestinationRenderContext} from './types.js';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

export const renderAnnotationSidebar = (
    context: BlockEditorDestinationRenderContext<RichBlockMeta>,
): ReactElement | null => {
    const annotations = context.annotations.byPresentation('sidebar');
    const open = context.annotations.sidebarOpen();
    return (
        <AnnotationSidebar
            state={context.state}
            annotations={annotations}
            open={open}
            gutterTops={context.annotations.gutterTops()}
            context={context}
        />
    );
};

export const renderAnnotationFooter = (
    context: BlockEditorDestinationRenderContext<RichBlockMeta>,
): ReactElement | null => {
    const annotations = context.annotations.byPresentation('footnote');
    if (!annotations.length) return null;
    return <Footnotes state={context.state} annotations={annotations} context={context} />;
};

export const renderAnnotationFloating = (
    context: BlockEditorDestinationRenderContext<RichBlockMeta>,
): ReactElement | null => {
    const popovers = context.annotations.activePopovers();
    if (!popovers.length) return null;
    return (
        <>
            {popovers.map((popover) => (
                <FloatingAnnotationPopover
                    state={context.state}
                    key={popover.id}
                    annotation={context.annotations.popoverAnnotation(popover.id)}
                    position={popover}
                    context={context}
                />
            ))}
        </>
    );
};

function AnnotationSidebar({
    state,
    annotations,
    open,
    gutterTops,
    context,
}: {
    state: CachedState<RichBlockMeta>;
    annotations: readonly RenderedAnnotation[];
    open: boolean;
    gutterTops: Readonly<Record<string, number>>;
    context: BlockEditorDestinationRenderContext<RichBlockMeta>;
}) {
    return (
        <aside
            className={
                open
                    ? 'annotationSidebar commentSidebarOpen'
                    : 'annotationSidebar commentSidebarCollapsed'
            }
            aria-label="Comments"
        >
            <button
                type="button"
                className="commentSidebarToggle"
                aria-label={open ? 'Close comments' : 'Open comments'}
                onClick={() => context.annotations.setSidebarOpen(!open)}
            >
                {open ? 'x' : '...'}
            </button>
            {open ? (
                <div className="commentCards">
                    {annotations.length ? (
                        annotations.map((annotation) => (
                            <section key={annotation.id} className="annotationCard">
                                <div className="annotationCardHeader">
                                    <strong>Comment on "{annotation.referenceText}"</strong>
                                    <button
                                        type="button"
                                        className="annotationResolveButton"
                                        aria-label="Resolve comment"
                                        title="Resolve comment"
                                        onClick={() => context.annotations.resolve(annotation)}
                                    >
                                        x
                                    </button>
                                </div>
                                {annotation.bodyBlocks.map((block) => (
                                    <AnnotationBodyBlock
                                        key={block.id}
                                        state={state}
                                        annotationId={annotation.id}
                                        block={block}
                                        context={context}
                                    />
                                ))}
                            </section>
                        ))
                    ) : (
                        <p className="commentEmpty">No comments</p>
                    )}
                </div>
            ) : (
                <div className="commentGutter" aria-label="Comment markers">
                    {annotations.map((annotation, index) => (
                        <button
                            key={annotation.id}
                            type="button"
                            className="commentGutterDot"
                            aria-label={`Open comment on ${annotation.referenceText}`}
                            style={{top: gutterTops[annotation.id] ?? 18 + index * 24}}
                            onClick={() => context.annotations.focusAnnotation(annotation)}
                        />
                    ))}
                </div>
            )}
        </aside>
    );
}

function Footnotes({
    state,
    annotations,
    context,
}: {
    state: CachedState<RichBlockMeta>;
    annotations: readonly RenderedAnnotation[];
    context: BlockEditorDestinationRenderContext<RichBlockMeta>;
}) {
    return (
        <ol className="footnotes" aria-label="Footnotes">
            {annotations.map((annotation) => (
                <li key={annotation.id}>
                    {annotation.bodyBlocks.length
                        ? annotation.bodyBlocks.map((block) => (
                              <AnnotationBodyBlock
                                  key={block.id}
                                  state={state}
                                  block={block}
                                  fallbackText={annotation.referenceText}
                                  context={context}
                              />
                          ))
                        : annotation.referenceText}
                </li>
            ))}
        </ol>
    );
}

function FloatingAnnotationPopover({
    state,
    annotation,
    position,
    context,
}: {
    state: CachedState<RichBlockMeta>;
    annotation: RenderedAnnotation | null;
    position: ReturnType<BlockEditorDestinationRenderContext<RichBlockMeta>['annotations']['activePopovers']>[number] | null;
    context: BlockEditorDestinationRenderContext<RichBlockMeta>;
}) {
    if (!annotation || !position) return null;
    return (
        <section
            className="annotationFloatingPopover"
            role="dialog"
            aria-label="Popover"
            data-popover-id={position.id}
            style={{top: position.top, left: position.left}}
            onMouseEnter={context.annotations.cancelPopoverHide}
            onMouseLeave={(event: MouseEvent<HTMLElement>) =>
                context.annotations.schedulePopoverHide(position.id, {
                    source: 'panel',
                    relatedTarget: event.relatedTarget,
                    clientX: event.clientX,
                    clientY: event.clientY,
                })
            }
            onFocus={() => context.annotations.setPopoverFocusPinned(true, position.id)}
            onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                context.annotations.setPopoverFocusPinned(false, position.id, event.relatedTarget);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                context.annotations.closeDeepestPopover();
            }}
        >
            {annotation.bodyBlocks.map((block) => (
                <AnnotationBodyBlock
                    key={block.id}
                    state={state}
                    block={block}
                    fallbackText={annotation.referenceText}
                    context={context}
                />
            ))}
        </section>
    );
}

export function AnnotationBodyBlock({
    state,
    annotationId,
    block,
    fallbackText = '',
    context,
}: {
    state: CachedState<RichBlockMeta>;
    annotationId?: string;
    block: RenderedAnnotation['bodyBlocks'][number];
    fallbackText?: string;
    context: BlockEditorDestinationRenderContext<RichBlockMeta>;
}) {
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const linkHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const codeHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [selection, setSelection] = useState<EditorSelection>(() =>
        caret(block.id, block.text.length),
    );
    const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);
    const [linkHoverPopover, setLinkHoverPopover] = useState<LinkHoverPopoverState | null>(null);
    const [codePopover, setCodePopover] = useState<CodePopoverState | null>(null);
    const [codeHoverPopover, setCodeHoverPopover] = useState<CodeHoverPopoverState | null>(null);
    const [pendingCodeMark, setPendingCodeMark] = useState(false);
    const [retainedCodeMarks, setRetainedCodeMarks] = useState<RetainedInlineMarkSession[]>([]);
    const visibleBlockIdSet = useMemo(
        () => new Set(materializeFormattedBlocks(state, annotationVirtualParents(state)).map((item) => item.id)),
        [state],
    );
    const services = context.annotations;

    const restoreAfter = useCallback(
        (selection: EditorSelection) => {
            pendingCaretRestoreBlockIdRef.current =
                selection.type === 'caret' && selection.point.blockId === block.id
                    ? block.id
                    : null;
            pendingSelectionRestoreRef.current = selection.type === 'range' ? selection : null;
            setSelection(selection);
            services.setActiveBodySelection(selection);
            if (annotationId) services.recordBodyActivity(annotationId, block.id);
        },
        [annotationId, block.id, services],
    );

    const updateSelection = useCallback(
        (nextSelection: EditorSelection | null) => {
            setSelection(nextSelection ?? caret(block.id, block.text.length));
            services.setActiveBodySelection(nextSelection);
        },
        [block.id, block.text.length, services],
    );

    const copyBodySelection = useCallback(
        (event: ClipboardEvent<HTMLDivElement>) => {
            const selected = readSelectionFromDom(event.currentTarget) ?? selection;
            const payload = serializeSelectionToClipboardPayload(
                state,
                singleRetainedSelectionSet(state, selected),
                [],
                services.inlineRenderFeatures(),
            );
            if (!payload) return;
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.plainText);
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
        },
        [selection, services, state],
    );

    const focusRequest = services.focusRequest();
    useLayoutEffect(() => {
        if (focusRequest?.blockId !== block.id) return;
        const nextSelection = focusRequest.selection ?? caret(block.id, block.text.length);
        pendingCaretRestoreBlockIdRef.current =
            nextSelection.type === 'caret' && nextSelection.point.blockId === block.id
                ? block.id
                : null;
        pendingSelectionRestoreRef.current = nextSelection.type === 'range' ? nextSelection : null;
        setSelection(nextSelection);
        services.setActiveBodySelection(nextSelection);
        services.markFocusRequestHandled();
    }, [
        block.id,
        block.text.length,
        focusRequest?.blockId,
        focusRequest?.token,
        services,
        focusRequest?.selection,
    ]);

    const run = useCallback(
        (
            selection: EditorSelection,
            apply: (
                state: CachedState<RichBlockMeta>,
                selection: EditorSelection,
                context: CommandContext,
            ) => CommandResult,
        ) => {
            services.runBodyCommand((current, commandContext) => {
                const result = apply(current.state, selection, commandContext);
                if (focusPoint(result.selection).blockId !== block.id) {
                    services.requestBodyFocus(focusPoint(result.selection).blockId, result.selection);
                }
                restoreAfter(result.selection);
                return result;
            });
        },
        [block.id, restoreAfter, services],
    );

    const cutBodySelection = useCallback(
        (event: ClipboardEvent<HTMLDivElement>) => {
            if (!services.isToolbarCommandAvailable('annotation:body-replace-selection')) return;
            const selected = readSelectionFromDom(event.currentTarget) ?? selection;
            const payload = serializeSelectionToClipboardPayload(
                state,
                singleRetainedSelectionSet(state, selected),
                [],
                services.inlineRenderFeatures(),
            );
            if (!payload) return;
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.plainText);
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
            run(selected, (currentState, activeSelection, commandContext) =>
                replaceAnnotationBodySelection(currentState, activeSelection, '', commandContext),
            );
        },
        [run, selection, services, state],
    );

    const rangeSelection = useCallback(
        (range: LinkTargetRange): EditorSelection => ({
            type: 'range',
            anchor: {blockId: range.blockId, offset: range.startOffset},
            focus: {blockId: range.blockId, offset: range.endOffset},
        }),
        [],
    );

    const openBodyLinkPopover = useCallback(
        (ranges: LinkTargetRange[], href: string, position: {top: number; left: number}) => {
            setLinkPopover({ranges, href, ...position});
        },
        [],
    );

    const applyBodyLink = useCallback(
        (href: string) => {
            const range = linkPopover?.ranges[0];
            setLinkPopover(null);
            if (!range) return;
            if (
                !services.isToolbarCommandAvailable('annotation:body-set-link') ||
                !services.isToolbarCommandAvailable('link:edit')
            ) return;
            const selected = rangeSelection(range);
            const value = href.trim();
            run(selected, (state, activeSelection, commandContext) =>
                value
                    ? setAnnotationBodyLink(state, activeSelection, value, commandContext)
                    : removeAnnotationBodyLink(state, activeSelection, commandContext),
            );
        },
        [linkPopover?.ranges, rangeSelection, run, services],
    );

    const removeBodyLink = useCallback(() => {
        const range = linkPopover?.ranges[0];
        setLinkPopover(null);
        if (!range) return;
        if (
            !services.isToolbarCommandAvailable('annotation:body-remove-link') ||
            !services.isToolbarCommandAvailable('link:edit')
        ) return;
        run(rangeSelection(range), removeAnnotationBodyLink);
    }, [linkPopover?.ranges, rangeSelection, run, services]);

    const applyBodyCodeLanguage = useCallback(
        (language: string, ranges: CodeTargetRange[]) => {
            const range = ranges[0];
            setCodePopover(null);
            if (!range) return;
            if (
                !services.isToolbarCommandAvailable('annotation:body-set-code-language') ||
                !services.isToolbarCommandAvailable('mark:code')
            ) return;
            const selected = rangeSelection(range);
            const value = language.trim();
            run(selected, (state, activeSelection, commandContext) =>
                value
                    ? setAnnotationBodyCodeMark(state, activeSelection, value, commandContext)
                    : clearAnnotationBodyCodeLanguage(state, activeSelection, commandContext),
            );
        },
        [rangeSelection, run, services],
    );

    const clearBodyCodeLanguage = useCallback((ranges: CodeTargetRange[]) => {
        const range = ranges[0];
        setCodePopover(null);
        if (!range) return;
        if (
            !services.isToolbarCommandAvailable('annotation:body-clear-code-language') ||
            !services.isToolbarCommandAvailable('mark:code')
        ) return;
        run(rangeSelection(range), clearAnnotationBodyCodeLanguage);
    }, [rangeSelection, run, services]);

    const removeBodyCode = useCallback((ranges: CodeTargetRange[]) => {
        const range = ranges[0];
        setCodePopover(null);
        if (!range) return;
        if (
            !services.isToolbarCommandAvailable('annotation:body-remove-code') ||
            !services.isToolbarCommandAvailable('mark:code')
        ) return;
        run(rangeSelection(range), removeAnnotationBodyCodeMark);
    }, [rangeSelection, run, services]);

    const cancelBodyLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = null;
    }, []);

    const scheduleBodyLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = setTimeout(() => {
            setLinkHoverPopover(null);
            linkHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    const cancelBodyCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = null;
    }, []);

    const scheduleBodyCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = setTimeout(() => {
            setCodeHoverPopover(null);
            codeHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    useLayoutEffect(
        () => () => {
            if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
            if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        },
        [],
    );

    const showBodyLinkHover = useCallback(
        (range: LinkTargetRange & {href: string}, element: HTMLElement) => {
            cancelBodyLinkHoverHide();
            setLinkHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                href: range.href,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelBodyLinkHoverHide],
    );

    const showBodyCodeHover = useCallback(
        (range: CodeTargetRange & {language: string}, element: HTMLElement) => {
            cancelBodyCodeHoverHide();
            setCodeHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                language: range.language,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelBodyCodeHoverHide],
    );

    const inlineRenderFeatures = services.inlineRenderFeatures();
    const registry = services.registry();
    const popoverTextById = services.popoverTextById() as Map<string, string>;
    const footnoteNumberById = services.footnoteNumberById() as Map<string, number>;

    return (
        <>
            {annotationBodyMarker(block.meta)}
            {services.renderEditableSurface({
                blockId: block.id,
                runs: block.runs,
                charIdsByOffset: orderedCharIdsForBlock(state, block.id, {visibleOnly: true}),
                visibleBlockIdSet,
                rainbowLamportIds: services.rainbowLamportIds(),
                decorations: null,
                pendingCaretRestoreBlockIdRef,
                pendingSelectionRestoreRef,
                selection,
                className: 'annotationBodyEditor',
                ariaLabel: 'Annotation body',
                placeholder: fallbackText || 'Annotation body',
                popoverTextById,
                footnoteNumberById,
                inlineRenderFeatures,
                onPopoverTriggerEnter: services.showPopover,
                onPopoverTriggerLeave: services.schedulePopoverHide,
                onLinkHoverEnter: showBodyLinkHover,
                onLinkHoverLeave: scheduleBodyLinkHoverHide,
                onCodeHoverEnter: showBodyCodeHover,
                onCodeHoverLeave: scheduleBodyCodeHoverHide,
                onSelectionChange: updateSelection,
                onInputMeasured: services.onInputMeasured,
                onDisplayInputRenderStarted: services.onDisplayInputRenderStarted,
                onInsertText: (text: string, activeSelection?: EditorSelection) =>
                    services.isToolbarCommandAvailable('annotation:body-replace-selection')
                        ? run(activeSelection ?? selection, (state, selected, commandContext) => {
                        if (pendingCodeMark && selected.type === 'caret') {
                            const result = insertTextWithRetainedMarks(
                                state,
                                selected,
                                text,
                                [CODE_MARK],
                                retainedCodeMarks,
                                commandContext,
                            );
                            setRetainedCodeMarks(result.sessions);
                            return result;
                        }
                        return text === '`'
                            ? insertTextWithMarkdownShortcuts(
                                      state,
                                      selected,
                                      text,
                                      commandContext,
                                      registry.markdownShortcuts,
                                  )
                            : replaceAnnotationBodySelection(state, selected, text, commandContext);
                    })
                        : undefined,
                onDeleteBackward: (activeSelection?: EditorSelection) =>
                    services.isToolbarCommandAvailable('annotation:body-delete-backward')
                        ? run(activeSelection ?? selection, (state, selected, commandContext) =>
                        deleteAnnotationBodyBackward(state, selected, commandContext, {
                            annotationId,
                            bodyBlockId: block.id,
                        }),
                    )
                        : undefined,
                onDeleteForward: (activeSelection?: EditorSelection) =>
                    services.isToolbarCommandAvailable('annotation:body-delete-forward')
                        ? run(activeSelection ?? selection, deleteAnnotationBodyForward)
                        : undefined,
                onCopy: copyBodySelection,
                onCut: cutBodySelection,
                onPaste: (event: ClipboardEvent<HTMLDivElement>) => {
                    const selected = readSelectionFromDom(event.currentTarget) ?? selection;
                    const rich = richClipboardPayloadFromDataTransfer(event.clipboardData);
                    if (rich) {
                        event.preventDefault();
                        if (!services.isToolbarCommandAvailable('annotation:body-replace-selection')) return;
                        run(selected, (state, activeSelection, commandContext) => {
                            const result = pasteRichClipboardEverywhere(
                                state,
                                singleRetainedSelectionSet(state, activeSelection),
                                rich,
                                commandContext,
                                inlineRenderFeatures,
                            );
                            return {
                                state: result.state,
                                ops: result.ops,
                                selection: primarySelection(resolveSelectionSet(result.state, result.selection)),
                            };
                        });
                        return;
                    }

                    event.preventDefault();
                    const text = event.clipboardData.getData('text/plain');
                    if (
                        services.isToolbarCommandAvailable('annotation:body-set-link') &&
                        services.isToolbarCommandAvailable('link:edit') &&
                        isLinkLikeText(text) &&
                        selected.type === 'range'
                    ) {
                        run(selected, (state, activeSelection, commandContext) =>
                            setAnnotationBodyLink(state, activeSelection, text.trim(), commandContext),
                        );
                        return;
                    }
                    if (!services.isToolbarCommandAvailable('annotation:body-replace-selection')) return;
                    run(selected, (state, activeSelection, commandContext) =>
                        pasteAnnotationBodyTextWithMarkdownShortcuts(
                            state,
                            activeSelection,
                            text,
                            commandContext,
                            registry.markdownShortcuts,
                        ),
                    );
                },
                onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                    const currentSelection = readSelectionFromDom(event.currentTarget);
                    if (currentSelection) updateSelection(currentSelection);
                    const selected = currentSelection ?? selection;
                    const modifierPressed = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!services.isToolbarCommandAvailable('annotation:body-split-block')) return;
                        run(selected, (state, activeSelection, commandContext) =>
                            splitAnnotationBodyBlock(state, activeSelection, commandContext),
                        );
                        return;
                    }
                    if (modifierPressed && (key === 'b' || key === 'i')) {
                        event.preventDefault();
                        const commandId = key === 'b' ? 'mark:bold' : 'mark:italic';
                        if (
                            !services.isToolbarCommandAvailable('annotation:body-toggle-mark') ||
                            !services.isToolbarCommandAvailable(commandId)
                        ) return;
                        run(selected, (state, activeSelection, commandContext) =>
                            toggleAnnotationBodyMark(
                                state,
                                activeSelection,
                                key === 'b' ? 'bold' : 'italic',
                                commandContext,
                            ),
                        );
                    } else if (modifierPressed && event.shiftKey && key === 'x') {
                        event.preventDefault();
                        if (
                            !services.isToolbarCommandAvailable('annotation:body-toggle-mark') ||
                            !services.isToolbarCommandAvailable('mark:strikethrough')
                        ) return;
                        run(selected, (state, activeSelection, commandContext) =>
                            toggleAnnotationBodyMark(
                                state,
                                activeSelection,
                                'strikethrough',
                                commandContext,
                            ),
                        );
                    } else if (modifierPressed && key === 'e') {
                        event.preventDefault();
                        if (
                            !services.isToolbarCommandAvailable('annotation:body-toggle-code') ||
                            !services.isToolbarCommandAvailable('mark:code')
                        ) return;
                        if (selected.type === 'caret') {
                            if (pendingCodeMark) {
                                run(selected, (state, _activeSelection, commandContext) => {
                                    const result = closeRetainedInlineMarkSessions(
                                        state,
                                        retainedCodeMarks,
                                        CODE_MARK,
                                        commandContext,
                                    );
                                    setRetainedCodeMarks(result.sessions);
                                    setPendingCodeMark(false);
                                    return {
                                        state: result.state,
                                        ops: result.ops,
                                        selection: selected,
                                    };
                                });
                            } else {
                                setPendingCodeMark(true);
                            }
                        } else {
                            run(selected, (state, activeSelection, commandContext) =>
                                toggleAnnotationBodyCodeMark(state, activeSelection, commandContext),
                            );
                        }
                    } else if (modifierPressed && key === 'k') {
                        event.preventDefault();
                        if (
                            !services.isToolbarCommandAvailable('annotation:body-set-link') ||
                            !services.isToolbarCommandAvailable('link:edit')
                        ) return;
                        if (selected.type === 'range') {
                            const ranges = [
                                {
                                    blockId: block.id,
                                    startOffset: Math.min(
                                        selected.anchor.offset,
                                        selected.focus.offset,
                                    ),
                                    endOffset: Math.max(
                                        selected.anchor.offset,
                                        selected.focus.offset,
                                    ),
                                },
                            ];
                            const selectedText = textForSelectionSegments(
                                [
                                    {
                                        id: block.id,
                                        runs: block.runs,
                                        depth: 0,
                                        parentId: '',
                                        block: {} as RichFormattedBlock['block'],
                                    },
                                ],
                                ranges,
                            ).trim();
                            if (isLinkLikeText(selectedText)) {
                                run(selected, (state, activeSelection, commandContext) =>
                                    setAnnotationBodyLink(
                                        state,
                                        activeSelection,
                                        selectedText,
                                        commandContext,
                                    ),
                                );
                            } else {
                                openBodyLinkPopover(
                                    ranges,
                                    linkHrefForSelectionSegments(
                                        [
                                            {
                                                id: block.id,
                                                runs: block.runs,
                                                depth: 0,
                                                parentId: '',
                                                block: {} as RichFormattedBlock['block'],
                                            },
                                        ],
                                        ranges,
                                    ) ?? '',
                                    linkPopoverPositionFromSelection(event.currentTarget),
                                );
                            }
                        } else if (selected.type === 'caret') {
                            const range = linkRangeAroundOffsetInRuns(
                                block.id,
                                block.runs,
                                selected.point.offset,
                            );
                            if (range) {
                                openBodyLinkPopover(
                                    [range],
                                    range.href,
                                    linkPopoverPositionFromSelection(event.currentTarget),
                                );
                            }
                        }
                    }
                },
            })}
            <LinkFloatingPopover
                state={linkPopover}
                onApply={applyBodyLink}
                onRemove={removeBodyLink}
                onClose={() => setLinkPopover(null)}
            />
            <LinkHoverPopover
                state={linkHoverPopover}
                onEdit={(state) => {
                    cancelBodyLinkHoverHide();
                    setLinkHoverPopover(null);
                    setLinkPopover(state);
                }}
                onMouseEnter={cancelBodyLinkHoverHide}
                onMouseLeave={scheduleBodyLinkHoverHide}
            />
            <CodeFloatingPopover
                state={codePopover}
                onApply={applyBodyCodeLanguage}
                onClearLanguage={clearBodyCodeLanguage}
                onRemove={removeBodyCode}
                onClose={() => setCodePopover(null)}
            />
            <CodeHoverPopover
                state={codeHoverPopover}
                onEdit={(state) => {
                    cancelBodyCodeHoverHide();
                    setCodeHoverPopover(null);
                    setCodePopover(state);
                }}
                onMouseEnter={cancelBodyCodeHoverHide}
                onMouseLeave={scheduleBodyCodeHoverHide}
            />
        </>
    );
}

export const annotationBodyMarker = (meta: RichBlockMeta): ReactElement | null => {
    if (meta.type === 'list_item') {
        return (
            <span className="annotationBodyMarker" aria-hidden="true">
                {meta.kind === 'ordered' ? '1.' : '•'}
            </span>
        );
    }
    if (meta.type === 'todo') {
        return (
            <span className="annotationBodyMarker" aria-hidden="true">
                {meta.checked ? '☑' : '☐'}
            </span>
        );
    }
    return null;
};

const linkPopoverPositionFromSelection = (
    root: HTMLElement | null,
): {top: number; left: number} => {
    const fallbackRect = root?.getBoundingClientRect();
    const selection = root?.ownerDocument.defaultView?.getSelection();
    const rect =
        selection &&
        selection.rangeCount > 0 &&
        typeof selection.getRangeAt(0).getBoundingClientRect === 'function'
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
    const top = rect && rect.height ? rect.bottom + 8 : (fallbackRect?.top ?? 0) + 28;
    const left = rect && rect.width ? rect.left : (fallbackRect?.left ?? 0);
    return {top, left};
};

const linkPopoverPositionFromElement = (element: HTMLElement): {top: number; left: number} => {
    const rect = element.getBoundingClientRect();
    return {top: rect.bottom + 8, left: rect.left};
};

const richClipboardPayloadFromDataTransfer = (
    data: DataTransfer,
): RichClipboardPayload | null => {
    const types = data.types;
    const hasTypedClipboard = Boolean(types?.length);
    const canReadType = (type: string) => !hasTypedClipboard || Array.prototype.includes.call(types, type);
    return (
        (canReadType(BLOCK_RICH_TEXT_MIME)
            ? parseBlockRichTextClipboardPayload(data.getData(BLOCK_RICH_TEXT_MIME))
            : null) ??
        (canReadType('text/html')
            ? parseBlockRichTextClipboardHtml(data.getData('text/html'))
            : null)
    );
};
