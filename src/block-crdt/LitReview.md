# Literature Review: Tree, Text, and Rich-Text CRDTs

This note compares tree CRDTs, text CRDTs, and rich-text CRDTs with the
`src/block-crdt` design, described locally as **Rich Causal Blocks**.

Rich Causal Blocks is an operation-based CRDT for block-structured rich text. It
stores stable Lamport ids for blocks and grapheme-cluster characters, models text
as parent-linked character trees rooted at block ids, uses LSEQ-style positions
for ordered block siblings, keeps deleted records as tombstones, represents
block splits with `split-record` plus `char:move`, represents joins with
`join-record` sentinels, and stores rich-text marks anchored to character ids.

The closest conceptual peers are not any one CRDT family, but a combination of:

- sequence CRDTs for text,
- ordered-tree CRDTs for outlines and blocks,
- rich-text CRDTs that preserve formatting intent across concurrent edits.

## Sources Consulted

Primary and near-primary sources used for this comparison:

- Shapiro et al., "A comprehensive study of Convergent and Commutative
  Replicated Data Types" / CRDT taxonomy and sequence examples:
  <https://inria.hal.science/inria-00555588/document>
- Preguica, Marques, Shapiro, Letia, "A commutative replicated data type for
  cooperative editing" / Treedoc:
  <https://arxiv.org/abs/0710.1784>
- Weiss, Urso, Molli, "Logoot: A scalable optimistic replication algorithm for
  collaborative editing on P2P networks":
  <https://citeseerx.ist.psu.edu/document?doi=3e4100aa3e72acf665fcad63cefeda8b214eb11e&repid=rep1&type=pdf>
- Nicolas, Martin, Mostefaoui, Weiss, "LSEQ: an adaptive structure for sequences
  in distributed collaborative editing":
  <https://hal.science/hal-00921633/document>
- Kleppmann and Beresford, "A Conflict-Free Replicated JSON Datatype":
  <https://arxiv.org/abs/1608.03960>
- Kleppmann et al., "Moving Elements in List CRDTs":
  <https://martin.kleppmann.com/papers/list-move-papoc20.pdf>
- Kleppmann, "A highly-available move operation for replicated trees":
  <https://martin.kleppmann.com/papers/move-op.pdf>
- Litt, Hardenberg, Kleppmann, "Peritext: A CRDT for Collaborative Rich Text
  Editing":
  <https://www.inkandswitch.com/peritext/static/cambridge.pdf>
- Jahns, "Yjs: A CRDT Framework for Shared Editing":
  <https://github.com/yjs/yjs> and algorithm notes in the Yjs repository.
- Diamond Types / Fugue-family sequence CRDT notes:
  <https://github.com/josephg/diamond-types>

## Taxonomy

### Text CRDTs

Text CRDTs model a document as a replicated sequence. Each inserted atom gets a
stable id. Deletes typically tombstone or remove atoms after their identity is no
longer needed. The hard problem is ordering concurrent inserts at the same
position in a way that converges and feels acceptable to users.

Common examples:

- RGA: linked-list sequence using predecessor ids.
- Treedoc: path/tree-addressed sequence.
- Logoot/LSEQ: dense identifier sequence with position ids between neighbors.
- YATA/Yjs and Fugue-style algorithms: sequence CRDTs tuned for interleaving,
  local insertion runs, and practical editor performance.

### Tree CRDTs

Tree CRDTs model hierarchical objects: XML, JSON, outlines, block documents, or
filesystem-like structures. Their hard problems are reparenting, move cycles,
delete-vs-move conflicts, and preserving user intent when an operation targets a
node whose ancestors have concurrently changed.

Common examples:

- JSON CRDTs with maps, registers, lists, and nested objects.
- XML/tree CRDTs for collaborative structured documents.
- Move-enabled tree CRDTs that make reparenting available without creating
  cycles or orphaning subtrees.

### Rich-Text CRDTs

Rich-text CRDTs add semantic ranges to text CRDTs. Their hard problem is not only
where text lands, but which text a style range should cover after concurrent
insertions, deletions, paragraph splits, joins, and overlapping style changes.

Common examples:

- Peritext, which anchors marks to stable character positions with before/after
  bias and defines behavior for overlapping annotations.
- Yjs-style shared XML/text structures, which are widely used in rich editors but
  generally delegate rich formatting policy to the editor binding or shared type
  schema.

