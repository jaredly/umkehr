import {createPatchBuilder, type DraftPatch, type PatchBuilder} from '../src/core';

type Expect<T extends true> = T;
type IsAssignable<Actual, Expected> = Actual extends Expected ? true : false;

type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};

type State = {
    title: string;
    maybe?: string;
    items: Array<{id: string; done: boolean}>;
    byId: Record<string, number>;
    shape: Shape;
};

const builder = createPatchBuilder<State, null>('type', null);

const rootBuilder: PatchBuilder<State, 'type', DraftPatch<State, 'type', null>, null> = builder;
const titlePatch: DraftPatch<State, 'type', null> = builder.title('Published');
const maybePatch: DraftPatch<State, 'type', null> = builder.maybe.$remove();
const pushPatch: DraftPatch<State, 'type', null> = builder.items.$push({id: 'a', done: false});
const itemPatch: DraftPatch<State, 'type', null> = builder.items[0].done(true);
const recordPatch: DraftPatch<State, 'type', null> = builder.byId.someKey(1);
const circlePatch: DraftPatch<State, 'type', null> = builder.shape.$variant('circle').radius(2);

builder.shape.$variant({type: 'rect', width: 2}, {
    circle: (shape, up) => up.radius(shape.radius + 1),
    rect: (shape, up) => up.width(shape.width + 1),
});

type _TitlePatch = Expect<IsAssignable<typeof titlePatch, DraftPatch<State, 'type', null>>>;
type _MaybePatch = Expect<IsAssignable<typeof maybePatch, DraftPatch<State, 'type', null>>>;
type _PushPatch = Expect<IsAssignable<typeof pushPatch, DraftPatch<State, 'type', null>>>;
type _ItemPatch = Expect<IsAssignable<typeof itemPatch, DraftPatch<State, 'type', null>>>;
type _RecordPatch = Expect<IsAssignable<typeof recordPatch, DraftPatch<State, 'type', null>>>;
type _CirclePatch = Expect<IsAssignable<typeof circlePatch, DraftPatch<State, 'type', null>>>;

// @ts-expect-error title must be a string
builder.title(123);

// @ts-expect-error pushed items must match the array element type
builder.items.$push({id: 'a'});

// @ts-expect-error array indices must expose item fields, not arbitrary fields
builder.items[0].missing(true);

// @ts-expect-error circle variant does not expose rect-only fields
builder.shape.$variant('circle').width(2);

// @ts-expect-error callback form must handle every variant
builder.shape.$variant({type: 'circle', radius: 1}, {
    circle: (shape, up) => up.radius(shape.radius + 1),
});

rootBuilder.title('Still typed');
