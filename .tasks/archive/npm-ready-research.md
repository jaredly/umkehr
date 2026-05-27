# Initial Release Cleanup Research

This project is close to a usable first release: it has a clear core idea, typed public APIs, a README with real examples, generated declarations, and passing tests. The main release work is tightening the package boundary, making the supported API explicit, and turning the existing ad hoc validation into repeatable release checks.

## Current State

- Package: TypeScript ESM package named `umkehr`, currently at `0.0.0`.
- Public entry points in `package.json`: `.`, `./core`, `./history`, and `./react`.
- Main features: typed proxy-based patch builders, draft-to-realized patch application, undo/redo history, branch jumping, and optional React contexts/hooks.
- Validation observed on 2026-05-14:
    - `pnpm run typecheck` passes.
    - `pnpm run build` passes.
    - `bun test` passes with 11 tests across 3 files.

## Release Blockers

1. Add a committed test script.

    Tests use `bun:test`, but `package.json` only exposes `build` and `typecheck`. Initial release should add a `test` script, probably `"test": "bun test"`, and document Bun as the test runner. If Bun is the expected development runtime, add it to the README prerequisites. If not, migrate tests to a package-managed runner such as Vitest.

Done

2. Clean generated package output before publishing.

    `dist/` currently contains both top-level compiled files like `dist/index.js` and duplicated files under `dist/src/...`. The top-level files match the configured exports, while `dist/src/...` appears stale or accidental. Add a clean step before build, for example `rm -rf dist && tsc -p tsconfig.json`, and verify `npm pack --dry-run` contains only the intended files.

Done

3. Decide whether React is truly optional.

    `react` is an optional peer dependency, but the root entry point exports React APIs from `src/index.ts`. That means importing `umkehr` may require React even for core-only users, depending on consumer tooling and runtime behavior. For a clean package boundary, either:
    - Keep React optional and remove React exports from the root entry point, forcing `umkehr/react` for React users.
    - Or make React a required peer dependency and state that the root package includes React bindings.

Done

4. Remove internal debug output and casual error text from release builds.

    There are `console.log` calls and prototype-era messages in runtime code, including `internal.ts`, `make.ts`, `history.ts`, and `react.tsx`. These should be replaced with deterministic errors that include enough path/context for debugging without printing user state. Search terms that currently find release-facing cleanup: `console.log`, `cant`, `weird`, `got a got`, `not supporting`.

Can you do this one?

5. Clarify unsupported operations before exposing patch types.

    `CopyOp` is part of the exported `Patch`/`DraftPatch` union, but `copy` throws in `ops.apply`, `ops.invert`, and `rebase`. Either implement `copy` completely or remove it from public types until supported. Otherwise consumers can construct valid-looking operations that fail at runtime.

Done

## Test Coverage Notes

Existing coverage is useful but narrow. It currently covers:

- Path and extra extraction from proxy builders.
- Array and object `$move`.
- Array `$reorder` and inversion.
- Basic tagged-union `$variant`.
- `_replace` shallow/deep behavior.
- History dispatch, undo/redo, and branch jump.

Recommended pre-release additions:

- Core operation coverage for `add`, `replace`, `remove`, `push`, `move`, and `reorder`, including root-level replacement and failed precondition cases.
- Immutability tests proving unchanged branches preserve identity while changed branches are cloned.
- Nested `$update` tests, including multiple nested operations and failure behavior.
- Tagged-union negative tests for wrong tag and missing discriminant.
- History tests for branching after undo, invalid jump IDs, redo invalidation after a new change, deterministic ID injection, and `clearHistory` if it remains public through React context.
- React tests for `createStateContext`, `createHistoryContext`, `useValue`, preview updates, path-scoped subscriptions, undo/redo hooks, and cleanup/unsubscribe behavior.
- Type-level tests using `tsd`, `expect-type`, or a local `*.test-d.ts` setup. The type API is one of the library's main selling points, so release confidence should include compile-time assertions for path navigation, array operations, optional properties, records, and tagged unions.
- Package smoke tests against the built artifact: import `umkehr`, `umkehr/core`, `umkehr/history`, and `umkehr/react` from `dist` or an `npm pack` tarball.

## Documentation Notes

The README already explains the core mental model well. Before release, it should become more consumer-facing:

- Replace local import examples like `import {createPatchBuilder} from './umkehr/core'` with published package imports such as `import {createPatchBuilder} from 'umkehr/core'`.
  -> sounds good; note that the /core import is no longer public; just import from 'umkehr'
