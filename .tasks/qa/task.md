
Solo: '2000 updates' and 'array operations' documents don't keep the history (because they're created in a CRDT context) so the seed documents aren't nearly as useful. Can we change the way generate.ts works to support the non-crdt history as well as the crdt one?
Local:
- the modal doesn't do anything? creating a seed doesn't do anything, creating a new document doesn't do anything.

Server migration UI feedback:
- don't use an alert for "please migrate". It should be a button in the place that currently says "Document migration required."
- "Update your app to sync with the server. Local edits will stay pending." should be so much louder. right now it's super easy to miss. It should have like an orange background with a 🚨 emoji next to it
