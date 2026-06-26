examples/block-rich-text: What would it take to have a 'slide deck block type'?

I'm thinking:
- direct children are individual slides.
- text content of the 'slides' are the slide titles
- children of the 'slides' make up the text content of the slide, visually centered on the screen.
- each slide should be able to have config (so 'slide' should be a block type as well), including
    - whether to show or hide the title
    - the slide background color
    - transition animation
- the 'slide deck block' should probably declare the aspect ratio & resolution of the deck
- the text content of the slide deck block is rendered as a 'title of the deck'. possibly rendered as a footer of each slide, if configured to do so (along with 1/N slide numbering)

The slide deck block should have ui-only state to switch display modes between
- presentation mode (only one slide shown at a time)
- overview mode (all slides rendered in a column)
- outline mode (all slide rendered as paragraph blocks with children, same as a normal document)