- Add an installation section with package manager commands.
  -> let's provide for npm, pnpm, and bun
- Add a quick-start example that starts with plain state and ends with `resolveAndApply`.
  -> love it
- Add a React quick-start that shows provider setup with `blankHistory(initialState)`, since the provider expects an initial `History<T, An>` rather than a raw state value.
  -> sounds good, but let's avoid making it overly long. save that for the examples folder
- Document the package entry points and intended import style:
    - `umkehr/react` for usage with react
    - `umkehr` for other use
- Add a "Supported data model" section: plain JSON-like objects/arrays, structured paths, no JSON Pointer strings, no CRDT semantics, equality behavior, and what happens with `undefined`.
  -> love this
- Add a "Limitations" section covering unsupported `copy`, preview semantics, array index behavior, and whether operations are safe to persist across schema changes.
  -> yup
- Add API reference tables for builder methods: call shorthand, `$replace`, `$update`, `$add`, `$remove`, `$push`, `$move`, `$reorder`, and `$variant`.
  -> sounds great

## Examples To Add

Good initial examples would be small and runnable:

- `examples/basic`: build draft patches, apply them, inspect realized changes, invert changes.
- `examples/history`: create history, dispatch changes, undo/redo, branch with `jump`.
- `examples/react`: minimal React app with `createHistoryContext`, `useValue`, preview update, undo, and redo.
- `examples/tagged-union`: demonstrate `$variant` with both direct and callback forms.

Each example should import from the package entry points, not from `src`, so it doubles as a packaging smoke test.

## API Clarity Notes

- `createPatchBuilder<T, Extra, Tag>(tag, extra)` requires `extra` even for non-React/core usage. Consider making `extra` optional or adding an overload/default so the common call is `createPatchBuilder<State>()` or `createPatchBuilder<State>('type')`.
  -> decision: rename createPatchBuilder to createPatchBuilderWithExtra, and export a simpler createPatcherBuilder that has Extra=undefined
- `ApplyTiming` includes `'immediate' | 'preview' | undefined`, but runtime code treats only `'preview'` specially. Consider removing `'immediate'`, documenting it as an alias for the default, or using it explicitly.
  -> 'immediate' was speculative as an alternative to the default "batched" behavior, but I'm not sure it's necessary. let's remove for now
- The name `Extra` is exported from the React module but is really React context plumbing for path reads/listeners. Consider a more specific name before freezing the API.
  -> I'm open to suggestions. In non-react contexts I can imagine it being used for other things. maybe "Context" would be the more common term?
- `History` and `Annotations` are useful public types, but `dispatch` has several generic parameters and requires `extra`, `tag`, and `equal`. Consider a small documented wrapper or clearer examples for non-React users.
  -> we could do the typescript function overloading thing, and have a simpler overload that looks like `<T, An>(state,nested,equal=fastDeepEqual,genId=randId) =>`
- `PathSegment` supports `{type: 'tag'}` segments, which are not standard JSON Patch paths. This is fine, but it should be called out wherever patch persistence/interchange is discussed.
  -> yeah let's document that we're inspired by, but not compatible with, json patches.
- Root exports currently mix core, history, and React. Before release, decide whether the root module is a convenience kitchen-sink import or a stable minimal API.
  -> I've separated out react & slimmed down the index to import a more minimal public api

## Packaging And Metadata

- Add `test`, `clean`, `prepack`, and possibly `pack:check` scripts.
- Run and document `npm pack --dry-run` before publishing.
- Consider adding `engines` or tested runtime notes for Node/Bun.
- Consider adding `publishConfig.access` if this will publish publicly.
- Add `CHANGELOG.md` or release notes before the first nonzero version.
- Consider adding CI that runs install, typecheck, build, tests, and package smoke tests.
- Confirm `files` should include `tsconfig.json`. Most consumers do not need it unless it is intentionally part of the package.
- Check whether source maps should be published. They are useful for debugging, but if they point to unpublished source paths, either include `src` intentionally or omit maps.

## Suggested Release Checklist

1. Decide package boundaries, especially root vs React exports.
2. Implement or remove public `copy` support.
3. Add test/clean/prepack scripts and package smoke tests.
4. Clean `dist/` and verify the tarball contents.
5. Remove debug logging and polish runtime errors.
6. Expand tests around core operations, history edge cases, React behavior, and type inference.
7. Update README imports, install docs, limitations, and API tables.
8. Add at least one runnable core example and one runnable React example.
9. Add CI for typecheck, build, tests, and pack verification.
10. Publish the first version only after `npm pack --dry-run` matches the intended public surface.
