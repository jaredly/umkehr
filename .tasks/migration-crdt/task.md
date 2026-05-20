
Now that we have schema migration machinery, I want us to do some hard thinking about
how to get confidence that a given `migrateCrdtUpdate` actually maintains the invariants of the CRDT.
Probably what we want is to provide some nice helper functions that can perform a crdt-safe update for common cases:
- deleting a field
- adding an optional field
- adding a required field with a backfill default value
- performing a simple mutation backfill of a primitive field

I also wonder if there's some kind of generative-testing approach to take?

On the other side of things, I wonder about using a theorem prover (like Lean or Rocq) to "prove" first that our CRDT is itself valid, and then that certain kinds of migrations are also valid.
