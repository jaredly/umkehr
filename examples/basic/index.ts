import {applyPatch, createPatchBuilder, invertPatch, resolveAndApply} from 'umkehr';

type Document = {
    title: string;
    tags: string[];
};

const equal = Object.is;

const initial: Document = {
    title: 'Draft',
    tags: ['local'],
};

const $ = createPatchBuilder<Document>();

const {current, changes} = resolveAndApply(
    initial,
    [$.title('Published'), $.tags.$push('release')],
    undefined,
    'type',
    equal,
);

const restored = changes
    .toReversed()
    .map(invertPatch)
    .reduce((state, patch) => applyPatch(state, patch, equal), current);

console.log('Initial:', initial);
console.log('Current:', current);
console.log('Realized changes:', changes);
console.log('Restored:', restored);
