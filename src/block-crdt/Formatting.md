
Adding Peritext-style formatting would look something like this:

```ts
type Mark = {
    id: Lamport,
    start: {id: Lamport, at: 'before' | 'after'},
    end: {id: Lamport, at: 'before' | 'after'},
    remove: boolean,
    type: string,
    data?: JsonValue,
    splits: Lamport[], // these are "known splits between start & end at the time of marking", and should therefore be *ignored* when applying the mark
}

type State = {
    chars: Record<string, Char>,
    marks: Mark[]
    // A split is a pair of lamport ids representing the left and right of a split
    splits: Record<string, [Lamport, Lamport]>
}
```

With splits & joins, this gets a little bit more exciting.
In principle, you need to follow the mark across concurrent/subsequent splits.
We can ignore joins, because we only travel left-right, not right-left.

But, if we get to a split that happened *before* the mark, we need to not traverse it.
The way to do this would be to have marks store explicitly the list of splits that they "pass over".
So when creating a mark, we need to iterate along each character, and if we enounter a split id, we add it to the mark's list of splits.

A split is, visually, "a break between X and Y". With concurrent editing, there might end up being other characters between X and Y. Q: do we care? A: yes.

ABCDEF and we bold from B through E
and then we split between C and D
but concurrently someone edits after C adding XY (so they see ABCXYDEF)
if we hadn't split, the bold would be A[BCXYDE]F
but... if we did split, and we treat C as the place to jump, the bold would be A[BC]XY\n[DE]F
The way to fix this is for the left item in a split to be treated as "go to the tail of this char and then jump".
Ok so a split has a {left, right}, and the semantics are that we apply the format mark through the tail of the left char and then jump to the start of the right char and continue.
That sounds right.

QUESTION: it's possible for there to be multiple splits.
how do we know down which path we will find our "end"?
like logically, a mark should follow the path from the start to the end.

A[BCDE]F

ABC
DEF

ABCXY
DEF

ABC
XY
DEF

the XY split is a red herring.
Noww the XY split is a ... descendent of the CD split. So we could in principle
maintain a total ordering of splits.

Although.

ABC
DEF

ABCXYDEF

ABC
XYDEF

-> I think this results in

ABC
XY
DEF

by some logic, XY should be bolded.

The CX split and the CD split don't know about each other.
however, X must have a higher lamport number than D.

OK so if there are multiple splits with the same left, then we take the one with the"oldest" right.
Is it possible for both to have the same "age" right?
yes.

ABC

1:
ABED

AB
ED

2:
ABXD

AB
XD

e & x do not have a causal dependency.
however, one of the splits will win, ultimately keyed by the right's lamport number, so D will go with the "older" split, I think.
So again, if there are multiple splits with the same left, then we take the one with the "older" right, and that's where we'll find our "end".

We'll want some robust testing of this, but I'm optimistic.

##

A note about mark traversal over splits. The rule should be "continue to the tail of the start char, *but* jump early if you see a char with a "join-style" parent". Unfortunately we don't actually track join-style parents just yet. Maybe the initial parent.ts should be blank? And then a populated string ts would signal a join? that seems reasonable.
