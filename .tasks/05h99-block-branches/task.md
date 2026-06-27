For the umkehr 'json crdt', we have this whole system of branches, and 'manual merging changes that are more than 5 minutes out of sync with your replica' (see examples/react-crdt in the server mode).
I would like similar machinery to be available to folks using the block-crdt (rich text blocks), outside of the context of the json crdt.
I'd think this would involve generalizing the branches machinery so that it could fit with either the json crdt or the block crdt.
