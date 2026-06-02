
So an altnerative option to "multi-line-peritext" (which has to do lots of additional bookkeeping on top of peritext lamport + parent ids), we could go all in on the text being movable, and allow explicit reparenting.

So:
type Char = {id: string, text: string, parentId: string|null, ts: string}

parentId can be updated.
split -> null   = split this out
join  -> parent = the last character in a block

NOTE: in order for formatting to make sense, we would have to track the split as a first-class datum, because abcde : (1) bold (a,e) and (2) split between b & c; in order for them to be reorderable, we'd need to follow the split after b in order to bold c & d.

BUT split is actually more complicated. We can't just give a single character a new parent, we need some kind of causal fronteir, because what appears to be a 1d stream of text is actually a causal tree.

For that reason, the split might have to cover several branches of the tree, reparenting all of them and rearranging things.
That might be fine though? hmmm. Yeah we might be able to still get away with just parentId&ts. (it would be multiple parentId edits at once)




Algos to look at:
- YATA
- LogootSplit


OK another thing about split:
we need some kind of ... causal thing where a split
would be ... overridden ... if the thing that it's splitting from was in a different block or something.

like

aaabbbbbccccc

where the bs & cs are sibling children of the last a
a split in the middle of the bs would involve a reparenting of the first c to the last b
BUT if you split before the first c, then combining those two actions would be order-dependent, when it feels like they should be independent.

:1
aaabb
bbbccccc

:2
aaabbbbb
ccccc

Logically it should produce
aaabb
bbb
ccccc
regardless of the application order.
BUT because :1 reparents c after b, it could override :2's split.
which makes me think that maybe the causal frontier approach is better?? hmmmm. because that wouldn't produce contention with the :2 change.

ORR hm. So what about, blocks have multiple ordered roots?

1: AB[EF]CD[M]

A: [B, M]
B: [E, C]
E: [F]
C: [D]

So to split before F, the frontier would be F/C/M
and block 2: would have roots F, C, M

But t split before C, the fronteir would be C/M
and block 3: would have roots C, M

How do we declare that block 3's claim to C/M is superior to block 2's claim?
The fact that both were split off of 1: seems like it would be enough to determine that we need special reconciling.

if C, M were split off of 2: then it would be simple.

I thiiink I want to not do HLCs maybe?
block ... ownership ... of ... items. it's a parentId kindof thing.

F's parentId (:2, ts=?, prevParent???)

the thing is, we could be splitting, joiining, movin g==
