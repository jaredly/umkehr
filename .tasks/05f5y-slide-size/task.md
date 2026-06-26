examples/block-rich-text: so we've got this really cool feature where you can have a block that's a slide deck. We do need to do some thinking about how to maintain size/scale between 'preview' and 'full-screen presentation' modes, though.
Currently, we don't do any adjusting, so the size of a header, for example, looks very large in preview mode, and very small in full-screen mode.

The basic idea is that the slide's rectangle has a "logical size" that matches with width/height as defined by the slide deck's metadata, but the slide gets scaled down to fit inside a normal block, or up to fit the available fullscreen real estate as needed.
