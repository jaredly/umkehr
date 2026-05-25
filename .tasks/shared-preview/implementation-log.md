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