## Rich Causal Blocks In This Taxonomy

Rich Causal Blocks sits between these families:

- For inline text, it is closest to an RGA/Fugue-style parent-linked character
  tree: each `Char` has a stable id and a parent id, traversal materializes text
  by walking children.
- For block order, it uses LSEQ-like variable-length position ids among siblings.
- For block structure, each `Block` has a stable id and a materialized order path;
  `block:move` updates the order path and sibling position with timestamped
  conflict resolution.
- For paragraph split and join, it does not merely insert or remove a newline.
  Split creates a new block and moves the right-side character subtree. Join
  records a hidden right block and a sentinel that materializes the right block's
  content after the left block tail.
- For formatting, marks anchor to character ids with boundary bias and record
  crossed split ids, which lets formatting follow the user's selected text rather
  than only a numeric offset.

The result is a CRDT for a specific product shape: block-based rich text where
users frequently split paragraphs, join paragraphs, indent/outdent blocks, move
blocks, and apply formatting ranges.

## Text CRDTs Compared

### RGA

RGA represents a list as elements inserted after existing elements, with unique
operation ids determining a deterministic order for concurrent siblings.

Strengths:

- Simple operation model: insert after id, delete id.
- Natural fit for local typing runs because a run forms a chain.
- Stable ids make selections, comments, and marks easier to anchor than offset
  models.
- Tombstones preserve causal context and make out-of-order delivery tractable.

Weaknesses:

- Tombstones accumulate unless the system has a safe garbage-collection protocol.
- Concurrent inserts at the same predecessor can interleave in ways users do not
  intend, depending on tie-break rules.
- A plain RGA has no native paragraph/block semantics. Splitting a paragraph is
  usually represented as inserting a newline or a structural marker, not as a
  first-class block operation.

Best suited user behavior:

- Continuous typing and deleting in mostly linear prose.
- Collaborative editing where users often edit different ranges.
- Systems that need stable anchors for comments or selections but can tolerate
  tombstone pressure.

Compared with Rich Causal Blocks:

Rich Causal Blocks inherits RGA-like advantages for text identity, but extends
the model with block ids, split/join records, and character moves. That is a
major strength for block editors: a paragraph split can move existing character
identity into a new block instead of reinterpreting text around a newline.

The relative weakness is implementation complexity. Rich Causal Blocks must
maintain traversal caches, char-parent version rules, join sentinels, and split
records. A plain RGA is easier to reason about, persist, compact, and test.

### Logoot and LSEQ

Logoot assigns each list element a dense position identifier between neighboring
identifiers. LSEQ improves allocation by adapting identifier growth to repeated
insertions.

Strengths:

- Insert operations can be applied without predecessor tombstones in the core
  ordering relation.
- Position ids are well suited to ordered sibling lists where moves are
  represented by assigning a new position.
- LSEQ's allocation strategy controls identifier growth better than naive dense
  allocation.

Weaknesses:

- Identifier growth remains a practical concern under adversarial or highly
  localized insert patterns.
- Pure position ids do not by themselves encode rich causal insertion intent;
  concurrent same-position typing can still produce unintuitive order.
- Moving an existing element by changing its position requires additional
  conflict-resolution semantics.

Best suited user behavior:

- Inserting items into ordered lists, outlines, and sibling collections.
- Workloads where random-ish allocation between neighbors is acceptable.
- Block-level order where users move coarse objects more often than individual
  characters.

Compared with Rich Causal Blocks:

Rich Causal Blocks uses an LSEQ-style id for block sibling order, which is a good
fit: block movement and insertion are coarser than character insertion, so
identifier growth is less likely to dominate. It deliberately does not use LSEQ
as the primary inline text representation; character parent links better preserve
local typing runs and causal adjacency.

The relative weakness is that block moves require both a position id and a path.
That gives the implementation enough information to derive parents and reject
cycles, but it also creates a larger op payload and more validation surface than
a flat LSEQ list.

### YATA, Yjs, Fugue, and Diamond Types

Modern practical text CRDTs such as YATA/Yjs and Fugue-family algorithms focus
heavily on local insertion order, interleaving avoidance, binary encoding,
performance, and editor integration.

Strengths:

- Strong practical performance and storage engineering.
- Better behavior for concurrent typing runs than older list CRDTs in many
  common cases.
