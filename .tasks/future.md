
- look at examples/block-rich-text. Are there ways we should change block-crdt to make the editor implementation simpler/more straightforward? Are there any utilities that should be moved into (or out of) the library?
- let's make `row header` editing less different. I don't think it needs a separate editor component.
- can we make annotation block editing less different? Does it really need a separate editor component?
- rows as subtables?
- in children of cards, the content can grow to render over the handle. this is bad.
- drop targets should be handled holistically, not ad-hoc maybe.
