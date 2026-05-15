import {createPatchBuilder, resolveAndApply} from 'umkehr';

type Shape =
    | {type: 'circle'; radius: number}
    | {type: 'label'; text: string};

type Drawing = {
    selected: Shape;
};

const equal = Object.is;
const $ = createPatchBuilder<Drawing>();

const circle: Drawing = {
    selected: {type: 'circle', radius: 5},
};

const enlarged = resolveAndApply(
    circle,
    [$.selected.$variant('circle').radius(12)],
    undefined,
    'type',
    equal,
).current;

const labeled: Drawing = {
    selected: {type: 'label', text: 'Draft'},
};

const emphasized = resolveAndApply(
    labeled,
    [
        $.selected.$variant(labeled.selected, {
            circle: (value, up) => up.radius(value.radius + 1),
            label: (value, up) => up.text(`${value.text}!`),
        }),
    ],
    undefined,
    'type',
    equal,
).current;

console.log('Direct variant update:', enlarged);
console.log('Callback variant update:', emphasized);
