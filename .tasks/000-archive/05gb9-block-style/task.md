examples/block-rich-text: give our blocks some style! in addition to metadata, every block should have a style object, with independently updatable (LWW) attributes.

Let's have it be defined as `Record<string, {value: JsonValue, ts: string}>` in our src/block-crdt, and then block-rich-text should have initial support for `background-color`, `font-size` and `color`.
