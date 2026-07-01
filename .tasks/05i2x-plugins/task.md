src/block-editor: Let's make a plugin system for the block editor, and break out the various specialized blocks & marks into their individual plugins.
Plugins I can think of:
- basic-marks (bold/italic/strikethrough/underline)
- links
- headings
- lists (bullet/number)
- todos
- quote
- callouts
- code
- code/vega
- code/mermaid
- ingredients
- table
- columns
- slides
- link preview
- polls
- footnotes
- popovers
- comments

Some things we'll need to do:
- have 'footer' and 'sidebar' destinations for plugins to potentially render things (footnotes and comments)
- allow plugins to have sub-plugins (for code & code/vega)
