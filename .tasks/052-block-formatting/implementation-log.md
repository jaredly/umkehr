# Block CRDT formatting implementation log

## Progress

- Started implementation from `plan.md`.
- Phase 1: added `JsonValue`, mark, boundary, and split-record types; extended block CRDT state
  with `marks` and `splits`; initialized both in `initialState`.
- Phase 2: changed inserted char parent timestamps to blank strings so populated string
  char-to-char parents can identify join-style moves. Existing `charOp` API kept its timestamp
  argument for compatibility.
- Phase 3: added idempotent `mark` and `split-record` op application.
- Phase 4: changed `split(...)` to accept an explicit previous character and emit split records
  using the new block ID.
- Phase 5/6: added initial traversal helpers, mark creation helpers, and non-incremental formatted
  block materialization.
- Phase 7: added `src/block-crdt/formatting.test.ts` with focused formatting, split traversal,
  join-style parent, and split-tail tests.
- Phase 8: added a bounded formatting property test that checks formatted text preserves visible
  block text across generated marked/split documents.
- Added follow-up coverage for mark/split and mark/join convergence, explicit crossed-split marks,
  deleted anchor chars, archived block omission, and same-type mark override behavior.
- Verification:
  - `npm exec vitest run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` passed
    with 46 tests.
  - `npm run typecheck` passed.
  - `git diff --check` passed.
  - `npm exec vitest run` failed in existing React example tests with invalid hook call errors in
    `examples/react-crdt`; block-crdt tests passed in the targeted run.

## Issues / workarounds / bugs

- `charOp(text, id, after, ts)` currently ignores `ts` for inserted parent provenance. This is
  intentional for formatting, but the parameter remains to avoid widening call-site churn.
- While adding join-style traversal coverage, the followed-split path needed to avoid appending the
  split `right` char twice when a join had already moved that char under the split `left` tail.
- The second-split tail-scan test initially used the visible previous char helper, which selected
  `Y`; the scenario required the logical split-left char `c`. This validates why `split(...)` now
  accepts `previous` explicitly.
- `markRange(...)` remains a block-offset helper. Cross-block/cross-split tests currently use
  explicit `markOp(...)` anchors plus `crossedSplits`; a higher-level cross-block selection helper
  is still future work.
