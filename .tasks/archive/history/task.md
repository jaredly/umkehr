For the examples/react-crdt/lib/server architecture, we currently have a 'history' view at the bottom, which is currently just a debug prototype. Here's what I'd like
- the ability to have different 'branches', reminiscent of git branches. i.e. you can navigate back to a previous point in history, branch off, and start making changes that are independent of the main branch.
- Other users on the main branch would not see those changes reflected in their UI
- after working on a separate branch for a while, you can 'merge it back in' (to the main branch or another arbitrary branch). 
  - This would involve showing a preview of what it would like to have the two branches merged, and give the user the option to 'revert' any changes that they don't like.
  - ("reverting" in this case would actually mean producing a new crdt update with the previous values, similar to the way that undo is implemented)

Things I'm not sure about:
- how to be explicit about what we're merging in from a branch, given that some clients could have pending changes to that branch
- how to efficiently store data such that we don't need a full realized copy for each branch tip
- whether to sync changes to a user for branches that they're not currently viewing. perhaps there can be a notion of 'subscribed branches' or 'local branches' a la git, where there can exist remote branches that I haven't mirrored locally. maybe the user should be kept apprised of the list of remote branches, but not automatically sync changes from them, unless they have mirrored a branch locally.
