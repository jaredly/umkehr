import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
} from 'react';

import {richBlockStyleValue, type RichBlockMeta, type SlideTransition} from '../blockMeta.js';
import {stopEditorControlEvent} from '../editorUiUtils.js';
import type {
    BlockEditorBlockRenderer,
    BlockEditorElementSize,
    BlockEditorRenderedBlockNode,
    BlockEditorSlideDeckDisplayMode,
} from './types.js';

type SlideNode = BlockEditorRenderedBlockNode<RichBlockMeta>;
type SlideContext = Parameters<BlockEditorBlockRenderer<RichBlockMeta>['render']>[1];

const emptyElementSize: BlockEditorElementSize = {width: 0, height: 0};

export const calculateSlideScale = (
    viewport: BlockEditorElementSize,
    deck: Pick<Extract<RichBlockMeta, {type: 'slide_deck'}>, 'width' | 'height'>,
): number => {
    if (viewport.width <= 0 || viewport.height <= 0 || deck.width <= 0 || deck.height <= 0) {
        return 1;
    }
    return Math.min(viewport.width / deck.width, viewport.height / deck.height);
};

export const useElementSize = <T extends HTMLElement>(): [(element: T | null) => void, BlockEditorElementSize] => {
    const [element, setElement] = useState<T | null>(null);
    const [size, setSize] = useState<BlockEditorElementSize>(emptyElementSize);

    useLayoutEffect(() => {
        if (!element) {
            setSize(emptyElementSize);
            return;
        }

        const updateSize = () => {
            const rect = element.getBoundingClientRect();
            setSize((current) =>
                current.width === rect.width && current.height === rect.height
                    ? current
                    : {width: rect.width, height: rect.height},
            );
        };

        updateSize();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return [setElement, size];
};

export const slideFooterText = (
    footer: Extract<RichBlockMeta, {type: 'slide_deck'}>['footer'],
    deckTitle: string,
    slideIndex: number,
    slideCount: number,
): string => {
    const number = slideCount ? `${slideIndex + 1}/${slideCount}` : '';
    if (footer === 'deck-title') return deckTitle;
    if (footer === 'slide-number') return number;
    if (footer === 'deck-title-and-slide-number') return [deckTitle, number].filter(Boolean).join(' · ');
    return '';
};

export const slideDeckBlockRenderer: BlockEditorBlockRenderer<RichBlockMeta> = {
    id: 'render:slide-deck',
    blockType: 'slide_deck',
    children: 'renderer',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'slide_deck') return null;
        return <SlideDeckBlock node={node} context={context} />;
    },
};

export const slideBlockRenderer: BlockEditorBlockRenderer<RichBlockMeta> = {
    id: 'render:slide',
    blockType: 'slide',
    children: 'renderer',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'slide') return null;
        if (context.slides.deckForSlide(node.id)) return null;
        return <OrphanSlideBlock node={node} context={context} />;
    },
};

