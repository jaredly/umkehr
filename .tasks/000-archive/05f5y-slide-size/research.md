# Research: Slide Deck Logical Size and Scaling

## Goal

Make slide decks in `examples/block-rich-text` render with a stable logical slide size across preview and full-screen presentation modes.

The deck metadata already defines a logical rectangle:

- `SlideDeckMeta.width`
- `SlideDeckMeta.height`

The missing behavior is that slide content should be laid out in that logical coordinate system, then scaled down for normal block preview/overview or scaled up for presentation/full-screen. A header that is visually balanced on a `1920 x 1080` slide should remain proportionally balanced when the same slide is shown at `860px` wide in the editor or near full viewport size in presentation mode.

## Current State

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/App.test.tsx`

`SlideDeckMeta` stores width and height and defaults to `1920 x 1080`:

```ts
export type SlideDeckMeta = {
    type: 'slide_deck';
    width: number;
    height: number;
    footer: SlideDeckFooterMode;
    ts: HLC;
};
```

`SlideBlockView` passes those dimensions into CSS custom properties:

```ts
const style = {
    '--slide-width': deck.width,
    '--slide-height': deck.height,
    backgroundColor: meta.backgroundColor,
} as CSSProperties;
```

Those variables are currently only used for aspect ratio:

```css
.slideViewport {
    width: min(100%, 860px);
    aspect-ratio: var(--slide-width, 1920) / var(--slide-height, 1080);
}

.slideViewport-presentation {
    width: min(100%, 1040px);
}

.slideDeckFullScreen .slideViewport-presentation {
    width: min(100%, calc((100vh - 116px) * var(--slide-width, 1920) / var(--slide-height, 1080)));
    max-height: calc(100vh - 116px);
}
```

The actual slide content fills the rendered viewport directly:

```css
.slideSurface {
    width: 100%;
    height: 100%;
    padding: clamp(16px, 4%, 44px);
}

.slideTitleText {
    font-size: clamp(18px, 2.4vw, 34px);
}
```

This means the slide dimensions affect the box shape, but not the internal layout scale. Some content sizes are tied to viewport width (`vw`) or normal block editor CSS, so preview and full-screen presentation do not preserve the same visual proportions.

## Rendering Flow

`SlideDeckBlock` renders in three modes:

- `overview`: all slide children are shown in `.slideOverviewList`.
- `presentation`: only the current slide is shown.
- `outline`: the deck and children render as normal editable blocks.

`SlideBlockView` is reused for:

- deck overview slides,
- deck presentation slides,
- orphan slide preview.

This is the main component to change. It already receives the deck metadata and controls the top-level `.slideViewport` and `.slideSurface` markup.

The full-screen state is currently UI-local only:

```ts
type SlideDeckUiState = {
    mode: SlideDeckDisplayMode;
    currentSlideId: string | null;
    fullScreen: boolean;
};
```

No CRDT changes appear necessary for basic scaling because the logical size is already persisted in block metadata and round-tripped through document import/export.

## Recommended Direction

Use a fixed logical surface inside a responsive viewport:

1. Keep `.slideViewport` responsible for fitting into available editor/presentation space while preserving the deck aspect ratio.
2. Make an inner slide canvas/surface lay out at exactly `deck.width x deck.height` CSS pixels.
3. Scale that inner surface to fit the rendered viewport with a uniform scale.
4. Keep the transform origin at the top-left.

Conceptually:

```tsx
<article className="slideViewport" style={viewportVars}>
    <div className="slideScaleLayer" style={{width: deck.width, height: deck.height, transform: `scale(${scale})`}}>
        <div className="slideSurface">...</div>
    </div>
