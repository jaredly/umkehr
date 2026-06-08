There's a logic bug where joining a block in one editor while adding text to the start of that block in the other editor causes the "added text" to be lost.
The rest of the text gets re-parented onto the preceeding block, but the text added in the other editor stays associated with the now-archived block.
