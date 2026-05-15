import {blankHistory, createPatchBuilder, dispatch} from 'umkehr';

type Document = {
    title: string;
    tags: string[];
};

const initial: Document = {
    title: 'Draft',
    tags: [],
};

const $ = createPatchBuilder<Document>();

let history = blankHistory(initial);

history = dispatch(history, [$.title('First draft')]);
const branchPoint = history.tip;

history = dispatch(history, [$.tags.$push('release')]);
const mainlineTip = history.tip;

history = dispatch(history, {op: 'undo'});
history = dispatch(history, [$.title('Alternate draft')]);
const alternateTip = history.tip;

console.log('Current branch:', history.current);
console.log('Branch point children:', history.nodes[branchPoint].children);

history = dispatch(history, {op: 'jump', id: mainlineTip});
console.log('Jumped to mainline:', history.current);

history = dispatch(history, {op: 'jump', id: alternateTip});
console.log('Jumped to alternate:', history.current);
