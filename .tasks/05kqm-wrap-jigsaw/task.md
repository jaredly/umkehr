examples/react-crdt: Let's make a jigsaw board type that wraps! logically, it's on the surface of a torus. This means that there are no edge pieces. We'll use a normal image (I mean, the user can upload a seamless texture if they want, but it's not required).
Do the 'board' artifact should have a `surface?: 'torus' | 'plane'` where missing means the default, 'plane'.

We might do some rendering things different in the future, but for now we don't need to.