</article>
```

The scale should be:

```ts
scale = Math.min(viewportWidth / deck.width, viewportHeight / deck.height)
```

Because `.slideViewport` already preserves the same aspect ratio as the logical size, width-based scale and height-based scale should usually be equivalent. Using `Math.min` is more robust if borders, rounding, or future layout changes create slight mismatches.

Use `ResizeObserver` on the slide viewport to derive the actual rendered size, then set scale in React state or as a CSS custom property. This is more predictable than relying on cutting-edge CSS math support for length division.

## CSS Implications

Once the slide surface has a logical size, slide-internal CSS should stop using viewport-relative sizing for core slide typography.

Likely changes:

- `.slideViewport` stays responsive and aspect-ratio based.
- Add a `.slideScaleLayer` or equivalent inner element with logical `width` and `height`.
- `.slideSurface` becomes `width: 100%; height: 100%` relative to the logical layer.
- Replace `.slideTitleText { font-size: clamp(18px, 2.4vw, 34px); }` with a logical-size font, for example `48px` or a CSS variable derived from deck size.
- Revisit `.slideFooter { font-size: 12px; }` because it will become logically scaled and may be too small if left at 12 logical px.
- Check nested block styling inside `.slideBody`; headings, lists, tables, kanban, callouts, and inline embeds inherit normal editor styles and may need slide-specific overrides.

The visual rule should be: all content inside the slide canvas is specified in logical slide units, and the whole canvas is scaled as one object.

## Interaction Implications

CSS transforms generally preserve pointer targeting visually, so clicks inside a transformed `contentEditable` surface should land in the expected place in modern browsers. Still, this needs verification because this editor has custom selection, block drag, and block selection logic.

Areas to test carefully:

- Typing and caret placement in the slide title while scaled down in overview.
- Text selection inside slide body children.
- Clicking the slide rim to block-select the slide.
- Dragging slides from the rim in overview mode.
- Presentation keyboard navigation after full-screen enter/exit.
- Block handles and drop indicators for children inside a scaled slide.

One risk: the existing drag tests mock `.slideViewport.getBoundingClientRect()`. If future code relies on measured viewport size for scale, tests may need to mock `ResizeObserver` or provide a measurement fallback.

## Testing Plan

Focused tests should cover:

- `SlideBlockView` applies a logical-size layer using deck metadata.
- Changing deck width/height updates the logical layer and preserves aspect ratio.
- Overview and presentation render the same logical slide content with different scale values.
- Full-screen presentation uses a larger scale than in-editor presentation for the same deck.
- Existing interaction tests still pass:
  - rendered slide drag,
  - rim block selection,
  - text selection inside slides,
  - presentation keyboard navigation,
  - no navigation while a text or child block selection is active.

If jsdom makes actual resize behavior awkward, split the implementation so the pure scale calculation is testable separately, then keep one integration test around the rendered styles/classes.

## Open Questions

- Should overview mode always render slides at a fixed maximum width like today (`860px`), or should it use a smaller thumbnail scale independent of available editor width?
    - let's scale to fit available horizontal width of the block
- Should in-editor presentation mode keep its current `1040px` max width, or should it fill the editor panel more aggressively now that internal content can scale correctly?
    - it can scale up if there's space available.
- Should the deck title/toolbar remain outside the scaled slide, as today, or should any presentation chrome be hidden in full-screen mode?
    - yeah let's hide presentation chrome. maybe have left/right controls show up in a little on-hover toolbar at bottom center
- What are the intended logical default typography values for a `1920 x 1080` deck: title size, body text size, footer size, and padding?
    - not sure yet. pick some defaults and I'll tweak them as needed.
- Should orphan slides have their own editable size metadata, or is the current synthetic `1920 x 1080` deck wrapper acceptable?
    - yeah let's not worry about that
- How should very small or extreme aspect-ratio decks behave? The import path only validates positive integers, so `1 x 10000` is technically valid today.
    - yeah let's limit to 1:4 or 4:1
- Should slide children keep normal editor affordances while scaled, or should presentation/full-screen mode hide editing handles and behave more like read-only presentation software?
    - keep it editable
- Is browser zoom expected to be part of the logical scaling model, or should the slide scale only respond to container size?
    - just respond to container size

## Suggested Implementation Sequence

1. Add a small `useElementSize`/`ResizeObserver` helper local to `EditorApp.tsx` or a nearby utility if a pattern already exists.
2. Add a scale layer inside `SlideBlockView` and compute `scale` from measured viewport size and deck metadata.
3. Move logical dimensions from CSS variables into the scale layer dimensions while keeping the variables for aspect ratio.
4. Convert core slide typography and spacing to logical pixel values.
5. Run and update the slide interaction tests.
6. Manually inspect overview, presentation, and browser full-screen for the slide-deck fixture.
