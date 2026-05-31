I'd like to make another example. The paradigm that I want to represent is "offline-first, one server, many clients with intermittent connectivity".
Obviously this could work with a CRDT setup. We'll put it in examples/react-crdt/src/lib/server.

The server itself should live in examples/react-crdt-server with its own package.json, and run using bun with bun.serve (bun-plugin-typia should be used), and use a fixed PORT that the clients can rely on connecting to at localhost.
