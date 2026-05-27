
Solo: '2000 updates' and 'array operations' documents don't keep the history (because they're created in a CRDT context) so the seed documents aren't nearly as useful. Can we change the way generate.ts works to support the non-crdt history as well as the crdt one?
Local:
- the modal doesn't do anything? creating a seed doesn't do anything, creating a new document doesn't do anything.
