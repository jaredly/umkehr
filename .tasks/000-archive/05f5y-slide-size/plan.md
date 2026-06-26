# Plan: Slide Deck Logical Size and Scaling

## Decisions From Research

- Overview slides should scale to the available horizontal width of the block.
- In-editor presentation mode can scale up when there is room.
- Full-screen mode should hide the normal deck title/toolbar chrome.
- Full-screen presentation should expose slide navigation through a small bottom-center hover toolbar.
- Initial logical typography values can be chosen during implementation and tuned later.
- Orphan slides can keep the current synthetic `1920 x 1080` wrapper.
- Deck aspect ratios should be limited to `1:4` through `4:1`.
- Slides should remain editable while scaled, including in presentation mode.
- Scaling should respond to container size only, not to browser zoom as a separate concept.

## Phase 1: Normalize Deck Size Metadata

Update the slide deck size path so stored metadata stays useful for layout.

- Add a helper for validating/clamping slide deck dimensions.
- Enforce positive integer dimensions.
- Enforce aspect ratio bounds:
  - minimum `width / height` of `1 / 4`,
  - maximum `width / height` of `4 / 1`.
- Use the helper when setting slide deck width/height from block options.
- Use the same bounds in document import validation or normalization.
- Decide whether invalid imported aspect ratios should throw or clamp. Throwing is probably more consistent with existing import validation.

Files likely involved:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

Verification:

- Existing slide deck document round-trip tests still pass.
- New tests cover rejected or clamped extreme aspect ratios.
- Block options cannot persist an out-of-range ratio.

## Phase 2: Add Logical Slide Scaling

Make the slide content layout at deck metadata size, then scale the whole slide surface to the rendered viewport.

- Add a small `ResizeObserver`-based measurement helper, local to `EditorApp.tsx` unless an existing project utility fits.
- Add a pure scale calculation helper:

```ts
scale = Math.min(viewportWidth / deck.width, viewportHeight / deck.height)
```

- Add an inner scale layer to `SlideBlockView`.
- Keep `.slideViewport` responsive and aspect-ratio based.
- Set the scale layer's logical dimensions from `deck.width` and `deck.height`.
- Apply `transform: scale(...)` and `transform-origin: top left`.
- Ensure the transformed layer does not affect the viewport's outer layout size.
- Keep `--slide-width` and `--slide-height` available for CSS aspect ratio.

Expected structure:

```tsx
<article className="slideViewport" style={viewportStyle}>
    <div className="slideScaleLayer" style={scaleLayerStyle}>
        <div className="slideSurface">...</div>
    </div>
</article>
```

Verification:

- A rendered slide has a logical layer sized to metadata.
- Overview and presentation use the same logical layer but different scale values.
- Changing width/height metadata updates logical dimensions and scale.
- Existing slide selection, text selection, and drag behavior still work.

## Phase 3: Adjust Responsive Layout Rules

Update slide sizing rules so preview and presentation fit their containers cleanly.

- Overview mode:
  - remove the fixed `860px` cap or change it so the slide fits the available block width.
  - preserve indentation from block depth.
  - avoid causing horizontal overflow in normal editor columns.
- In-editor presentation mode:
  - allow the slide to grow beyond the current `1040px` cap when the panel has space.
  - preserve the deck aspect ratio.
- Full-screen mode:
  - size the slide to the maximum rectangle available after any intended margins.
  - because normal chrome will be hidden, reclaim the current header/toolbar space.
- Keep `.slideDeckEmpty` behavior reasonable in all modes.

Files likely involved:

- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/EditorApp.tsx`

Verification:

- Overview slides fill the block width.
- In-editor presentation scales larger on wide panels.
- Full-screen presentation uses substantially more viewport area than today.
- No page-level horizontal scrolling is introduced.

## Phase 4: Establish Logical Slide Typography

Convert core slide text and spacing from viewport-relative behavior to logical slide units.

- Replace viewport-based title sizing such as `2.4vw`.
- Choose initial logical defaults for a `1920 x 1080` deck.
- Scale defaults with the logical deck size if needed, or express them as percentages/custom properties based on deck dimensions.
- Suggested starting point:
  - slide padding: `72px`
  - title font: `64px`
  - title line-height: `1.12`
  - body base font: `32px`
  - body gap: `20px`
  - footer font: `22px`
- Add slide-specific overrides for common child block types if normal editor styles look too small or too dense after scaling.
- Keep editing affordances usable while scaled.

Files likely involved:

- `examples/block-rich-text/src/style.css`
- possibly `examples/block-rich-text/src/EditorApp.tsx` for CSS variables

Verification:

- Title/body/footer appear proportionally consistent between overview and full-screen.
- The slide-deck fixture remains legible.
- Nested headings, paragraphs, tables, lists, callouts, and kanban blocks do not overflow unexpectedly in common cases.

## Phase 5: Full-Screen Chrome and Hover Navigation

Hide normal presentation chrome in full-screen and add a compact hover navigation control.

- In full-screen mode, hide the deck title and existing toolbar/header.
- Add a bottom-center presentation control that appears on hover/focus.
- Include at least:
  - previous slide,
  - current slide count,
  - next slide,
  - exit full-screen.
- Keep controls accessible by keyboard focus, not only pointer hover.
- Ensure controls do not steal typing/selection behavior from editable slide content.
- Keep keyboard navigation behavior from the current presentation mode.

Files likely involved:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

Verification:

- Full-screen mode hides normal header/toolbar.
- Hover/focus toolbar appears and can navigate.
- Keyboard navigation still works when the slide block selection is active.
- Arrow/space keys do not navigate while text or child block selection is active.
- Escape still exits full-screen unless the event originates from editable content.

## Phase 6: Test Coverage and Manual QA

Update automated tests around the new layout model and preserve existing behavior.

Add or update tests for:

- logical layer dimensions from deck metadata,
- scale calculation behavior,
- overview fitting available block width,
- presentation/full-screen sizing behavior where feasible in jsdom,
- aspect ratio validation,
- full-screen chrome hiding,
- hover/focus navigation controls,
- existing slide drag from rim,
- existing rim block selection,
- existing text selection inside slides,
- existing presentation keyboard navigation.

Because jsdom does not perform real layout, keep measurement-sensitive logic testable through a pure helper or a mockable measurement layer.

Manual QA:

- Load the slide-deck fixture.
- Inspect overview mode in a normal editor panel.
- Inspect in-editor presentation mode on a wide viewport.
- Enter browser full-screen presentation.
- Confirm text size stays visually proportional across all modes.
- Edit title/body text while scaled.
- Select text inside a scaled slide.
- Drag/reorder slides from the rim.
- Try an extreme but valid deck ratio near `1:4` and `4:1`.

## Implementation Notes

- No core CRDT changes should be required.
- Keep the change scoped to the block rich text example unless shared helpers already exist.
- Avoid changing document format shape; width and height already represent the logical size.
- Be careful with transformed editable content. Pointer coordinates should work in browsers, but this is the highest interaction risk.
- Avoid using CSS viewport units for slide-internal typography after the logical layer is introduced.
- Preserve existing outline mode behavior; outline mode should remain normal editor rendering, not scaled slide rendering.
