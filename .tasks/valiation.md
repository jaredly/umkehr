
##

Ok let's talk about CRDTs.

In a context where there's shared update:
- tree undo is less appropriate
- really, we need two options when you're traversing history in reverse:
  - fork
  - revert
- fork does just branch off the previous change
- revert makes a new update, reversing all the changes in your redoStack

you can also do like "merge" things, but we would want to be able to have a "three-way merge view", right? or maybe just a two-way merge view?

hmmmmmmm before we do that, we need to figure out

## Would it be worth writing a paper about umkehr? that could be somewhat interesting.
It would be cool to prove that it retains type safety. or it could be uninteresting, I have no idea.
would it be possible to produce a `lean` version of the core algorithm?


# Preserving type safety in a distributed system

Currently we can use `typia` to generate validators for the `State` type.
However, I don't think it's possible to use typia as-is to generate a validator for the `Patch<State>` type.


I'd like to figure out our story for preserving type safety when dealing with untrustred data (e.g. from a server or data store). For validating the `State` type itself we can use `typia`, which does compile-time generation to give you a validator function from a typescript type. However, I don't think typia will be able to produce a validator for our `Patch<State>` type. For in-process usage, we produce valid patches by construction -- the `PatchBuilder` ensures that the `Path` you produce is valid for the `State` type. But I don't think there's a way to encode Path semantics into typescript types, which is why `Patch`es use `any/unknown` under the hood.
Anyway, I think this means we need to write our own "compile-time generator for validation functions" if we want to validate an untrusted `Patch<State>` value. Can you look into this and write up a research.md with relevant information and any option questions?
