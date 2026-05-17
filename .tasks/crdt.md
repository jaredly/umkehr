
Research thoughts:
- ArrayItemMeta.create feels redundants with the value's created/deleted timestamp
- taggedField parentCreated & tagTs seem like they would be the same?
- array ordering open concern is noted and understood
- the "ArrayStorage" sketch is redundant with the earlier ArrayItemMeta. I prefer the ArrayItemMeta version.
- id generation can use the hlc, we don't need a separate function for that
- 


# What would it take to make a CRDT version of umkehr?

would be awesome if the "data" could stay in the shape we expect, supporting:
- Objects
- Tagged unions
- Records
- Arrays (backed by fractional indices)
- Primitives (string|bool|number)

-> Note: the 'type' of a tagged union object is not updatable. the whole object needs to be replaced
-> we're doin Last Write Wins
-> record deletes via tombstones (with timestamp)
-> arrays have auto-created unique IDs and fractional indices, stored in a record, with tombstones for deletion

Not supporting:
- functions
- non-simple objects (Date, Blob, etc.)
- Sets, Maps

Similar to normal patches, `undefined` is treated the same as 'missing'

Ok concretely, what does this look like
and how does it interact with patches?
- add ✅ (root ts gets applied to everything)
- replace ✅ (root ts gets applied to everything)
- remove ✅ (tombstone)
- move ❌ I just don't think it can work in a way that's satisfactory. if you actually want to (remove + add), do it, and be aware of the cost
- reorder ✅ (root ts gets applied to order updates)

So we take a Patch and a ts, and the current metadata object, and we can produce a CRDT update
- replace/remove -> check path for array indices, replace with IDs.
- also, remove turns into 'replace with a tombstone'
- add -> same path check, and if the final item is an array index, we need to generate a new "order" fractional index
- reorder -> same path check, and the "order" needs to turn into a mapping of ID to fractional index

CRDT metadata is stored in a parallel data structure to the "state".

For example:
```ts
type State = {bgcolor:string, todos: Todo[]}
type Todo = {
    id:string,
    title:string,
    done:boolean,
    icon: {type: 'image', url: string} | {type: 'emoji', text: string};
}

const state:State = {
    bgcolor: 'green',
    todos: [
        {id: 'abc', title: 'Go home', done: false, icon: {type: 'image', url: 'http://example.com'}},
        {id: 'def', title: 'Stay here', done: true, icon: {type: 'emoji', text: '🤔'}},
    ]
}
const metadata = {
    bgcolor: '1234.abcd', // hybrid-logical-clock timestamp
    todos: {
        abc: {
            meta: {ts: '1245.abce', order: 1},
            contents: {title: '1111,aaaa', done: '1111.aaaa', icon: {type: '1112.aaab', url: '1112.aaab'}}},
        def: {
            meta: {ts: '1245.abce', order: 2},
            contents: {title: '2222.bbbb', done: '2222.bbbb', icon: {type: '1113.aaac', text: '1113.aaac'}}
        }
    }
}
```

Note that the HLC timestamps for `type` in tagged unions does not represent "the ts at which the `type` attribute was last updated", because you can't update the `type` by itself; it represents the ts at which the object was set to that branch of the tagged union. An invariant there is that the `type` ts will be <= the ts of every other element in that object.
When handling an update where the tags don't match.... ok I guess we need to know the update ts of the incoming `type`? 🤔 annnnnnd we would need to, like, hang on to any updates that were more recent, but for which we didn't have the whole base available. hmmmmmm
yeah I haven't totally been thinking about how to deal with updates coming out of order. because we're supposed to be able to handle that.

Ok, so if we have an update, and somewhere along the path we come to (a) an object doesn't exist yet, or (b) it's a tagged union where the existing tag has a lower ts than ours, we put that update in a 'pending' list. And then we have to check that periodically to resolve things. Seems like that might get ... expensive, in a pathological case. but it should only happen in the presence of out-of-order delivery, which I don't super expect to be common? like we're not using UDP here. BUT for the sake of complying with CRDT expectations, we should have a solution for it. so I'm happy with that.

So, some upshots:
- in a path, of `type:tag`, we need to include a timestamp in the pathsegment
- paths of `type:key` don't need a timestamp, because the shape of any value that's not a tagged union is going to be fully mergeable (whereas two different branches of a tagged union should not be merged)
- updates we receive that we can't yet process (because a parent object hasn't yet been created, or a parent tagged union hasn't been created yet) get stuffed in a queue to process 'later'. In the pathological case, we would want to have some clever data structure that makes it quick to know which queued updates are ready to be applied, but I'm not going to optimize for that at the moment
- if we're processing a path with a tagged union where the tag's timestamp is earlier than the one in the current data, we discard the update

hmmmmm ok but so here's the thing about tombstones. if we're traversing a path, and we find a tombstone that is ... later than ... hmmm. the ts of our path element, then we need to discard the update instead of queueing it? I need to try to make a test case that would exercise this issue.


A: {abc: {1, ts: 1}}
A: abc = 2, ts: 3
B: abc = $tomb, ts: 2

-> abc: 2, wins over $tomb 2

A: {abc: {def: {1, ts: 1}, xyz: {10, ts: 1}}}
A: abc.def = {2, ts: 3}

B: abc = $tomb, ts: 2

-> abc: $tomb, not a way to undo that

BUT what if we recreate, what happens then.

A1: {abc: {def: {1, ts: 1}, xyz: {10, ts: 1}}}
A2: abc.def = {2, ts: 4}

B1: abc = $tomb, ts: 2
B2: abc = {def: {1, ts: 3}, xyz: {10, ts: 3}}


A1A2B1B2 oh wow that is bad... we'd need to... extract everything that is newer than the tombstone? in case it gets recreated?
A1B1A2B2 need to hang on to A2

A1 B2 B1 A2 oof yeah that's broke. the delete needs to know it should be discarded.

OK so idea 1: if an object is deletable, we need the object to have a ts
this would at least fix the "which came first, the object or the tombstone"

but are there other ways to get this messed up?

If there was like `C1: abd.def = {2, ts: 1.5}`, and we got B1 C1, we would discard C1. Because
the object after B1 would necessarily have all timestamps >= B1, which would be >= C1.
UNLESSS wait. optional things.
hm.

like

```ts
type Items = Record<string, {title: string, people: Record<string, {name: string}>}>
````

You could have:
A: items.one = {title: 'One', people: {}}
B: items.one.people.me = {name: 'Me'}
C: delete items.one
D: items.one = {title: 'One1', people: {}}

and if you received ACDB you might end up with something completely wrong.
SO: paths with deletables also need a ts in the pathitem, and it needs to match the current thing.
hmmm. yeah that should work right.

So in the meta for a record, we have an overall ts as well as the substructure timestamps?
yeah that sounds ok. feels more consistent.
but for things that can't be deleted, do we also want replacements to overwrite stuff?
honestly at this point we might as well be consistent. Then we can deal with loosening things later.

SO: every object & record has a "creation timestamp", and every PathSegment has a timestamp that
must match the corresponding creation timestamp for it to be applied. if it's <, then we discard the patch. if it's >, then we need to enqueue the update for later.
