
04
- the final rendered order card shows 'red dog' in char-blocks, but not `the`. Although I think maybe the char blocks are extraneous at that point

05
- let's actually switch the actions of replica A and B. As written, it looks like the timestamp of replica A would be earlier, and thereby lose the LWW, but we say that A is later. So let's have A move dog, and be move 'red dog'
