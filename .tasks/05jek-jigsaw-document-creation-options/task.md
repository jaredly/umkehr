Our jigsaw puzzle in examples/react-crdt should have 'document creation options'. The simplest one is "number of pieces" (see .tasks/05if0-jigsaw/task.md).
This is a new thing for the react-crdt app; the other examples don't have any kind of document initialization params. This needs two changes:
1. in the document management modal, the 'new document' form should include fields for any init params needed
2. when loading the page without a current document, existing behavior is to create one. If the document has required params, we should insteade show the document management modal.
