# Phase 1: Shared Archive And Document Infrastructure

## Goal

Establish the common primitives every mode will use for document archives, document switching, file upload/download, and validation.

This phase should not force any existing mode to adopt the new controls yet. It should leave the app behavior unchanged while adding tested shared utilities.

## Scope

1. Add `examples/react-crdt/src/lib/documentArchive`.
   - Define `DocumentArchive` with required `docId`.
   - Define `DocumentPayload` as the tagged union.
   - Add parser and serializer.
   - Add archive filename helper.
   - Add app/payload-kind assertion.
   - Add shape guards for wrapper metadata and payload discriminants.
2. Add shared archive validation helpers.
   - `validateCrdtDocumentForApp`
   - `validateCrdtLocalHistoryForApp`
   - `validateCrdtUpdatesForApp`
   - `validateHistoryForApp`
3. Add shared document registry/picker utilities.
   - `LocalDocumentSummary`
   - `DocumentPicker`
   - `readActiveDocIdFromSearch`
   - `urlWithActiveDocId`
4. Add shared `DocumentArchiveControls`.
   - JSON download.
   - JSON upload.
   - Error display.
   - Hidden file input reset.

## Completion Checks

- Archive parser rejects malformed wrapper metadata, missing `docId`, wrong `archiveVersion`, wrong app id, and wrong payload kind.
- `DocumentPicker` can render a manual active document option.
- `DocumentArchiveControls` can export a JSON blob and pass parsed archives to an adapter in tests.
- No mode is required to use the new controls yet.

## Suggested Tests

- Shared archive parser/serializer tests.
- Document picker rendering/option tests.
- File control adapter success/error tests where practical.
