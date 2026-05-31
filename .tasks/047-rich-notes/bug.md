# Rich text editor drops characters during sequential input

## Summary

Sequential typing into `RichTextEditor` can lose characters when the editor is wired to real rich-text CRDT state. The rich notes app exposed this immediately: typing `hello` into an empty note often leaves the editor with `hel`, while intermediate derived state can show inconsistent ordering such as `hlo`.

This is not just a Playwright/browser-only issue. A Testing Library integration repro against `createSyncedContext` + `RichTextEditor` also fails with the same character-loss class of bug.

## User-visible behavior

In `examples/react-crdt`, open the Rich Notes app in local simulator mode and type `hello` into Replica A's note editor.

Expected:

- Replica A editor shows `hello`.
- Replica A sidebar title becomes `hello`.
- Replica B receives the synced rich-text operations and also shows `hello`.

Actual:

- Replica A editor can end at `hel`.
- In the Playwright run, the textbox aria label was `Body for hlo`, showing a different transient/materialized ordering from the visible DOM text.
- Replica B never reaches the expected `hello` state because the source document is already wrong.

## Repros

### Playwright repro

File:

- `examples/react-crdt/tests/smoke/rich-notes-local.spec.ts`

Command:

```sh
pnpm --dir examples/react-crdt exec playwright test -c playwright.config.ts tests/smoke/rich-notes-local.spec.ts
```

Current failure:

```text
Expected substring: "hello"
Received string: "hel"
Locator: .richNotesPanel.leftPanel .richNotesEditor [contenteditable]
```

The failure context also reported:

```text
aria-label="Body for hlo"
contenteditable text="hel"
```

### Testing Library repro

File:

- `src/react-crdt/react-crdt.test.tsx`

Test:

```text
handles sequential rich text keyboard insertion
```

Command:

```sh
pnpm exec vitest run src/react-crdt/react-crdt.test.tsx -t "handles sequential rich text keyboard insertion"
```

Current failure:

```text
expected 'hel' to be 'hello'
```

This repro renders the real `RichTextEditor` inside a real `createSyncedContext<RichTextState>` provider, then simulates incremental input one character at a time.

## Relevant code paths

### Editor input handling

File:

- `src/react-rich-text/RichTextEditor.tsx`

Relevant handlers:

- `onBeforeInput`
  - reads current selection through `selectionRangeIn(root)`;
  - calls `replaceSelectionWithText`;
  - dispatches rich-text `insert`;
  - stores `pendingSelection`.
- `onInput`
  - fallback path;
  - diffs `view.plainText` against `event.currentTarget.textContent`;
  - resets `event.currentTarget.textContent = view.plainText`;
  - dispatches delete/insert operations;
  - stores `pendingSelection`.
- `useLayoutEffect`
  - restores `pendingSelection` after `view.plainText` changes.

### Rich-text binding

File:

- `src/react-crdt/react-crdt.tsx`

Relevant helper:

- `useRichText(node)`
  - materializes the current rich-text field into `view`;
  - returns commands that dispatch `node.$text.insert/delete/mark/unmark/replace`;
  - subscribes to the field path and updates the materialized view after changes.

### Rich notes app wrapper

File:

- `examples/react-crdt/src/apps/rich-notes/RichNotesPanel.tsx`

The notes app wraps rich-text commands only to update `updatedAt`. The Testing Library repro bypasses this app wrapper and still fails, so the bug is not specific to `updatedAt` touching or notes sidebar rendering.

## Important observations

- The older integration test `renders and edits rich text through the synced contenteditable helper` passes because it sets `editor.textContent = 'hello'` once and fires a single `input` event. That exercises bulk fallback diffing, not real sequential typing.
- The new Testing Library repro fails when input is delivered one character at a time.
- The Playwright repro, which uses `page.keyboard.type('hello')`, fails similarly. This is closer to actual user behavior.
- A first attempt to use jsdom `beforeinput` did not trigger React's `onBeforeInput` in this test environment, so the Testing Library repro currently uses the fallback `input` path. It still reproduces character loss.
- Playwright likely exercises the `beforeinput` path in Chromium. Since both Playwright and Testing Library fail, there may be related bugs in both the `beforeinput` and fallback `input` paths, or a shared state/selection assumption beneath them.

