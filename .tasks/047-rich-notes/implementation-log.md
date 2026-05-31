# Rich notes implementation log

## Progress

- Started implementation under the existing `examples/react-crdt` harness, per the answered plan questions.
- Chose to build the rich-text editor binding in the app panel from `useValue` and rich-text patch dispatches so the app can work in solo/history as well as CRDT sync modes.
- Added the `rich-notes` app model, schema, providers, app definition, panel, sidebar helpers, registration, and scoped CSS.
- Added `materializeRichTextValue` to the public rich-text entrypoint so the example can derive sidebar titles from rich-text values without importing internal Peritext modules.
- Updated the React CRDT and root examples README files to mention the rich-text notes app.
