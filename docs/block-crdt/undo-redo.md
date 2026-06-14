# About: Block Rich Text Undo/Redo

## What It Adds

The block rich text example now has undo and redo controls for each editor.

Each editor has its own local undo history:

- Editor A can undo and redo commands made in Editor A.
- Editor B can undo and redo commands made in Editor B.
- Remote changes from the other editor still sync normally, but they do not become part of the local editor's undo stack.

Undo and redo are available from:

- the per-editor toolbar buttons: `Undo` and `Redo`;
- keyboard shortcuts inside an editor:
  - `Cmd/Ctrl+Z` for undo;
  - `Cmd/Ctrl+Shift+Z` for redo;
  - `Cmd/Ctrl+Y` for redo.

## How Undo Works

Undo does not travel backward in time. It creates a new CRDT update that visually reverses the previous local command.

For example, if Editor A inserts text and then presses Undo, the app appends a new undo action to history. That undo action syncs to Editor B just like any other edit.

This matters because the example is collaborative. The document keeps moving forward even when the visible effect is a reversal.

## What Can Be Undone

Undo/redo is intended to cover normal block-rich-text editing:

- inserted text;
- deleted text;
- block splits;
- block joins;
- block moves, indent, and unindent;
- formatting changes such as bold/italic;
- edits made while online or offline.

When an editor is offline, undo still affects that editor immediately and queues the generated undo ops. When the editor comes back online, the queued undo syncs to the other editor.

## History Scrubber Interaction

Undo/redo is separate from the history scrubber.

Moving the scrubber previews an earlier prefix of the recorded session. Pressing Undo while scrubbed into the past creates a new branch from that point, using the same behavior as editing from the past: future actions after the cursor are dropped, and the new undo action is appended.

Exports include undo/redo actions as normal forward history actions, so importing a session can replay them.

## Gotchas

- Undo is per editor, not global. Editor A's Undo does not undo Editor B's last command.
- A typed character is currently one command. Typing `abc` creates three undo steps, not one grouped word-level undo step.
- Undo may create fresh CRDT identities. For example, undoing a deletion visually restores the text, but the restored characters are new CRDT chars, not resurrected old chars.
- Undoing a deleted block restores a fresh visible block with copied visible content. It does not restore collaborative edits that may have targeted the old deleted block id.
- Undoing a join behaves like splitting the joined block back apart. Existing characters, including concurrent edits in the lower block, are moved into the split-out block rather than recreated.
- Imported histories that predate command metadata still replay, but their old edit actions are not undoable.
- If an undo or redo cannot be planned safely, the editor shows a local status message and does not append a history action.

## Mental Model

The simplest way to think about this feature:

> The scrubber changes what part of history you are viewing. Undo/redo adds new history.
