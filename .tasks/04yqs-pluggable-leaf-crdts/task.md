So I've developed a new rich-text CRDT in src/block-crdt, and I'd like to integrate it into the core umkehr crdt. However, I think I want the umkehr crdt to be made "pluggable", so a user could bring their own leaf-node crdt, isntead of jsut being stuck with the ones I've included. As part of this work, we should make the current 'rich text leaf node' crdt use this plugin system, instead of being hardcoded.

Things to keep in mind:
- updates to these leaf nodes should be fully type-checked
- no backwards compatability is needed
- plugins (along with their versions) should be included in schema fingerprints. So trying to load a document without the required plugins will fail the schema fingerprint check.
- plugins should be versioned, so we can detect incompatible plugin versions at runtime
