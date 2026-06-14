Can we try to do a little:





realization comes from walking the tree
also, like let's do smark cache updates





In a fight between:
"reparent for a split from ts X (new ts Y)"
"reparent for a split from ts X (new ts Z)"
we ignore new ts, and instead compare ancestry.
if "from ts X" differs, we use that.
if ancestry is the same, we use "new ts"

In a fight between:
"char" vs "block", it's the block's ts vs the char's 'from ts'


IF it's not for a split, but rather for an internal move, then we do normal ts resolution probably.
yeahhh I think that's right.
SO
now let's make it an easy lexical comparison.

[parent ts, parent ancestry path, new ts]

block:

[block ts]

creation:

[creation ts]

AND: the "from ts" is the "char's toplevel ts" before it was moved.
I think that does the trick?

Ancestry path comparison ... might be like a 'lower wins' instead of a 'higher wins'???? yes because 'lower means later' which is what we want to privilege.



big news question:
if I am going to ... insert text at the start of a block
wait what if I just have an empty-string char be the child of the block.
that is to say, the block gets a 'char id' lamport number.
and then insertion is normal

yeah I like that.
