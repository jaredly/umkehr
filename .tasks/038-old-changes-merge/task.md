For near-realtime changes, CRDT automatic merging is great. However, for 'out of time' changes, where a user has been making a lot of offline changes and they sync all at once, users might well want to be more careful about the merge.
Here's the behavior I want, for the examples/react-crdt in the 'server' architecture:
- if a user reconnects to the server
- and the user has pending changes, the earliest of which is more than 5 minutes ago
- and the server has had new changes as well
then we don't automatically sync. we give the user a '3 way merge' view, where they can see
| current client state | current server state | merge result |
and they can go through and make modifications to the merge result (which just queues up more pending updates).
Once they're satisfied, they can click "complete merge".
They also have the option of saying "actually create a new branch, forked off of the 'last server state I had seen'", so they can handle the merge later.
They also have the option of discarding all local edits.