- Mature ecosystem in the case of Yjs, including editor bindings, awareness, and
  persistence tooling.
- Fugue/Diamond Types style work has a clear focus on preserving user-visible
  order under text-editing workloads.

Weaknesses:

- General-purpose text structures do not automatically define paragraph split,
  join, block movement, or rich formatting semantics.
- Rich editor behavior is often implemented above the CRDT in bindings, schemas,
  or editor-specific conventions.
- It can be hard to retrofit precise block-level intent if the underlying shared
  document treats structure as embedded XML or marker ranges.

Best suited user behavior:

- High-volume collaborative typing.
- Editor integrations where latency, wire efficiency, and mature bindings matter.
- Documents whose structure can be represented as nested shared types without
  needing special split/join provenance.

Compared with Rich Causal Blocks:

Rich Causal Blocks is narrower but more semantically explicit. It is less mature
than Yjs as infrastructure, but it directly encodes operations that block editors
care about: `splitBlockOps`, `joinBlocksOps`, `moveBlockOps`, and mark traversal
over split history.

The weakness is ecosystem and optimization. Yjs has years of production hardening
around sync, update encoding, garbage collection, awareness, and bindings. Rich
Causal Blocks currently targets thousands of blocks and one or two orders of
magnitude more characters, not arbitrarily large documents with heavily optimized
binary updates.

## Tree CRDTs Compared

### JSON CRDTs

JSON CRDTs model nested maps, registers, lists, and primitive values. They are a
good fit for application state and structured documents.

Strengths:

- Broad schema coverage: maps, lists, registers, counters, nested objects.
- Natural fit for app documents where many fields are not text.
- Clear separation between object identity and field/register conflict
  resolution.

Weaknesses:

- Lists inside JSON still need a sequence CRDT and inherit its ordering issues.
- Rich text represented as JSON arrays of spans often has poor behavior under
  concurrent typing and formatting unless a specialized text layer is added.
- General JSON does not define paragraph split/join intent.

Best suited user behavior:

- Collaborative manipulation of structured records, whiteboards, settings, or
  documents with many independent fields.
- Mixed workloads where text is only one part of the object graph.

Compared with Rich Causal Blocks:

Rich Causal Blocks is less general than a JSON CRDT but stronger for one domain:
block-rich text. It avoids representing rich text as arbitrary JSON arrays of
spans, and instead uses stable characters and blocks as the durable substrate.

Its weakness is that metadata is intentionally shallow. `Block` metadata is a
timestamped value, not a nested CRDT object. That is appropriate for paragraph
type and checkbox state, but less expressive than a full JSON CRDT for complex
embedded objects.

### Move-Enabled Tree CRDTs

Move-enabled tree CRDTs address reparenting under concurrency. The central
problem is preserving convergence while preventing cycles when users move
subtrees concurrently.

Strengths:

- First-class move operation preserves object identity across reparenting.
- Cycle prevention and orphan handling are part of the CRDT semantics.
- Good fit for outlines, file trees, task hierarchies, and structured editors.

Weaknesses:

- The conflict rules can be subtle and hard to explain to users.
- Move-vs-delete and move-vs-move semantics often require policy choices.
- Ordered siblings require an additional list-position CRDT.

Best suited user behavior:

- Reorganizing trees and outlines.
- Dragging sections, folders, or tasks between parents.
- Collaborative restructuring where preserving node identity matters.

Compared with Rich Causal Blocks:

Rich Causal Blocks implements a practical move-enabled block tree. `block:move`
preserves the block id, updates a materialized path, uses an LSEQ sibling index,
and derives parents with cycle rejection. Visible traversal also splices visible
descendants of hidden deleted/joined parents into the nearest visible ancestor.

The relative weakness is that the move logic is specialized to blocks, not a
general tree object CRDT. It does not expose arbitrary node fields as CRDT
children, and its cycle resolution is tied to block order ids and materialized
paths.

### XML and Structured-Document CRDTs

XML/tree CRDTs are closer to rich editors because they model nested tagged nodes
and text nodes.

Strengths:

- Natural representation for hierarchical editor schemas.
- Can model inline and block structure uniformly.
- Good conceptual fit for documents with nested elements, attributes, and text.

Weaknesses:

- The uniform tree model can make text editing heavier than a specialized text
  CRDT.
