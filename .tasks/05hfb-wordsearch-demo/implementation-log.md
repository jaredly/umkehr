# Implementation Log: Static PeerJS Wordsearch Demo

## Progress

- Started from `research.md` and `plan.md`, including the inline decisions.
- Confirmed existing worktree has unrelated edits in Wordsearch styling, `PeerJsApp.tsx`, and PeerJS tests. I am preserving those and building on top where needed.
- Added the dedicated Wordsearch PeerJS shell at `examples/react-crdt/src/apps/wordsearch/WordsearchPeerJsDemo.tsx`.
- Added the static build entry files: `src/wordsearch-peerjs-main.tsx`, `wordsearch-peerjs.html`, and `vite.wordsearch-peerjs.config.ts`.
- Added `pnpm build:wordsearch-peerjs`, outputting to `dist-wordsearch-peerjs`.
- Added focused layout styles for the top-bar-less Wordsearch PeerJS page.
- Added a brief README note for the standalone build command and output directory.
- Verified `pnpm build:wordsearch-peerjs` succeeds. Reran after final cleanup.
- Ran the optional output string check for unrelated demo names; `rg "Todos|Whiteboard|Rich Notes|Block Notes" dist-wordsearch-peerjs` returned no matches. Reran after final cleanup.
- Added `/dist-wordsearch-peerjs/` to `examples/react-crdt/.gitignore` so the generated static build does not appear as source changes.
- Simplified the standalone PeerJS controls into a horizontal top bar. The compact variant hides the full local peer id and uses a traffic-light status dot with a short label.
- Reverified `pnpm build:wordsearch-peerjs` after the top-bar control changes.
- Rechecked the built output for unrelated demo titles after the top-bar changes; no matches.

## Issues / Notes

- `New game` needs to affect already-connected clients, not just the next client connection. The current `usePeerJsSync` only sends snapshots on connection open and ignores later snapshot messages once a client already has a snapshot. I am adding a narrow snapshot broadcast path for this demo.
- The shell currently keeps the document in memory only. Refreshing the host creates a fresh game; this matches the plan's preferred non-persistent option.
- First `pnpm build:wordsearch-peerjs` attempt passed the TypeScript step but failed loading the Vite config because `__dirname` is undefined with `--configLoader runner`. Fixed the config to derive the HTML path from `import.meta.url`.
- The shell prints `Error connecting to agent: Operation not permitted` before local commands in this environment, but the build and `rg` verification still completed normally.
