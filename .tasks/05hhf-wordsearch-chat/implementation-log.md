# Implementation Log: Wordsearch PeerJS Ephemeral Chat

## 2026-06-27

- Started implementation from `plan.md`.
- Confirmed existing wordsearch tests are Vitest helper tests and component tests elsewhere use Testing Library with `src/react/test-dom`.
- Confirmed `.tasks/future.md` has unrelated pre-existing changes; leaving it untouched.
- Phase 1 complete: added wordsearch chat ephemeral type, helper builder, chat path/kind constants, 280-character limit, and validator support.
- Phase 2/3 complete: added a PeerJS-only `WordsearchChat` component with local echo, current-page-session React state, unique message ids, deterministic animal display names by actor id hash, and disabled composer support.
- Phase 4 complete: added compact chat styling and responsive sizing.
- Workaround: the existing dedicated mobile wordsearch PeerJS layout used `overflow: hidden` and two explicit grid rows. With chat below the board as a third sibling, that could clip the chat, so the mobile route now uses scrollable overflow and a third grid row.
- Issue caught during CSS review: a leftover `min-height: 0` would have overridden the new mobile viewport min-height; removed it before testing.
- Phase 5 complete: added focused model validator tests and `WordsearchChat` helper tests for remote rendering order, local-actor filtering, non-chat filtering, and deterministic animal names.
- Issue: hook-based component tests failed with the same duplicate-React invalid-hook-call error seen in existing hook-based tests such as `TodoItem.test.tsx`. Workaround: moved chat merge/name behavior into pure exported helpers and replaced the rendering test with pure helper tests. The model tests were already passing.
- Build issue: widening `WordsearchEphemeralData` exposed an existing assumption in `WordsearchPanel` that every remote ephemeral record was a selection. Fixed by narrowing to `type === 'selection'` before reading selection cells.
- Verification: `npm exec vitest -- run src/apps/wordsearch/model.test.ts src/apps/wordsearch/WordsearchChat.test.ts src/apps/wordsearch/wordsearch.test.ts` passed with 15 tests.
- Verification: `npm run build:wordsearch-peerjs` passed, including TypeScript and Vite production build.
- Manual/browser verification: started Vite at `http://127.0.0.1:5174/` and confirmed `http://127.0.0.1:5174/wordsearch-peerjs.html` returns HTTP 200. Playwright screenshot attempts hung in this environment and were stopped; no screenshot-based visual verification completed.
- Follow-up: adding local system messages for peer lifecycle events. The chat will show deterministic animal names for first join plus `[connected]` and `[disconnected]` messages derived from `sync.connectionsStore`.
- Added helper tests for first-seen join/connected messages and disconnected messages for closed or removed peer connections.
- Verification after follow-up: targeted wordsearch tests passed with 17 tests, and `npm run build:wordsearch-peerjs` passed.
- Follow-up: added the local player's deterministic animal nickname as a compact chip to the left of the chat input.
- Verification after nickname chip: targeted wordsearch tests passed with 17 tests, and `npm run build:wordsearch-peerjs` passed.
- Issue: populated chat caused whole-screen vertical scrolling on mobile. Updated the mobile PeerJS route to use a fixed viewport grid with hidden page overflow, a smaller viewport-based board cap, and a shorter internally scrolling chat log.
- Verification after mobile scroll fix: targeted wordsearch tests passed with 17 tests, and `npm run build:wordsearch-peerjs` passed.
- Issue: host connection count and chat disconnect messages could miss closed tabs because UI state relied on `DataConnection.open` and counted all connection records, including closed records. Added an explicit `open` bit to PeerJS connection records, mark it false on close/manual disconnect, and changed the control bar to count only open connections.
- Verification after disconnect/count fix: targeted peer/wordsearch tests passed with 21 tests, and `npm run build:wordsearch-peerjs` passed.
- Follow-up: confirmed PeerJS exposes `DataConnection` `iceStateChanged` in addition to `close`. Added an `iceStateChanged` listener so ICE `disconnected`, `failed`, and `closed` mark the connection closed for the UI, while `connected`/`completed` can mark it open again if the same connection recovers.
- Verification after ICE-state listener: targeted peer/wordsearch tests passed with 21 tests, and `npm run build:wordsearch-peerjs` passed.
