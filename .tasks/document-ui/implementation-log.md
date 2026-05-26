# Implementation Log

- Started implementation of the document UI top bar.
- Decision: remove hash-based app/mode routing entirely; canonical state will live in search params.
- Added `useUrlSelection`, mode metadata, and the shared top-bar context/component.
- Rewired `App.tsx` to render the new top bar instead of `AppPicker` and `ModeTabs`.
- Removed general URL helpers from `documentArchive`; document URL helpers now live with URL selection.
- Began moving architecture-owned document controls into the shared top bar; removed unused app/mode button components.
- Added a helper to merge branch-free seed documents into local document picker options.
- Removed redundant local seed picker controls now that seed documents appear in the document dropdown. Kept server seeded-client-state controls because they apply a scenario to the selected document.
- Deleted the now-unused `SeedDocumentPicker` component.
- Verification: reran `pnpm build` in `examples/react-crdt`; it passes.
- Verification: reran targeted root Vitest for `useUrlSelection.test.ts` and `server/documents.test.ts`; both pass.
- Started Vite dev server; 5173 was occupied, so this instance is serving at `http://localhost:5174/`.
- Browser verification note: the in-app Browser Node execution tool was not exposed, and a fallback Playwright smoke check hung while opening a page, so I killed that smoke-check process. A direct `curl` to the Vite server returns the app HTML.
- Adjusted top-bar reset behavior to use provider remounting on app/mode changes instead of a parent effect that could race child registrations.
- Final verification after reset fix: `pnpm build` passes in `examples/react-crdt`; targeted root Vitest still passes.
