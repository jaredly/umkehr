# Research: Static PeerJS Wordsearch Demo Build

## Goal

Build `examples/react-crdt` as a static site that contains only the PeerJS + Wordsearch demo. The request suggests an alternate Vite config with a different entrypoint, which fits the existing app shape.

## Current Structure

Relevant files:

- `examples/react-crdt/index.html`
- `examples/react-crdt/vite.config.ts`
- `examples/react-crdt/vite.seed.config.ts`
- `examples/react-crdt/package.json`
- `examples/react-crdt/src/main.tsx`
- `examples/react-crdt/src/App.tsx`
- `examples/react-crdt/src/lib/appRegistry.ts`
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsControls.tsx`
- `examples/react-crdt/src/apps/wordsearch/WordsearchApp.tsx`
- `examples/react-crdt/src/style.css`

The normal app entrypoint is `src/main.tsx`, which renders `App`. `App` imports the full registry from `lib/appRegistry`, then chooses app + architecture from URL state. Because the registry imports every demo app and `App` imports every architecture wrapper, the normal bundle is intentionally broad.

`PeerJsApp` is already generic:

```tsx
<PeerJsApp app={wordsearchApp} runtime={wordsearchCrdtRuntime} topBar={topBar} />
```

That means a dedicated entrypoint can bypass `App` and `appRegistry` entirely. It only needs to import:

- `PeerJsApp`
- `wordsearchApp`
- `wordsearchCrdtRuntime`
- global CSS

## Recommended Implementation

Add a PeerJS Wordsearch entrypoint, for example:

- `examples/react-crdt/src/wordsearch-peerjs-main.tsx`
- possibly `examples/react-crdt/wordsearch-peerjs.html`
- `examples/react-crdt/vite.wordsearch-peerjs.config.ts`

The entrypoint would render a small app component that fixes the mode and app selection:

```tsx
import {createRoot} from 'react-dom/client';
import {wordsearchApp, wordsearchCrdtRuntime} from './apps/wordsearch/WordsearchApp';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import './style.css';

function WordsearchPeerJsDemo() {
    return (
        <PeerJsApp
            app={wordsearchApp}
            runtime={wordsearchCrdtRuntime}
            topBar={{
                apps: [{id: wordsearchApp.id, title: wordsearchApp.title}],
                activeAppId: wordsearchApp.id,
                setAppId() {},
                mode: 'peerjs',
                setMode() {},
            }}
        />
    );
}

createRoot(document.getElementById('root')!).render(<WordsearchPeerJsDemo />);
```

The alternate Vite config can use Rollup input to point at a dedicated HTML file:

```ts
import {resolve} from 'node:path';
import {defineConfig} from 'vite';
import UnpluginTypia from '@typia/unplugin/vite';

export default defineConfig({
    plugins: [UnpluginTypia()],
    build: {
        rollupOptions: {
            input: resolve(__dirname, 'wordsearch-peerjs.html'),
        },
    },
});
```

The HTML file would mirror `index.html`, but load `/src/wordsearch-peerjs-main.tsx` and use a more specific title.

Add package scripts, likely:

```json
"build:wordsearch-peerjs": "tsc -p tsconfig.json --noEmit && vite build --configLoader runner --config vite.wordsearch-peerjs.config.ts"
```

If the output needs to be separate from the main app build, set `build.outDir`, for example `dist-wordsearch-peerjs`.

## Important Behavioral Notes

`PeerJsApp` continues to support host/client roles, local IndexedDB document persistence, document import/export, and invite links. The dedicated build would still be a static client bundle, but PeerJS connectivity depends on a PeerJS broker.

PeerJS host/port/path/security are controlled by the existing PeerJS code and test environment variables:

- `VITE_UMKEHR_PEERJS_HOST`
- `VITE_UMKEHR_PEERJS_PORT`
- `VITE_UMKEHR_PEERJS_PATH`
- `VITE_UMKEHR_PEERJS_SECURE`

For a deployed static site, the build or hosting environment needs values that point at a reachable PeerJS server, unless the default public PeerJS behavior is acceptable.

The existing `DemoTopBar` will still render app and architecture selects. With only one app and a no-op `setMode`, the controls are harmless but slightly odd for a single-purpose demo. A more polished dedicated build would either:

- keep `DemoTopBar` for minimal code churn, or
- introduce a small fixed top bar / PeerJS-only top bar so there are no dead selectors.

## Bundle Isolation

The main benefit of a separate entrypoint is import isolation. As long as the new entrypoint does not import `App` or `appRegistry`, the bundle should avoid todo, whiteboard, rich-notes, block-notes, server, local-first, and local simulator code.

Potentially still included:

- generic document archive UI used by PeerJS hosts
- seed document helpers
- artifact serialization helpers
- shared CSS for all demos

Those are imported by `PeerJsApp` today. Further shrinking would require a specialized PeerJS shell or splitting optional document-management features out of `PeerJsApp`.

## Verification Plan

1. Run typecheck/build:

```sh
cd examples/react-crdt
pnpm build:wordsearch-peerjs
```

2. Preview the built static site:

```sh
pnpm exec vite preview --host 127.0.0.1 --port 4173 --outDir dist-wordsearch-peerjs
```

3. Smoke test manually or with Playwright:

- host page loads `Host Wordsearch`
- client role shows waiting state
- invite link includes `peer` and `doc`
- client can connect to host when a PeerJS server is available
- edits/selections in the wordsearch sync between host and client

4. Inspect the built chunks to confirm unrelated demos are absent. A quick check is searching the output for obvious strings like `Todos`, `Whiteboard`, `Rich Notes`, and `Block Notes`.

## Open Questions

1. Should the dedicated build output to normal `dist` or a separate directory such as `dist-wordsearch-peerjs`?

- separate directory

2. Should the single-purpose demo keep the existing top bar, even though app/mode selectors become inert, or should it get a dedicated PeerJS-only chrome?

- no top bar

3. What PeerJS broker should the static deployment use? Options include the public PeerJS cloud defaults, a self-hosted PeerServer, or environment-specific `VITE_UMKEHR_PEERJS_*` values.

- public default

4. Is document management desired in the single-purpose build? Keeping it is easiest, but it brings archive/seed/modal code into the bundle.

- no document management, other than a 'new game' button that blows away the current document and makes a new one

5. Should invite URLs for the dedicated build preserve the current path only, or should they also force any query/hash convention for compatibility with the full demo? In the dedicated build, `mode=peerjs` is unnecessary.

- it just needs to have the peer id

6. Should this be tested by extending the existing PeerJS Playwright specs to run against the alternate config, or is a build-only check enough for now?

- build-only for now
