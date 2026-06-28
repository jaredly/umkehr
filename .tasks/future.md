
- refactor block-rich-text so that
    - the 'single block editor' can be used indpendently as like a Peritext+ editor
    - the full editor can be used, with a variety of plugins adding block types
        - so the very basic editor doesn't have any marks or any paragraphs other than block
        - but then there's like a 'batteries included' one or something
- make everything a monorepo with packages by pnpm
- make a 'block doc with embeds' example. this would have the doc be at the second level of a json object, with a peer being like word searches etc. And you could embed a word search.
- could do the jigsaw puzzle too

- make the peerjs wordsearch exportable independently.
- yayyy
- the playable wordsearch ... needs realtime chat probably. ephemeral tho



jiiiigsaaaaawpuuuuuzle
so there's kindof a lot of options here
but the most basic is squares
and the next one is voronoi shapes around poisson points

and then we can get the mechanics actually going

and then we could do smaller shapes that glom together


- look at examples/block-rich-text. Are there ways we should change block-crdt to make the editor implementation simpler/more straightforward? Are there any utilities that should be moved into (or out of) the library?
- let's make `row header` editing less different. I don't think it needs a separate editor component.
- can we make annotation block editing less different? Does it really need a separate editor component?
- rows as subtables?
- in children of cards, the content can grow to render over the handle. this is bad.
- drop targets should be handled holistically, not ad-hoc maybe.

- table of contents
- transclusions
- columns
- link to headers (or arbitary blocks)
    - what if you "block copy" and then "selection paste" it does a link?
- link decorations indicating [local] [on-site] [off-site]
- [on-site/off-site] link preview cards
