I've been trying to figure out how to extend peritext to allow for "block editing" a la Notion. Do you have any ideas? Here are the requirements:

- need to support arbitrarily nested blocks
- drag & drop blocks in a tree, reparenting, reordering
  - this should be non-destructive; e.g. concurrend editing of a block and drag & drop should not interfere with each other
- split & join should also be non-destructive; concurrent editing of A and B with joining A and B should work. same idea for split
- don't worry about cycles for now. if a cycle is accidentally created, we can detect it and give the user some UI to recover manually
