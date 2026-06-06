# Implementation Log: Block Rich Text UI Example

## 2026-06-06

- Started implementation from `plan.md`.
- Phase 1 in progress: creating a standalone `examples/block-rich-text` Vite example instead of adding another app to `examples/react-crdt`, per the answered research question.
- Noted package-boundary issue: `src/block-crdt` is not a public package export, so the standalone example uses local Vite/TypeScript aliases to import the source module directly.
- Avoided adding `@vitejs/plugin-react`; Vite's built-in TSX handling is enough for this example and keeps the scaffold aligned with the existing `examples/react` app.
- Found and fixed an offset mismatch while wiring split commands: `selPos(state, block, n)` returns the character after `n` visible positions, so splitting at a caret offset uses `selPos(offset + 1)` for the right character and `selPos(offset)` for the previous character.
- DOM selection mapping converts between UTF-16 DOM offsets and grapheme offsets so CRDT commands stay aligned with `Intl.Segmenter` insertion.
- Phase 2/3 in progress: added an in-memory two-replica runtime, CRDT command helpers, and focused command/runtime tests.
- Added `umkehr/block-crdt` aliases to `vitest.config.ts` for the example tests.
- First targeted Vitest run failed because subpath imports such as `umkehr/block-crdt/initialState` were not resolved by the initial alias object. Switched Vite/Vitest config to regex subpath aliases.
- A join test initially appeared to leave the joined-away block visible. Root cause was the test using a fresh timestamp generator per command, so the join's `block:status` timestamp was older than the split-created block status. Updated tests to reuse monotonic command contexts; the UI runtime already uses a per-replica clock.
- `npm run build` in the new example initially failed because this checkout has no local `vite` install for `examples/block-rich-text` or the repo root. Changed the Vite config to export a plain object so an existing Vite binary can load it without resolving `vite` from the config itself.
- Verification passed:
  - `npm exec vitest -- examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/blockCommands.test.ts` passed with 12 tests.
  - `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` passed from `examples/block-rich-text`.
  - `../react-crdt/node_modules/.bin/vite build` passed from `examples/block-rich-text`.
- Workaround: the normal `npm run build` in `examples/block-rich-text` still requires installing that example's local dependencies. In this checkout, Vite is available under `examples/react-crdt/node_modules`, so verification used that binary instead.
- Started the dev server with `../react-crdt/node_modules/.bin/vite --host 127.0.0.1 --port 5174`.
- `curl -I http://127.0.0.1:5174/` returns `200 OK` when run outside the sandbox network namespace. A non-escalated curl could not connect, which appears to be a sandbox networking limitation.
- Attempted a Playwright screenshot using the installed `examples/react-crdt` Playwright binary. It hung after navigation and had to be terminated; browser screenshot verification is inconclusive in this environment.
- After user feedback, stopped browser-level verification and added Testing Library coverage for the rendered editor workflow.
- First RTL run failed because `fireEvent.beforeInput` is not available in this Testing Library version. Switched the test helper to dispatch a real `InputEvent('beforeinput')`.
- RTL paste test found a real sync bug: `pastePlainText` dropped the first inserted line's ops while aggregating split/insert batches, so the peer only received later lines. Fixed paste op aggregation to preserve all batches.
- Dispatching `InputEvent('beforeinput')` still did not reach React's `onBeforeInput` path in jsdom. Added an `onInput` fallback for insertText and switched RTL typing to dispatch `InputEvent('input')`. Browser editing still uses `beforeinput` to prevent default DOM mutation first.
- Testing Library coverage now exercises rendering two editors, typing and online sync, offline queue/flush, Enter split, and newline paste.
- User reported real browser typing duplicated characters in the source editor while the peer editor rendered correctly. Root cause was the jsdom `onInput` fallback also running after browser `beforeinput` had already applied the CRDT insert. Added a per-block guard so `onInput` is skipped immediately after a handled `beforeinput`.
- Added an RTL regression that dispatches both `beforeinput` and `input` for one character and verifies both editors render a single character.
- Verification passed after the duplicate-input fix:
  - `npm exec vitest -- examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/blockCommands.test.ts` passed with 13 tests.
  - `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` passed from `examples/block-rich-text`.
  - `../react-crdt/node_modules/.bin/vite build` passed from `examples/block-rich-text`.
