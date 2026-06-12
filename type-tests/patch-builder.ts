import {createPatchBuilder, type DraftPatch, type PatchBuilder} from '../src/core';
import {blockRichTextBuilderExtension, type BlockRichText} from '../src/block-richtext';

type Expect<T extends true> = T;
type IsAssignable<Actual, Expected> = Actual extends Expected ? true : false;

type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};
type CustomShape = {kind: 'circle'; radius: number} | {kind: 'rect'; width: number};

type State = {
    title: string;
    maybe?: string;
    maybeNested?: {label: string};
    blockBody: BlockRichText;
    items: Array<{id: string; done: boolean}>;
    byId: Record<string, number>;
    shape: Shape;
    customShape: CustomShape;
};

type BlockBuilderExtensions = [typeof blockRichTextBuilderExtension];
const blockBuilder = createPatchBuilder<State, BlockBuilderExtensions>({
    builderExtensions: [blockRichTextBuilderExtension],
});
const builder = createPatchBuilder<State>();
const customBuilder = createPatchBuilder<State, 'kind'>('kind');

const rootBuilder: PatchBuilder<
    State,
    'type',
    DraftPatch<State, 'type', undefined>,
    undefined
> = builder;
const titlePatch: DraftPatch<State, 'type', undefined> = builder.title('Published');
const maybePatch: DraftPatch<State, 'type', undefined> = builder.maybe.$remove();
const maybeNestedPatch: DraftPatch<State, 'type', undefined> = builder.maybeNested.label('Label');
const pushPatch: DraftPatch<State, 'type', undefined> = builder.items.$push({id: 'a', done: false});
const itemPatch: DraftPatch<State, 'type', undefined> = builder.items[0].done(true);
const movePatch: DraftPatch<State, 'type', undefined> = builder.items.$move({
    fromIdx: 0,
    targetIdx: 1,
    after: true,
});
const reorderPatch: DraftPatch<State, 'type', undefined> = builder.items.$reorder([1, 0]);
const recordPatch: DraftPatch<State, 'type', undefined> = builder.byId.someKey(1);
const blockPatch: DraftPatch<State, 'type', undefined, BlockBuilderExtensions> =
    blockBuilder.blockBody.$block.insertText({
        block: '0000-seed',
        offset: 0,
        text: 'hi',
    });
const circlePatch: DraftPatch<State, 'type', undefined> = builder.shape
    .$variant('circle')
    .radius(2);
const customPatch: DraftPatch<State, 'kind', undefined> = customBuilder.customShape
    .$variant('rect')
    .width(4);

builder.shape.$variant(
    {type: 'rect', width: 2},
    {
        circle: (shape, up) => up.radius(shape.radius + 1),
        rect: (shape, up) => up.width(shape.width + 1),
    },
);

type _TitlePatch = Expect<IsAssignable<typeof titlePatch, DraftPatch<State, 'type', undefined>>>;
type _MaybePatch = Expect<IsAssignable<typeof maybePatch, DraftPatch<State, 'type', undefined>>>;
type _MaybeNestedPatch = Expect<
    IsAssignable<typeof maybeNestedPatch, DraftPatch<State, 'type', undefined>>
>;
type _PushPatch = Expect<IsAssignable<typeof pushPatch, DraftPatch<State, 'type', undefined>>>;
type _ItemPatch = Expect<IsAssignable<typeof itemPatch, DraftPatch<State, 'type', undefined>>>;
type _MovePatch = Expect<IsAssignable<typeof movePatch, DraftPatch<State, 'type', undefined>>>;
type _ReorderPatch = Expect<
    IsAssignable<typeof reorderPatch, DraftPatch<State, 'type', undefined>>
>;
type _RecordPatch = Expect<IsAssignable<typeof recordPatch, DraftPatch<State, 'type', undefined>>>;
type _BlockPatch = Expect<
    IsAssignable<typeof blockPatch, DraftPatch<State, 'type', undefined, BlockBuilderExtensions>>
>;
type _CirclePatch = Expect<IsAssignable<typeof circlePatch, DraftPatch<State, 'type', undefined>>>;
type _CustomPatch = Expect<IsAssignable<typeof customPatch, DraftPatch<State, 'kind', undefined>>>;

// @ts-expect-error title must be a string
builder.title(123);

// @ts-expect-error pushed items must match the array element type
builder.items.$push({id: 'a'});

// @ts-expect-error array indices must expose item fields, not arbitrary fields
builder.items[0].missing(true);

// @ts-expect-error object builders do not expose array move
builder.byId.$move({fromIdx: 0, targetIdx: 1, after: true});

// @ts-expect-error block extension is not available unless configured
builder.blockBody.$block.insertText({block: '0000-seed', offset: 0, text: 'hi'});

// @ts-expect-error block offset must be a number
blockBuilder.blockBody.$block.insertText({block: '0000-seed', offset: '0', text: 'hi'});

// @ts-expect-error plain strings do not expose block rich text methods
blockBuilder.title.$block.insertText({block: '0000-seed', offset: 0, text: 'hi'});

// @ts-expect-error circle variant does not expose rect-only fields
builder.shape.$variant('circle').width(2);

builder.shape.$variant(
    {type: 'circle', radius: 1},
    // @ts-expect-error callback form must handle every variant
    {
        circle: (shape, up) => up.radius(shape.radius + 1),
    },
);

rootBuilder.title('Still typed');
