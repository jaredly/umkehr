# Plan: Jigsaw Image Upload Artifact

## Decisions From Research

- Uploaded images are optional; the stock hue puzzle remains the default.
- Uploaded images should preserve their aspect ratio by changing the puzzle image size to match the processed upload canvas.
- Store uploaded image artifacts as JPEG or WebP.
- Reject uploads larger than 20 MB before decoding.
- Include the uploaded file name in the generated board title.
- Keep the minimap's existing abstract piece-color rendering.
- Use the board marker `image: 'artifact:image'`.
- Keep `JIGSAW_BOARD_VERSION = 1`.

## Phase 1: Extend Jigsaw Artifact Types And Store

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/model.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Add constants for the uploaded image artifact:
   - `JIGSAW_IMAGE_ARTIFACT_ID = 'image'`
   - `JIGSAW_IMAGE_KIND = 'jigsaw-image'`
   - `JIGSAW_IMAGE_VERSION = 1`
   - `JIGSAW_ARTIFACT_IMAGE_REF = 'artifact:image'`

2. Widen `JigsawBoardArtifact.image`:

   ```ts
   image: 'stock:hue' | 'artifact:image';
   ```

3. Add a serializable image artifact type:

   ```ts
   export type JigsawImageArtifact = {
       id: 'image';
       mimeType: 'image/jpeg' | 'image/webp';
       dataUrl: string;
       width: number;
       height: number;
       originalName?: string;
   };
   ```

4. Add `loadedImage: JigsawImageArtifact | null` next to `loadedBoard`.

5. Update `jigsawArtifactStore`.
   - `get('image')` returns `loadedImage`.
   - `serialize('image')` returns the image artifact when present.
   - `load()` accepts either a board artifact or an image artifact.
   - `manifest()` returns `[board]` plus image metadata when `loadedImage` exists.
   - `createInitial()` resets the default stock board and clears `loadedImage`.

6. Add validators/serializers:
   - `serializeImageArtifact`.
   - `manifestForImage`.
   - `normalizeJigsawImageArtifact`.
   - `isJigsawImageArtifact`.
   - Validate `id`, MIME type, positive finite dimensions, and a matching image data URL prefix.
   - Verify fingerprints the same way board artifacts are verified.

7. Preserve board compatibility.
   - `normalizeJigsawBoardArtifact` should accept both `'stock:hue'` and `'artifact:image'`.
   - Legacy rectangular artifacts without `bounds` should still normalize.
   - Keep `JIGSAW_BOARD_VERSION` at `1`.

8. Export the new artifact type/constants through `model.ts` if render code or tests need them.

## Phase 2: Generate Boards For Uploaded Images

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Extend board generation options:

   ```ts
   type JigsawBoardImageOptions =
       | {image?: 'stock:hue'}
       | {image: 'artifact:image'; imageSize: {width: number; height: number}; imageName?: string};
   ```

2. Update `generateJigsawBoard`, `generateRectangularJigsawBoard`, and `generateVoronoiJigsawBoard` to use the requested image marker and image size.
   - Default remains `stock:hue` and `JIGSAW_IMAGE_SIZE`.
   - Uploaded-image boards use the processed image dimensions.
   - Piece geometry, bounds, arrangement, and neighbor offsets should derive from the selected image size.

3. Update helpers that currently assume `JIGSAW_IMAGE_SIZE`.
   - `legacyRectangularBounds` can keep using `JIGSAW_IMAGE_SIZE` for true legacy board data because old artifacts were generated at that size.
   - New generated boards should not depend on the fixed size.

4. Update `initialJigsawArtifacts`.
   - For stock documents, return only the board artifact.
   - For uploaded-image documents, return the board artifact plus the fixed `image` artifact.
   - The board artifact must contain `image: 'artifact:image'`.

5. Include the original file name in the board title when available.
   - Keep the title deterministic enough for tests.
   - Avoid storing path-like input; use only `File.name`.

## Phase 3: Add Upload Processing To Document Creation

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/style.css`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Extend `JigsawDocumentInitParams` with an optional uploaded image payload:

   ```ts
   image?: JigsawImageArtifact;
   imageStatus?: 'idle' | 'loading' | 'ready' | 'error';
   imageError?: string;
   ```

   If status/error fields should not reach validation, split the UI draft type from the validated init type.

2. Add a file input to `documentInit.renderFields`.
   - Use `<input type="file" accept="image/*">`.
   - Keep upload optional.
   - Show concise selected-file/error status in the form if needed.

3. Reject files over 20 MB before reading.
   - Clear any previous uploaded image when rejection happens.
   - Surface a validation message that prevents creation until resolved.

4. Read and process selected files asynchronously in the field handler.
   - Decode the selected image.
   - Draw it to a canvas preserving aspect ratio.
   - Re-encode as JPEG or WebP.
   - Store the resulting `JigsawImageArtifact`-shaped data in `initParams`.

5. Decide the processing target dimensions.
   - Preserve the image aspect ratio.
   - Keep dimensions bounded so serialized artifacts remain practical for PeerJS.
   - A reasonable first target is to scale the longer edge down to a fixed maximum near the current board size, then derive the other edge from the aspect ratio.
   - Avoid upscaling small images unless visual quality requires it.

6. Keep creation disabled while an image is loading or in an error state.
   - `validate()` should reject `imageStatus: 'loading'` and `imageStatus: 'error'`.
   - `validate()` should accept missing `image`.
   - `validate()` should accept a valid `JigsawImageArtifact`.

7. Keep `initialArtifactsForApp` synchronous.
   - Process the file before form submission by storing serializable image data in `initParams`.
   - Avoid changing shared app initializer APIs unless this approach turns out to be too awkward.

8. Add minimal CSS for the file input/status if the existing `.documentCreateField` rules do not handle it cleanly.

## Phase 4: Render Uploaded Image Sources

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx` only if type updates are needed.

