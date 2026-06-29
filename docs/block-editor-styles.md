# Block Editor Styles

Bundled block editor CSS is loaded through static entrypoints:

- `umkehr/block-editor/style.css`: core editor shell, toolbar, block rows, options, generic popovers, retained selection, and shared drag/drop affordances.
- `umkehr/block-editor/legacyRichTextPlugins.css`: core CSS plus bundled plugin CSS in full legacy preset order.
- `umkehr/block-editor/plugins/<plugin>.css`: individual bundled plugin CSS entrypoints.

Bundled plugins also declare `styles` metadata. `registry.styles` is deterministic and documents the
style id, owner plugin, package CSS href, and order. It is not injected by the React editor in this
phase.

Runtime injection can be added later as long as it dedupes by style id, applies registry order,
removes styles when plugin sets change, and avoids SSR/hydration surprises.

Known follow-up: a few selectors still describe interactions between feature surfaces, such as
preview cards inside tables or slides containing headings. Those selectors stay with the feature CSS
that owns the concrete visual class for now and should be revisited during the broader theme/token
cleanup.