function SlideDeckBlock({node, context}: {node: SlideNode; context: SlideContext}) {
    const presentationRef = useRef<HTMLElement>(null);
    const meta = node.block.block.meta;
    if (meta.type !== 'slide_deck') return null;

    const slides = node.children.filter((child) => child.block.block.meta.type === 'slide');
    const ui = context.slides.deckUiForBlock(node.id);
    const currentSlideId =
        ui.currentSlideId && slides.some((slide) => slide.id === ui.currentSlideId)
            ? ui.currentSlideId
            : slides[0]?.id ?? null;
    const currentIndex = currentSlideId
        ? Math.max(0, slides.findIndex((slide) => slide.id === currentSlideId))
        : -1;
    const currentSlide = currentIndex >= 0 ? slides[currentIndex] : null;
    const deckTitle = context.blocks.nodeText(node);

    const selectSlideBlock = (slideId: string | null) => {
        context.slides.selectSlideBlock(slideId, {constrainFullscreenSlideSelection: false});
    };
    const setMode = (mode: BlockEditorSlideDeckDisplayMode) => {
        if (mode === 'presentation') selectSlideBlock(currentSlideId);
        context.slides.setDeckUiForBlock(node.id, (current) => ({...current, mode}));
    };
    const setCurrentSlide = (slideId: string | null, select = ui.mode === 'presentation') => {
        if (select) selectSlideBlock(slideId);
        context.slides.setDeckUiForBlock(node.id, (current) => ({...current, currentSlideId: slideId}));
    };
    const showPrevious = () => {
        if (!slides.length) return;
        const previous = slides[Math.max(0, currentIndex - 1)] ?? slides[0];
        setCurrentSlide(previous.id);
    };
    const showNext = () => {
        if (!slides.length) return;
        const next = slides[Math.min(slides.length - 1, currentIndex + 1)] ?? slides[slides.length - 1];
        setCurrentSlide(next.id);
    };
    const setFullScreen = (fullScreen: boolean) =>
        context.slides.setDeckUiForBlock(node.id, (current) => ({...current, fullScreen}));
    const exitFullScreen = () => {
        if (document.fullscreenElement === presentationRef.current) {
            void document.exitFullscreen?.();
        }
        setFullScreen(false);
    };
    const toggleFullScreen = () => {
        const element = presentationRef.current;
        if (!element) return;
        if (document.fullscreenElement === element) {
            exitFullScreen();
        } else {
            void element.requestFullscreen?.();
            setFullScreen(true);
        }
    };

    useEffect(() => {
        const onFullScreenChange = () => {
            if (document.fullscreenElement !== presentationRef.current && ui.fullScreen) {
                setFullScreen(false);
            }
        };
        document.addEventListener('fullscreenchange', onFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
    }, [ui.fullScreen]);

    const handlePresentationKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const modifierPressed = event.altKey || event.metaKey || event.ctrlKey;
        const activeElement = event.currentTarget.ownerDocument.activeElement;
        const currentSlideElement = currentSlideId
            ? presentationRef.current?.querySelector<HTMLElement>(
                  `.slideViewport[data-slide-id="${CSS.escape(currentSlideId)}"]`,
              )
            : null;
        const hasCurrentSlideBlockSelection =
            currentSlideId !== null &&
            activeElement === currentSlideElement &&
            context.slides.isCurrentBlockSelection(currentSlideId);
        if (
            hasCurrentSlideBlockSelection &&
            !modifierPressed &&
            (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ')
        ) {
            event.preventDefault();
            event.stopPropagation();
            showNext();
        } else if (
            hasCurrentSlideBlockSelection &&
            !modifierPressed &&
            (event.key === 'ArrowLeft' || event.key === 'PageUp')
        ) {
            event.preventDefault();
            event.stopPropagation();
            showPrevious();
        } else if (event.key === 'Escape' && document.fullscreenElement === presentationRef.current) {
            if (context.slides.isEditableSurfaceEventTarget(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            exitFullScreen();
        }
    };

    if (ui.mode === 'outline') {
        return (
            <section
                className="slideDeckBlock slideDeckOutline"
                data-slide-deck-id={node.id}
                style={{'--block-depth': node.block.depth} as CSSProperties}
            >
                <SlideDeckToolbar
                    mode={ui.mode}
                    currentIndex={currentIndex}
                    slideCount={slides.length}
                    onMode={setMode}
                    onPrevious={showPrevious}
                    onNext={showNext}
                    onAddSlide={() => context.slides.addSlideToDeck(node.id, currentSlideId ?? undefined)}
                    onToggleFullScreen={toggleFullScreen}
                    fullScreen={ui.fullScreen}
                />
                {context.blocks.renderEditableBlock(node, {surfaceClassName: 'slideDeckTitleText'})}
                <div className="slideDeckOutlineChildren">{context.blocks.renderChildren(node)}</div>
            </section>
        );
    }

    return (
        <section
            ref={ui.mode === 'presentation' ? presentationRef : undefined}
            className={[
                'slideDeckBlock',
                ui.mode === 'presentation' ? 'slideDeckPresentation' : 'slideDeckOverview',
                ui.fullScreen ? 'slideDeckFullScreen' : '',
            ].join(' ')}
            data-slide-deck-id={node.id}
            style={{'--block-depth': node.block.depth} as CSSProperties}
            tabIndex={ui.mode === 'presentation' ? 0 : undefined}
            onKeyDown={ui.mode === 'presentation' ? handlePresentationKeyDown : undefined}
        >
            {ui.fullScreen ? null : (
                <div className="slideDeckHeader">
                    {context.blocks.renderEditableBlock(node, {
                        surfaceClassName: 'slideDeckTitleText',
                        hideBlockAffordance: true,
                        registerBlockRow: false,
                    })}
                    <SlideDeckToolbar
                        mode={ui.mode}
                        currentIndex={currentIndex}
                        slideCount={slides.length}
                        onMode={setMode}
                        onPrevious={showPrevious}
                        onNext={showNext}
                        onAddSlide={() => context.slides.addSlideToDeck(node.id, currentSlideId ?? undefined)}
                        onToggleFullScreen={toggleFullScreen}
                        fullScreen={ui.fullScreen}
                    />
                </div>
            )}
            {ui.mode === 'presentation' ? (
                currentSlide ? (
                    <>
                        <SlideBlockView
                            node={currentSlide}
                            context={context}
                            deckId={node.id}
                            deck={meta}
                            deckTitle={deckTitle}
                            slideIndex={currentIndex}
                            slideCount={slides.length}
                            mode="presentation"
                        />
                        {ui.fullScreen ? (
                            <SlideFullScreenControls
                                currentIndex={currentIndex}
                                slideCount={slides.length}
                                onPrevious={showPrevious}
                                onNext={showNext}
                                onExitFullScreen={exitFullScreen}
                            />
                        ) : null}
                    </>
                ) : (
                    <div className="slideDeckEmpty">No slides</div>
                )
            ) : (
                <div className="slideOverviewList">
                    {slides.length ? (
                        slides.map((slide, index) => (
                            <SlideBlockView
                                key={slide.id}
                                node={slide}
                                context={context}
                                deckId={node.id}
                                deck={meta}
                                deckTitle={deckTitle}
                                slideIndex={index}
                                slideCount={slides.length}
                                mode="overview"
                            />
                        ))
                    ) : (
                        <div className="slideDeckEmpty">No slides</div>
                    )}
                </div>
            )}
        </section>
    );
}

function SlideFullScreenControls({
    currentIndex,
    slideCount,
    onPrevious,
    onNext,
    onExitFullScreen,
}: {
    currentIndex: number;
    slideCount: number;
    onPrevious(): void;
    onNext(): void;
    onExitFullScreen(): void;
}) {
    return (
        <div
            className="slideFullScreenControls"
            contentEditable={false}
            onMouseDown={stopEditorControlEvent}
            aria-label="Full screen slide controls"
        >
            <button type="button" onClick={onPrevious} disabled={currentIndex <= 0} aria-label="Previous slide">
                Prev
            </button>
            <span>
                {slideCount ? currentIndex + 1 : 0}/{slideCount}
            </span>
            <button type="button" onClick={onNext} disabled={currentIndex < 0 || currentIndex >= slideCount - 1} aria-label="Next slide">
                Next
            </button>
            <button type="button" onClick={onExitFullScreen}>
                Exit full screen
            </button>
        </div>
    );
}

function SlideDeckToolbar({
    mode,
    currentIndex,
    slideCount,
    onMode,
    onPrevious,
    onNext,
    onAddSlide,
    onToggleFullScreen,
    fullScreen,
}: {
    mode: BlockEditorSlideDeckDisplayMode;
    currentIndex: number;
    slideCount: number;
    onMode(mode: BlockEditorSlideDeckDisplayMode): void;
    onPrevious(): void;
    onNext(): void;
    onAddSlide(): void;
    onToggleFullScreen(): void;
    fullScreen: boolean;
}) {
    return (
        <div className="slideDeckToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
            <div className="slideModeTabs" role="group" aria-label="Slide deck display mode">
                {(['presentation', 'overview', 'outline'] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={mode === value}
                        onClick={() => onMode(value)}
                    >
                        {capitalize(value)}
                    </button>
                ))}
            </div>
            <div className="slideNavigation" aria-label="Slide navigation">
                <button type="button" onClick={onPrevious} disabled={currentIndex <= 0}>
                    Prev
                </button>
                <span>
                    {slideCount ? currentIndex + 1 : 0}/{slideCount}
                </span>
                <button type="button" onClick={onNext} disabled={currentIndex < 0 || currentIndex >= slideCount - 1}>
                    Next
                </button>
            </div>
            <button type="button" onClick={onAddSlide}>
                Add slide
            </button>
            {mode === 'presentation' ? (
                <button type="button" onClick={onToggleFullScreen} aria-pressed={fullScreen}>
                    {fullScreen ? 'Exit full screen' : 'Full screen'}
                </button>
            ) : null}
        </div>
    );
}

function OrphanSlideBlock({node, context}: {node: SlideNode; context: SlideContext}) {
    const mode = context.slides.orphanModeForBlock(node.id);
    if (mode === 'outline') {
        return (
            <section className="orphanSlideBlock orphanSlideOutline">
                <div className="orphanSlideToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
                    <button type="button" aria-pressed={false} onClick={() => context.slides.setOrphanModeForBlock(node.id, 'view')}>
                        View
                    </button>
                    <button type="button" aria-pressed>
                        Outline
                    </button>
                </div>
                {context.blocks.renderEditableBlock(node)}
                {context.blocks.renderChildren(node)}
            </section>
        );
    }
    return (
        <section className="orphanSlideBlock orphanSlideView">
            <div className="orphanSlideToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
                <button type="button" aria-pressed>
                    View
                </button>
                <button type="button" aria-pressed={false} onClick={() => context.slides.setOrphanModeForBlock(node.id, 'outline')}>
                    Outline
                </button>
            </div>
            <SlideBlockView
                node={node}
                context={context}
                deckId={null}
                deck={{type: 'slide_deck', width: 1920, height: 1080, footer: 'none', ts: node.block.block.meta.ts}}
                deckTitle=""
                slideIndex={0}
                slideCount={1}
                mode="orphan"
            />
        </section>
    );
}

function SlideBlockView({
    node,
    context,
    deckId,
    deck,
    deckTitle,
    slideIndex,
    slideCount,
    mode,
}: {
    node: SlideNode;
    context: SlideContext;
    deckId: string | null;
    deck: Extract<RichBlockMeta, {type: 'slide_deck'}>;
    deckTitle: string;
    slideIndex: number;
    slideCount: number;
    mode: 'presentation' | 'overview' | 'orphan';
}) {
    const meta = node.block.block.meta;
    const [setViewportElement, viewportSize] = context.slides.measureElement<HTMLElement>();
    const contextRef = useRef(context);
    contextRef.current = context;
    if (meta.type !== 'slide') return <div className="renderTreeBranch">{context.blocks.renderEditableBlock(node)}</div>;

    const footer = context.slides.footerText(deck.footer, deckTitle, slideIndex, slideCount);
    const scale = context.slides.calculateScale(viewportSize, deck);
    const dropTarget = context.dragDrop.dropTargetForBlock(node.id);
    const decoration = context.decorations.blockLevel(node.id);
    const style = {
        '--slide-width': deck.width,
        '--slide-height': deck.height,
        backgroundColor: richBlockStyleValue(node.block.block.style, 'background-color') ?? '#ffffff',
    } as CSSProperties;
    const scaleLayerStyle = {
        width: `${deck.width}px`,
        height: `${deck.height}px`,
        transform: `scale(${scale})`,
    } as CSSProperties;
    const handleRimPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        context.dragDrop.startBlockDragFromHandle(node.id, event);
    };
    const handleSurfacePointerDown = (event: PointerEvent<HTMLElement>) => {
        if (context.slides.isEditableSurfaceEventTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        context.slides.selectSlideBlock(node.id);
    };
    const stopSurfaceMouseDown = (event: MouseEvent<HTMLElement>) => {
        if (context.slides.isEditableSurfaceEventTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
    };
    const stopRimMouseDown = (event: MouseEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
    };
    const setSlideViewportElement = useCallback((element: HTMLElement | null) => {
        contextRef.current.slides.registerSlideViewport(node.id, element);
        setViewportElement(element);
    }, [node.id, setViewportElement]);

    return (
        <article
            ref={setSlideViewportElement}
            className={[
                'slideViewport',
                `slideViewport-${mode}`,
                `slideTransition-${meta.transition}`,
                context.dragDrop.isDragging(node.id) ? 'dragging' : '',
                context.dragDrop.isDraggingRoot(node.id) ? 'draggingRoot' : '',
                decoration?.selected ? 'blockSelected' : '',
                decoration?.focus ? 'blockSelectionFocus' : '',
                dropTarget ? `drop${capitalize(dropTarget.indicatorPlacement)}` : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-slide-id={node.id}
            data-slide-logical-width={deck.width}
            data-slide-logical-height={deck.height}
            data-slide-scale={scale}
            tabIndex={-1}
            style={style}
            onPointerDown={handleRimPointerDown}
            onMouseDown={stopRimMouseDown}
        >
            <div className="slideScaleLayer" style={scaleLayerStyle}>
                <div
                    className="slideSurface"
                    onPointerDown={handleSurfacePointerDown}
                    onMouseDown={stopSurfaceMouseDown}
                >
                    {meta.showTitle ? (
                        <div className="slideTitle">
                            {context.blocks.renderEditableBlock({...node.block, depth: 0}, {
                                surfaceClassName: 'slideTitleText',
                                hideBlockAffordance: true,
                                hideInlineControls: true,
                                hideBlockLevelDecoration: true,
                                registerBlockRow: false,
                                ...(deckId ? {onSplit: () => context.slides.addSlideToDeck(deckId, node.id)} : {}),
                            })}
                        </div>
                    ) : null}
                    <div className="slideBody">
                        {node.children.map((child) =>
                            context.blocks.renderNodeAtRelativeDepth(child, node.block.depth + 1),
                        )}
                    </div>
                    {footer ? <div className="slideFooter">{footer}</div> : null}
                </div>
            </div>
            {mode === 'overview' ? <SlideBlockOptions blockId={node.id} meta={meta} context={context} /> : null}
        </article>
    );
}

function SlideBlockOptions({
    blockId,
    meta,
    context,
}: {
    blockId: string;
    meta: Extract<RichBlockMeta, {type: 'slide'}>;
    context: SlideContext;
}) {
    const style = context.state.state.blocks[blockId]?.style;
    return (
        <details
            className="blockOptions slideBlockOptions"
            contentEditable={false}
            onPointerDown={stopEditorControlEvent}
            onMouseDown={stopEditorControlEvent}
            onMouseUp={stopEditorControlEvent}
            onClick={stopEditorControlEvent}
        >
            <summary className="blockOptionsButton" aria-label="Slide options">
                <span aria-hidden="true">...</span>
            </summary>
            <div className="blockOptionsMenu">
                <label className="blockOptionsToggle">
                    <input
                        type="checkbox"
                        checked={meta.showTitle}
                        aria-label="Show slide title"
                        onChange={(event) => context.slides.setSlideTitleVisibility(blockId, event.currentTarget.checked)}
                    />
                    Show title
                </label>
                <label className="blockOptionsField">
                    <span>Transition</span>
                    <select
                        className="blockOptionsSelect"
                        value={meta.transition}
                        aria-label="Slide transition"
                        onChange={(event) => context.slides.setSlideTransition(blockId, event.currentTarget.value as SlideTransition)}
                    >
                        <option value="none">None</option>
                        <option value="fade">Fade</option>
                        <option value="slide">Slide</option>
                    </select>
                </label>
                <label className="blockOptionsField">
                    <span>Text</span>
                    <input
                        className="blockOptionsText"
                        value={richBlockStyleValue(style, 'color') ?? ''}
                        placeholder="default"
                        aria-label="Block text color"
                        onChange={(event) => context.slides.setBlockStyle(blockId, 'color', event.currentTarget.value || null)}
                    />
                </label>
                <label className="blockOptionsField">
                    <span>Background</span>
                    <input
                        className="blockOptionsText"
                        value={richBlockStyleValue(style, 'background-color') ?? ''}
                        placeholder="default"
                        aria-label="Block background color"
                        onChange={(event) => context.slides.setBlockStyle(blockId, 'background-color', event.currentTarget.value || null)}
                    />
                </label>
                <label className="blockOptionsField">
                    <span>Size</span>
                    <select
                        className="blockOptionsSelect"
                        value={richBlockStyleValue(style, 'font-size') ?? ''}
                        aria-label="Block font size"
                        onChange={(event) => context.slides.setBlockStyle(blockId, 'font-size', event.currentTarget.value || null)}
                    >
                        <option value="">Default</option>
                        <option value="xsmall">Extra small</option>
                        <option value="small">Small</option>
                        <option value="normal">Normal</option>
                        <option value="large">Large</option>
                        <option value="xlarge">Extra large</option>
                    </select>
                </label>
                <label className="blockOptionsField">
                    <span>Padding</span>
                    <select
                        className="blockOptionsSelect"
                        value={richBlockStyleValue(style, 'padding') ?? ''}
                        aria-label="Block padding"
                        onChange={(event) => context.slides.setBlockStyle(blockId, 'padding', event.currentTarget.value || null)}
                    >
                        <option value="">Default</option>
                        <option value="xsmall">Extra small</option>
                        <option value="small">Small</option>
                        <option value="normal">Normal</option>
                        <option value="large">Large</option>
                        <option value="xlarge">Extra large</option>
                    </select>
                </label>
            </div>
        </details>
    );
}

const capitalize = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value);
