
Next things to tackle:
- [x] peerjs for react-crdt example
- [x] the react-crdt example, lots can be generic, can we put it in like src/lib?
- [x] I would love to have a shared whiteboard or something as a richer example
- [x] what would it look like if we wanted something like src/react, but for remix3? How much impl could we re-use?
- [x] let's look into jumping around history with react-crdt. What would be required to enable it?
  - and like branches and such. what do we need to be able to do. do we need to change our CRDTUpdate to have an incrementing counter?

- [x] peerjs example, how can we add vector index stuff, where each peer has its own persisted document and stuff. history compaction, for example.

- [ ] seed E2E dbs for all architectures


- [ ] seed db that's behind the client
  - [ ] w/ empty client
  - [ ] w/ client having the old db "loaded into local memory"
- [ ] seed db that's ahead of the client
- [ ] what happens if the local indexeddb has a db that the server doesn't have? Do we automatically replicate? Probably should prompt the user first

Testing findings
- [x] the merge UI should indicate when a branch has already been merged into the current branch (e.g. merge would have no effect). Also "# of changes that would be brought in"
- [x] whiteboard merge state doesn't make sense to me. How did merging "layout" manage to loose the extra sticky note?
- [x] whiteboard drag doesn't preventDefault so the browser does selection stuff
- [x] whiteboard perf: every noteview updates while dragging one
- [x] todo perf: every todo updates when updating a todo

- [x] WhiteboardPanel is gigantic, needs much better

NEEDS TO TEST:
- migration definiteily