- Split/join intent may be obscured as generic tree insertion/deletion/move.
- Formatting ranges represented as nested elements can interact poorly with
  overlapping marks unless the model has explicit annotation semantics.

Best suited user behavior:

- Structured authoring where users manipulate elements, not only text.
- Documents with strong schemas and nested blocks.

Compared with Rich Causal Blocks:

Rich Causal Blocks chooses a less general but more editor-intentional model:
blocks are tree nodes, text is stable character identity, and formatting is
marks. That is better for overlapping annotations and paragraph operations, but
less natural for arbitrary nested inline elements.

## Rich-Text CRDTs Compared

### Peritext

Peritext is the most directly relevant rich-text CRDT. It treats formatting as
annotations anchored to stable positions in a text CRDT, with start/end bias and
rules for resolving overlapping marks.

Strengths:

- Formatting intent is explicit rather than encoded as fragile spans.
- Anchors survive concurrent insertion and deletion better than numeric offsets.
- Boundary bias allows a mark to specify whether adjacent inserted text should be
  included.
- Overlap is natural; marks do not require a single canonical nested span tree.

Weaknesses:

- Annotation semantics are more complex than plain text CRDT semantics.
- Rendering still needs deterministic materialization into the editor's span/tree
  model.
- Paragraph split and join semantics are not the central abstraction; applications
  must decide how annotation traversal crosses structural boundaries.

Best suited user behavior:

- Applying bold, links, comments, highlights, and other ranges while collaborators
  concurrently edit nearby text.
- Editors that need overlapping marks and stable annotations.
- Workloads where format ranges matter as much as characters.

Compared with Rich Causal Blocks:

Rich Causal Blocks borrows the most important Peritext idea: marks anchor to
stable character ids with before/after boundaries instead of to offsets. It adds
block-specific provenance with `crossedSplits`, so a mark created across an
existing split can distinguish that split from later splits the mark should
follow. This is a strong domain-specific extension for paragraph-rich editors.

The weakness is current scope. Mark conflict resolution is intentionally simple:
marks of the same type resolve by highest Lamport id, and remove marks are just
marks with `remove: true`. Peritext discusses richer annotation behavior and edge
semantics. Rich Causal Blocks will need more policy if it wants production-grade
links, comments, mutually exclusive styles, attributes, and editor-specific mark
expansion rules.

### Shared XML/Text Rich Editors

Systems such as Yjs commonly support rich editors by combining shared text, XML
elements, maps, and editor bindings.

Strengths:

- Mature integrations with editors such as ProseMirror, CodeMirror, Monaco, and
  related ecosystems.
- Flexible enough to represent many schemas.
- Sync, awareness, and persistence are already solved for many applications.

Weaknesses:

- Rich-text semantics can live partly in the editor binding rather than the CRDT
  itself.
- Equivalent user actions may produce different low-level structures depending
  on the editor integration.
- Preserving split/join provenance and mark intent may require substantial custom
  schema discipline.

Best suited user behavior:

- Product teams that need a working collaborative editor quickly.
- Rich editors whose schema maps cleanly to existing shared XML/text bindings.
- Applications where infrastructure maturity is more important than bespoke CRDT
  semantics.

Compared with Rich Causal Blocks:

Rich Causal Blocks is less turnkey, but more inspectable as an operation log for
this specific document model. It exposes plain `Op[]` records for storage and
replication, and the operations correspond closely to editor commands.

The tradeoff is that it must build its own ecosystem: sync protocol, compaction,
presence integration, editor bindings, migrations, and long-run performance
tooling.

## Strengths Of Rich Causal Blocks

### First-Class Block Editing

Many collaborative editors treat paragraphs as newline-delimited text or as
nodes in a generic shared tree. Rich Causal Blocks makes blocks durable objects
with stable ids, metadata, ordering, deletion state, and movement. That is a good
match for modern block editors, outliners, task lists, and note-taking tools.

### Split And Join Preserve Character Identity

Split and join are not destructive text rewrites. Split moves the right-side
character subtree into a new block. Join hides the right block with a join record
and materializes its contents after the left tail. This preserves anchors for
selection, marks, comments, and undo planning better than re-creating text in a
new paragraph.

### Formatting Is Integrated With Structure

Marks depend on split and join history. Keeping marks in the same package as the
block/text CRDT lets materialization account for crossed splits and joined
content. This is stronger than layering naive offset spans over a text CRDT.

