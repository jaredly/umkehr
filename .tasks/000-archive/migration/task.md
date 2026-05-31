I want to get serious about schema migrations.
Currently the stance is "if any change to the schema happens, you need a whole new document", which is certainly better than not verifying schema version, but leaves a lot to be desired. There are many kinds of changes to a schema that ought to be backwards-compatible (deleting a field, moving a value in certain circumstances, adding an optional field, adding a required field with a known default value), and it would be great for us to formally support migrations, not only for the relized state, but also for the change history.

Here's what I have in mind:
- first of all, we shouldn't make this machinery /required/. For prototyping etc. we want to make things as simple as possible
- an app would have a file that contains the json schema data strcutures for their current state type, and for all previous versions of the state type. it would also have functions for converting StateV1 to StateV2, as well as CRDTUpdateV1 to CRDTUpdateV2 and PatchV1 to PatchV2 etc. We have existing infrastructure for validating that a given CRDTUpdate conforms to a state's json schema, as well as validating a State object.
- then, on startup when we're checking the schemaFingerprint of stored data, if it's not the latest version, we can perform the migration on both the realized state and all prior updates.
- if a client tries to connect to a server with a mismatched schemaFingerprint, we reject the connection and show a message to the user that they need to update their app in order to connect
- btw we should probably be hashing the schemaFingerprint and comparing that, (sha256 or similar) to save on bandwidth
- to be extra confident in our processes, the migration infratsructure should:
  - migrate all crdtupdates
  - migrate the base & realized state
  - replay the migrated crdtupdates against the base and verify that the result matches the migrated realized state

We should ensure that our migration api works for local (non-crdt), local-first&peerjs, as well as server architecture (see examples/react-crdt/src/lib).
