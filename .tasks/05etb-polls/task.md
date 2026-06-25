examples/block-rich-text: I'm interested in supporting in-document "polls"
Things like:
- a block where the contents is the 'question', and below that is rendered radio buttons for 1 through 5 (for example).
    - if the current user has 'voted' in the poll, then they can see the percentages of votes, and they can't vote again. (although maybe you could set an option on the poll block metadata to allow people to change their votes)
    - if they have not voted yet, they don't see the results, and can vote
- I can imagine a more complex poll question, where the block has children, and each child is treated as a possible 'answer'. The block could be multiple-choice or single-choice
- and then there's the 'matrix poll' question. it would have two children. the first child would be for organizing the row names (the sub-questions), and the second child would be for organizing the column headers (the possible answers). The sub-questions and answers would themselves be grandschildren of the poll question.
- long-answer could be interesting too

We'll need to introduce the idea of a 'user id' to this. Let's add a text input above each editor pane. Defaults to "Ulrich" on the left and "Uwe" on the right. For this example app, username and user id can be the same (enforce lowercase for simplicity)
