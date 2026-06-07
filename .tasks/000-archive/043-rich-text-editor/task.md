Let's expand the react-crdt.tsx RichTextEditor into something that can actually exercise the full range od the peritext crdt. Let's break it out into a directory `src/react-rich-text` and:
- have inserts/deletes actally turn into the proper operations
- handle cmd-b/cmd-i
- have a toolbar that shows up when you select some text for formatting