## Hypotheses

### 1. Selection restoration is stale during rapid sequential input

`RichTextEditor` stores `pendingSelection` and restores it in a layout effect after `view.plainText` changes. During real typing, multiple DOM/input events can arrive while React state, CRDT history, and materialized view updates are still catching up.

Potential failure mode:

- first character inserts and schedules selection restore;
- next character uses a browser/jsdom selection that still points at an old offset;
- insert happens at the wrong index or overwrites/skips expected text;
- later render reconciles from CRDT state, dropping DOM text that was optimistically present.

The Playwright observation `Body for hlo` suggests at least one operation may be applied at the wrong index/order, not just ignored.

### 2. The fallback `onInput` diff compares against stale `view.plainText`

The fallback handler computes:

```ts
const edit = diffPlainText(view.plainText, after);
```

If `view.plainText` is stale for a later input event, the diff can describe the wrong operation. The handler then does:

```ts
event.currentTarget.textContent = view.plainText;
applyEdit(edit, nextSelection);
```

That means the DOM is reset to stale rendered text before the latest operation has necessarily been materialized. During fast sequential input, this can erase characters that the browser just inserted.

The Testing Library repro is especially aligned with this hypothesis because it exercises `onInput` one character at a time and ends at `hel`.

### 3. `onBeforeInput` prevents the browser mutation but selection may not advance synchronously

For actual Chromium input, `onBeforeInput` prevents default and dispatches CRDT operations. The browser does not mutate the contenteditable DOM; React must re-render from CRDT state and restore selection.

If selection restoration lags, the next `beforeinput` may still see the old caret position. Repeated inserts could target the wrong offsets even though each operation is individually valid.

### 4. Rich-text operation batching/re-render timing is too granular for keystrokes

Each character becomes a separate rich-text operation and a separate React update path. That is correct in principle, but the editor currently relies on DOM selection and rendered text being coherent after every single operation.

If the CRDT provider batches/schedules notifications or React batches renders, the editor may observe a partially stale `view` while processing later keystrokes.

### 5. The existing tests miss this because they do not model typing

Current coverage includes:

- isolated editor command translation with mocked commands;
- one-shot fallback input from `''` to `'hello'`;
- rich-text insert/mark commands fired from buttons.

Those tests prove individual command wiring works, but they do not prove repeated keyboard input works through the full editor/render/selection loop.

## Likely fix directions

These are not fully validated yet, but they are plausible next steps.

- Add a reliable editor-level typing test that does not depend on browser-only `beforeinput` support. Keep the new integration repro even after fixing.
- Avoid using stale `view.plainText` as the base for fallback `input` diffs when sequential inputs are pending.
- Consider maintaining an editor-local optimistic plain-text/selection model while CRDT updates are in flight, then reconciling when the materialized view catches up.
- For `beforeinput`, update the DOM/caret synchronously or otherwise ensure the next input event sees the intended caret position.
- Consider batching sequential text input into a single command or local transaction when events occur before the previous render has settled.
- Audit `restoreSelection`, `selectionRangeIn`, and `RichTextSpanView` rendering for text-node identity changes that might invalidate caret restoration between keystrokes.

## Acceptance criteria for a fix

- `pnpm exec vitest run src/react-crdt/react-crdt.test.tsx -t "handles sequential rich text keyboard insertion"` passes.
- `pnpm --dir examples/react-crdt exec playwright test -c playwright.config.ts tests/smoke/rich-notes-local.spec.ts` passes.
- Existing rich-text tests still pass:

```sh
pnpm exec vitest run src/react-rich-text/RichTextEditor.test.tsx
pnpm exec vitest run src/react-crdt/react-crdt.test.tsx
```

- Manual typing into the Rich Notes app no longer drops or reorders characters.
