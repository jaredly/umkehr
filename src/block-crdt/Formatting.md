
Peritext's basic idea can be simplified down to:

```ts
type Char = {
    id: Lamport,
    parent: Lamport,
    text: string,
    deleted: boolean,
}

type Mark = {
    id: Lamport,
    start: {id: Lamport, at: 'before' | 'after'},
    end: {id: Lamport, at: 'before' | 'after'},
    remove: boolean,
    type: string,
    splits: Lamport[],
}

type State = {
    chars: Record<Lamport, Char>,
    // could be a record keyed by `${type}:${start}-${end}`
    // unless some marks can be applied multiple times
    marks: Mark[]
    splits: Record<Lamport, [Lamport, Lamport]>
}
```

With splits & joins, this gets a little bit more exciting.
In principle, you need to follow the mark across concurrent/subsequent splits.
We can ignore joins, because we only travel left-right, not right-left.

AHHH BUT. If we get to a split that happened *before* the mark, we need to not traverse it.
The way to do this would be to have marks store explicitly the list of splits that they "pass over".
So when creating a mark, we need to iterate along each character, and if we enounter a split id, we add it to the mark's list of splits.

A split is, visually, "between X and Y". With concurrent editing, there might end up being other characters between X and Y. Q: do we care? A: yes.

ABCDEF and we bold from B through E
and then we split between C and D
but concurrently someone edits after C adding XY (so they see ABCXYDEF)
if we hadn't split, the bold would be A[BCXYDE]F
but... if we did split, the bold would be A[BC]XY[DE]F
UNLESS actually, the left item in a split is like ... "go to the tail of this char and then jump"? yeah honestly I think that's what it should mean.
Ok so a split has a {left, right}, and the semantics are that we apply the format mark through the tail of the left char and then jump to the start of the right char and continue.
That sounds right.
