Testing findings
- [ ] the merge UI should indicate when a branch has already been merged into the current branch (e.g. merge would have no effect). Also it should prominently display "# of changes that would be brought in" (vs ones that would have no effect, or have already been merged in)
- [ ] 'whiteboard: branches' db merge state doesn't make sense to me. When I view main, I don't see the annotation from the Annotations branch or the second sticky from the Layout branch.
- [ ] whiteboard drag doesn't preventDefault so the browser does selection stuff
- [ ] whiteboard perf: every noteview updates while dragging one
- [ ] todo perf: every todo updates when updating a todo
