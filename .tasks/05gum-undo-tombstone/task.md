src/block-crdt: currently, both characters and blocks handle deletion be tombstoning (a deleted boolean that flips to true). This means that in order to `undo` a deletion of a character or block (including a 'join' of two blocks), a fresh character or block needs to be created, which loses any concurrent edits to the character or block.
The tombstone approach for characters is based on Peritext's work, and I'm sure they had good reasons for choosing that method, so I want to understand what those are.
The alternative approach that I'd like you to look into is having deleted be an LWW field, so that characters and blocks can be un-deleted, retaining their identity. It would default to being absent entirely.
The goal would be to have better undo behavior in the presence of concurrent edits.
One obvious disadvantage vs the tombstone approach is that it would take up more memory for deleted characters to have a full timestamp, but I'm fine with that.
Besic data shape:
- initial: `deleted: undefined`
- on delete: `deleted: {value: true, ts: HLC}`
- on restore: `deleted: {value: false, ts: HLC}`

It's critical that this change not compromise the CRDT behavior. If this introduces inconsistencies in the application of concurrent edits, or if it would result in surprising behavior to the user, we'll have to shelve it.

Don't worry about backwards compatbility, there are no production users of this library yet.
