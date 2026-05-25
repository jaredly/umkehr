# Shared Preview Implementation Log

- Started Phase 1.
- Added `EphemeralMessage<Data>` plus `EphemeralStore` types and `createEphemeralStore` in `src/ephemeral.ts`.
- Extended `SyncedTransport` with required `publishEphemeral` and `subscribeEphemeral` methods.
- Added explicit drop/no-op ephemeral methods to existing test, local simulator, server, PeerJS, and local-first transports.
- Exported ephemeral types/store from `umkehr` and `umkehr/react-crdt`.
- Added focused store tests for replace, clear, actor/path/kind queries, stale state after 15s, stale sweep notifications, removal after 30s, expiry sweep notifications, and `expiresAt`.
- Verified with `npx vitest run src/ephemeral.test.ts`, `npm run typecheck`, and `npm test`.
- Re-verified after making transport ephemeral methods required with `npx vitest run src/ephemeral.test.ts src/react-crdt/react-crdt.test.tsx`, `npm run typecheck`, and `npm test`.
- `npm run typecheck:examples` still fails on pre-existing example issues in `examples/react-crdt/src/lib/seed/generate.test.ts` and Vite plugin type mismatches; the new server placeholder implicit-any errors were fixed.
- Started Phase 2.
- Added `EphemeralConfig<Data>` and bound the ephemeral payload type to `createSyncedContext<T, Tag, EphemeralData>` rather than method-level generics.
- Added fixed-type `ctx.publishEphemeral(messages)` and `ctx.useEphemeral(query)` helpers.
- Added per-provider `EphemeralStore`, inbound `transport.subscribeEphemeral` handling, receive-side data validation, local-actor echo suppression, and optional max-message-byte enforcement.
- Added React tests for publishing, validated remote receipt, ignored invalid/local echo messages, and path-scoped rerender behavior.
- Added `type-tests/ephemeral-context.ts` to assert a context cannot publish a different ephemeral payload type and default contexts cannot publish ephemeral data.
- Verified Phase 2 with `npx vitest run src/ephemeral.test.ts src/react-crdt/react-crdt.test.tsx`, `npm run typecheck`, `npm run typecheck:tests`, and `npm test`.
- Rechecked `npm run typecheck:examples`; it still fails only on the known unrelated `CrdtUpdate.path` seed test and Vite plugin type mismatches.
