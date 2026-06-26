examples/block-rich-text: I want inline math rendering! A couple of ways I could imagine doing this:
- use mathquill somehow
- have a mark maybe that turns `$2 + \pi$` dollar-delimited math text into mathjax rendered math? We don't have any marks that dramatically change the rendering/parsing/selection behavior of text, so this would be new.
- use an inline embed, where you have to click and it shows a popover with the latex source to edit
- use an inline embed, where you click and it changes the rendering inline to the latex source for you to edit. Unfocusing the embed would switch it back to rendering mode
- ...build another crdt that's tuned to the structure of math equations? lol

Things that are important to me:
- collaborative editing still needs strong support. So two people can change the same equation at the same time, and changes merge in the same way as the core crdt.
- ideally, splitting a block in the middle of a math equation should work; so the new block gets the second half of the math equation. join should also work. However, if these constraints aren't satisfiable, it'll be ok.
