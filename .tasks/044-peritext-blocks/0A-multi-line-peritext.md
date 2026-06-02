New idea.

we have runs of text
each one, living in its own little cloud
with its own id
and its own provenance or whatever
joining introduces continuation jumps
splitting ... what does splitting do
introduces a split?
so like the next one is just like virtual or something

A: h e l l o _ m y _ f r i e n d s
split before m
A: h e l l o _ [SPLIT B] m y _ f r i e n d s
B-virtual: -> A

paragraph IDs are lamport clocks, globally unique

Basic idea:
we expect much more 'contiguous paragraphs' than we expect splits & joins. So splits & joins can a bit more expensive/complex, if it allows normal paragraphs to be tight.

Then we have the 'block tree' layer, which does parentId + fractional ordering.

A join is metadata on the paragraph.

```ts
type Paragraph = {
    id: string;
    chars: RichTextCharMeta[];
    pending?: RichTextOperation[];
    join?: string;
}
````

Questions:
can you tombstone a split? I think you probably should not be able to. Because then what happens to a join that's pointing to the virtual block?
Yeah splits are forever, but can be 'reversed' by a join.
joins are also forever. split/join/split/join keeps adding new blocks.
Also splits can't have marks
