# Research: Jigsaw Image Upload Artifact

## Goal

Update `examples/react-crdt` so the jigsaw app's new-document form can accept an uploaded image. When a document is created, the upload should be saved as an artifact with the fixed id `image`, and the board artifact should indicate that it uses `artifact:image`.

## Current Flow

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/lib/crdtApp.ts`
- `examples/react-crdt/src/lib/artifacts/index.ts`
- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`
- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/peerjs/protocol.ts`

The jigsaw app currently uses `documentInit` to render synchronous creation fields:

```ts
type JigsawDocumentInitParams = {
    pieceCount: JigsawPieceCount;
    type: JigsawGenerationType;
};
```

`JigsawApp.tsx` renders selects for piece count and board type, validates those values, and calls:

```ts
initialJigsawArtifacts(params.pieceCount, {type: params.type})
```

The shared document creation modal in `lib/documentArchive/index.tsx` stores `initParams`, calls `createOptions.validate(initParams)`, then passes the validated data to `onCreateDocument`. Each app shell then calls `initialArtifactsForApp(app, initParams)` and `createInitialCrdtHistory(app, initParams)`.

The shared initializer API in `lib/crdtApp.ts` is synchronous:

```ts
renderFields(props: {value: TInit; onChange(value: TInit): void}): ReactElement;
validate(value: TInit): {success: true; data: TInit} | {success: false; message: string};
initialState(params: TInit): TState;
initialArtifacts?(params: TInit): SerializedArtifact[];
```

That is the main constraint for file uploads. A browser `File` must be read asynchronously before it can become serializable artifact data.

## Jigsaw Artifacts Today

`JigsawBoardArtifact` currently embeds only board geometry and a fixed stock image marker:

```ts
export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: 'stock:hue';
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    pieces: JigsawPiece[];
};
```

`generateRectangularJigsawBoard` and `generateVoronoiJigsawBoard` both set:

```ts
image: 'stock:hue',
imageSize: {width: 720, height: 540}
```

`normalizeJigsawBoardArtifact` rejects any board whose `image` is not exactly `'stock:hue'`. So upload support requires widening the board type and validator to accept at least:

```ts
image: 'stock:hue' | 'artifact:image'
```

The artifact store currently manages a single fixed board artifact:

- id: `board`
- kind: `jigsaw-board`
- version: `1`
- data: `JigsawBoardArtifact`

To support the requested fixed image artifact, `jigsawArtifactStore` needs to manage two possible artifacts:

- `board`: existing board artifact
- `image`: uploaded image artifact, present only when the board references `artifact:image`

The artifact store should include both artifacts in `manifest()` and serialization when an uploaded image exists.

## Rendering Today

`JigsawPanel.tsx` ignores `board.image` beyond the implicit assumption that it is the stock hue image. It builds a source canvas with:

```ts
const sourceImage = useMemo(() => createStockHueCanvas(board.imageSize), [board.imageSize]);
```

That `HTMLCanvasElement` is then passed to:

- `SolvedImageCanvas`
- each `JigsawPieceView`
- `PieceCanvas`

The piece renderer clips a piece mask and draws from the source canvas. This is already a good rendering model for uploaded images if the app can produce an `HTMLCanvasElement` for either source:

- stock: generate hue canvas synchronously
- uploaded artifact: decode image data, draw it into a canvas, probably scaled/cropped to `board.imageSize`

`JigsawMinimap.tsx` still uses color-derived fills based on piece centers, not the source image. It does not need to load the image for correctness, though it may remain a simplified preview.

## Likely Implementation Shape

Add a jigsaw image artifact type, for example:

```ts
type JigsawImageArtifact = {
    id: 'image';
    mimeType: string;
    dataUrl: string;
    originalName?: string;
};
```

Use a corresponding serialized artifact:

- id: `image`
- kind: `jigsaw-image`
- version: `1`
- fingerprintHash: `artifactFingerprintHash(imageArtifact)`
- data: `JigsawImageArtifact`

Keep board geometry independent of the uploaded image dimensions unless there is a reason to regenerate sizes. The least invasive approach is to continue using `JIGSAW_IMAGE_SIZE` (`720x540`) for puzzle geometry and draw the uploaded bitmap into that canvas using an object-fit policy.

The document initializer likely needs a small shared API extension because file reading is async. Options:

1. Add an optional async hook to `AppDocumentInitializer`, such as `prepareCreateParams?(params): Promise<TInit>`, and call it from `DocumentManagerModal.createDocument` after validation or before final validation.
2. Allow `validate` and/or `initialArtifacts` to be async, then update every creation caller to await `initialArtifactsForApp`. This has wider blast radius because all app shells currently call it synchronously.
3. Store a serializable data URL directly in `initParams` from the file input's `onChange` handler. This keeps `initialArtifactsForApp` synchronous but pushes async file reading into `renderFields`, and the form needs pending/error state to avoid creating while the file is still loading.

Option 3 is probably the smallest change for this task. The jigsaw `renderFields` can render an `<input type="file" accept="image/*">`, read the selected file with `FileReader.readAsDataURL`, and call `onChange({...value, image: uploadedImage})` once loaded. `validate` can accept either no image or a serializable uploaded image object. `initialArtifacts` can synchronously emit `[boardArtifact, imageArtifact]` when upload data is present.

If the file input should be generic for future apps, option 1 is cleaner, but it touches shared initializer types and modal flow.

## Artifact Store Changes

`jigsawArtifactStore` currently has one module-level `loadedBoard`. It can add `loadedImage: JigsawImageArtifact | null`.

Expected behavior:

- `get('board')` returns `loadedBoard`
- `get('image')` returns `loadedImage`
- `serialize('board')` returns the board
- `serialize('image')` returns the image artifact when present
- `load(boardArtifact)` normalizes and stores the board
- `load(imageArtifact)` validates and stores the image
- `manifest()` returns board plus image when present
- `createInitial()` resets to the default stock board and clears `loadedImage`
- `initialJigsawArtifacts(pieceCount, options)` returns a stock board only unless an uploaded image is passed

One subtle point: artifact loading may call `load()` for board and image independently. The store should tolerate either order. Rendering should fall back to stock or a missing-image placeholder if a board references `artifact:image` but the image artifact has not loaded yet or is invalid.

## Board Generation Changes

Add an option to `generateJigsawBoard` and both generation paths:

```ts
generateJigsawBoard(pieceCount, {
    type,
    image: 'stock:hue' | 'artifact:image',
})
```

The generated board title could remain generic, or change to include the uploaded file name. The task only requires the board artifact to indicate `artifact:image`.

Validation should preserve backward compatibility:

- existing artifacts with `image: 'stock:hue'` keep loading
- old rectangular artifacts without `bounds` still normalize
- new artifacts with `image: 'artifact:image'` load only when the rest of the board is valid

The artifact version can likely remain `1` if this is treated as a compatible extension and the validator accepts both image markers. Bumping to `2` would require migration/compatibility decisions.

## Rendering Changes

Add a hook/helper that resolves the jigsaw source canvas:

```ts
function useJigsawSourceCanvas(board: JigsawBoardArtifact): HTMLCanvasElement | null
```

For `stock:hue`, return `createStockHueCanvas(board.imageSize)`.

For `artifact:image`, read `currentJigsawImage()` from the artifact store, decode its data URL with `Image`, and draw it into a canvas of `board.imageSize`. Because decoding is async, the hook should return stock/placeholder/null while loading and trigger a rerender when ready.

Questions to settle in implementation:

- Use contain, cover, or stretch when the uploaded image aspect ratio differs from `720x540`.
- Whether to show any user-visible missing/decode error in `JigsawPanel`.
- Whether minimap should remain hue-colored or use the uploaded image. It is not required by the task.

## Persistence and Sync Considerations

The artifact pipeline already persists serialized artifacts for local, solo, local-first, server, and PeerJS modes. The important risk is payload size.

PeerJS protocol has a hard artifact message size cap:

```ts
MAX_PEER_ARTIFACT_BYTES = 128_000
```

Base64 data URLs expand binary image size by roughly one third. A typical camera photo will exceed the PeerJS cap unless the app resizes/re-encodes the image before saving it as an artifact.

For robust behavior, uploaded images should be resized into the board's `720x540` canvas and serialized as a compressed data URL, probably JPEG or WebP. This also makes rendering deterministic because the artifact exactly matches the board image size.

If lossless transparency is desired, PNG/WebP may be preferable, but PNG can easily exceed the PeerJS limit.

## Tests To Add/Update

Likely unit tests in `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`:

- `generateJigsawBoard(..., {image: 'artifact:image'})` stores `image: 'artifact:image'`.
- `initialJigsawArtifacts` with uploaded image params returns both `board` and `image` artifacts.
- `jigsawArtifactStore.manifest()` and `serialize()` include `image` after loading/creating a custom-image document.
- `jigsawArtifactStore.createInitial()` clears any previous uploaded image.
- `normalizeJigsawBoardArtifact` accepts `artifact:image` and still accepts legacy `stock:hue`.
- invalid image artifact data is ignored.
- `jigsawApp.documentInit.validate` accepts valid uploaded-image params and rejects malformed ones.

Existing tests that assert `board.image === 'stock:hue'` need to keep passing for default generation.

Potential render test:

- In a jsdom-compatible test, mock image decoding enough to verify that `JigsawPanel` chooses an uploaded artifact source when `board.image === 'artifact:image'`. Canvas pixel-level testing may be brittle in jsdom, so unit-testing the helper that creates/resizes image artifact data may be more reliable.

Protocol test:

- Add or update a PeerJS artifact-size test to ensure a default custom-image artifact stays below `MAX_PEER_ARTIFACT_BYTES` if the implementation resizes/re-encodes uploads.

## Open Questions

1. Should uploaded images be optional with stock hue as the default, or should the jigsaw new-document form require an image once the file input exists?
    - we can have it be optional
2. What should happen when the uploaded image aspect ratio differs from `720x540`: cover/crop, contain/letterbox, or stretch?
    - respect the image's aspect ratio. change the canvas size to match it.
3. What encoded format and quality should the app use for the stored artifact? JPEG/WebP keeps PeerJS payloads smaller; PNG preserves transparency but may exceed sync limits.
    - jpeg/webp is fine
4. Should there be a maximum accepted input file size before decoding, or is resizing after load enough?
    - 20mb
5. Should the board artifact title include the uploaded file name?
    - sure
6. Should the minimap show the real uploaded image, or is the existing abstract piece-color minimap acceptable?
    - existing piece color is fine
7. Is `image: 'artifact:image'` the exact intended board field value, or should the board use a structured reference such as `{type: 'artifact', id: 'image'}`? The task wording suggests the string marker.
    - either is fine
8. Should `JIGSAW_BOARD_VERSION` remain `1` as a compatible schema extension, or bump to `2` for the widened image field?
    - it can stay as 1