### Explicit Operation Log

The public `Op[]` format is storage- and replication-friendly. It also makes
testing easier: generated operation sequences can check convergence for inserts,
deletes, splits, joins, and block moves.

### Good Fit For User Intent In Block Documents

The model is especially suited to:

- typing inside paragraphs,
- splitting and joining paragraphs,
- moving blocks in an outline,
- formatting ranges across text that may later be split,
- preserving comments/selections/marks by stable ids,
- collaborative note-taking and task-document workflows.

## Weaknesses And Risks Of Rich Causal Blocks

### Complexity

The model combines multiple CRDT strategies: character trees, LSEQ sibling
positions, timestamped block paths, join records, split records, mark traversal,
and derived caches. Each layer adds invariants. Bugs are more likely at the
boundaries: split plus concurrent insert, join plus concurrent split, move plus
hidden parent, mark plus crossed split.

### Tombstone And Metadata Growth

Characters and blocks are tombstoned. Splits, joins, and marks are durable
records. Without a compaction protocol, long-lived heavily edited documents will
grow. Compaction is harder than in a plain sequence because split/join/mark
records may reference old character and block ids.

### Limited Generality

This is not a general JSON/tree CRDT. Block metadata is timestamped data, not a
nested replicated object. Inline rich structures beyond marks, such as embedded
atoms or nested inline nodes, would need more design.

### Formatting Policy Is Still Young

The current mark model is promising but simple. Production rich text often needs
policy for links, comments, mutually exclusive attributes, block-vs-inline
formatting, mark expansion at cursor boundaries, copied content provenance, and
semantic deletion of annotations.

### Performance Envelope Is Explicitly Modest

The README targets thousands of blocks and one or two orders of magnitude more
characters. That is reasonable for notes and many documents, but it is not the
same target as industrial text CRDT libraries optimized for very large histories
and compact binary updates.

### Harder Interop

A plain JSON CRDT or Yjs shared type can often be adopted by existing tooling.
Rich Causal Blocks has a custom op model. That improves semantic fit but means
interoperability, migrations, editor bindings, and sync infrastructure need to be
owned locally.

## Behavior Fit Matrix

| User behavior | Best-fitting approach | Why |
| --- | --- | --- |
| Fast collaborative typing in linear text | Yjs/YATA, Fugue/Diamond Types, RGA variants | Optimized for sequence edits and local insertion runs. |
| Ordered list or sibling insertion | LSEQ/Logoot-style identifiers | Dense ids naturally place new siblings between neighbors. |
| Outlining and reparenting sections | Move-enabled tree CRDTs, Rich Causal Blocks | Stable node identity matters more than raw text sequence behavior. |
| Paragraph split/join-heavy editing | Rich Causal Blocks | Split/join are first-class and preserve character identity. |
| Rich formatting over concurrent text edits | Peritext, Rich Causal Blocks | Stable mark anchors survive nearby text changes better than offset spans. |
| Arbitrary app state with nested objects | JSON CRDTs | Maps, registers, lists, and objects are general-purpose. |
| Production editor with existing bindings | Yjs shared text/XML | Ecosystem maturity and binding availability dominate. |
| Comments/selections anchored to block text | Rich Causal Blocks, Peritext-like text anchors | Stable character ids and block ids give durable references. |
| Very large documents with long histories | Mature text CRDTs with compaction/encoding | Rich Causal Blocks will need additional compaction and encoding work. |

## Overall Assessment

Rich Causal Blocks is strongest where the document's user-visible unit is a
block, not just a character sequence or arbitrary JSON tree. Its distinctive
contribution is the combination of stable character identity, stable block
identity, first-class split/join provenance, block movement, and Peritext-like
mark anchoring.

Relative to text CRDTs, it is better suited to rich block documents but more
complex and less mature. Relative to tree CRDTs, it has stronger inline text and
formatting semantics but less general object modeling. Relative to Peritext, it
adds paragraph/block structure and split/join history, but its annotation policy
is currently simpler and less fully explored.

The best product fit is a collaborative block editor, outliner, note system, or
task document where users frequently restructure content and expect formatting,
comments, and selections to remain attached to the intended text. The weakest fit
is a general-purpose replicated application state layer, an arbitrary XML/JSON
schema editor, or a very large linear text editor where mature sequence-CRDT
infrastructure matters more than block-specific semantics.