Tasks:

1. Add a public accessor such as:

   ```ts
   export function currentJigsawImage(): JigsawImageArtifact | null;
   ```

2. Replace the hard-coded stock source canvas creation with a source resolver:

   ```ts
   const sourceImage = useJigsawSourceCanvas(board);
   ```

3. Implement `useJigsawSourceCanvas`.
   - For `stock:hue`, return `createStockHueCanvas(board.imageSize)`.
   - For `artifact:image`, load `currentJigsawImage()?.dataUrl` into an `Image`.
   - Draw the decoded image into a canvas sized to `board.imageSize`.
   - Return a stock/neutral placeholder while the image is decoding or missing, so the panel does not crash.

4. Handle image decode failures.
   - Keep the puzzle usable.
   - Prefer a neutral or stock fallback over user-facing modal errors inside the board.

5. Leave `JigsawMinimap` abstract.
   - It can continue using `pieceFill(board, piece)` based on piece centers.
   - Ensure any type widening for `board.image` does not affect minimap compilation.

## Phase 5: Persistence And Sync Checks

Files:

- `examples/react-crdt/src/lib/peerjs/protocol.test.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- Existing app shell files only if failures reveal assumptions.

Tasks:

1. Verify local, solo, local-first, server, and PeerJS shells do not need custom artifact handling.
   - They already persist serialized artifacts from `initialArtifactsForApp`.
   - They should automatically carry the new `image` artifact if it appears in the store manifest.

2. Add a PeerJS size-focused test if the upload processing helper is testable outside the browser.
   - The goal is to keep a typical processed upload below `MAX_PEER_ARTIFACT_BYTES`.
   - If browser canvas encoding cannot be tested in Vitest, document the residual UI-level risk instead.

3. Ensure archive import/export keeps both artifacts.
   - The generic archive path already serializes artifact arrays, but tests should cover jigsaw image artifacts if convenient.

## Phase 6: Tests

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/lib/peerjs/protocol.test.ts` if adding protocol coverage

Tasks:

1. Keep default generation tests asserting `board.image === 'stock:hue'`.

2. Add board generation tests for uploaded images:
   - `generateJigsawBoard(30, {type: 'rectangular', image: 'artifact:image', imageSize})`.
   - `generateJigsawBoard(30, {type: 'voronoi', image: 'artifact:image', imageSize})`.
   - Assert `board.image`, `board.imageSize`, piece count, and piece geometry derived from the custom dimensions.

3. Add artifact serialization/store tests:
   - `initialJigsawArtifacts` returns one artifact for stock.
   - `initialJigsawArtifacts` returns `board` and `image` for uploaded images.
   - The board artifact references `artifact:image`.
   - `jigsawArtifactStore.manifest()` includes both artifacts after loading/creating uploaded-image artifacts.
   - `serialize('image')` returns the uploaded artifact.
   - `createInitial()` clears the uploaded image artifact.
   - Invalid image artifact data is ignored.

4. Add document initializer validation tests:
   - Missing image is valid.
   - Valid processed image artifact is valid.
   - Loading/error image state is invalid.
   - Oversized-file logic is covered if factored into a pure helper.

5. Add rendering helper tests only where stable.
   - Prefer pure image artifact validation/generation tests over brittle canvas pixel tests in jsdom.
   - If `useJigsawSourceCanvas` gets factored into pure canvas helpers, test the object-fit/dimension behavior there.

## Phase 7: Verification

Commands:

1. Run focused jigsaw tests:

   ```sh
   cd examples/react-crdt
   pnpm exec vitest run src/apps/jigsaw/jigsaw.test.ts
   ```

2. Run PeerJS protocol tests if touched:

   ```sh
   cd examples/react-crdt
   pnpm exec vitest run src/lib/peerjs/protocol.test.ts
   ```

3. Run the relevant package typecheck/test script from `examples/react-crdt/package.json`.

4. Manual UI check:
   - Start the React CRDT dev server.
   - Open the jigsaw app.
   - Create a document without an image and confirm the stock puzzle still works.
   - Create a document with a small image and confirm:
     - the form accepts the file,
     - the board title includes the file name,
     - pieces render from the uploaded image,
     - export/import preserves the image,
     - the minimap remains usable.

## Implementation Notes

- Keep uploaded images optional and avoid broad shared initializer changes unless necessary.
- Process image files before document creation so `initialArtifactsForApp` can stay synchronous.
- Keep the fixed artifact id `image`; reject or ignore any extra uploaded image artifact ids.
- Use `image: 'artifact:image'` in the board artifact because it matches the task wording and is easy to validate.
- Preserve existing artifacts and tests for stock hue puzzles.
- Be careful with module-level artifact store state in tests; reset through `jigsawArtifactStore.createInitial?.()` or load known artifacts between cases.
