examples/react-crdt: let's make a 'wordsearch' app within react-crdt. The initial document should create an 8x8 word search from a small dictionary of words. Presence & status should be used to let users know which in-process-selections other users are making.
There should be a word bank at the bottom, which updates indicating which words have been found.
Basic state shape:
```ts
type State = {
    board: string[][],
    words: {start: {x:number,y:number}, end: {x:number,y:number}}[],
    found: {[word: number]: {[userId: string]: number /* timestamp found */}}
}
```
found words should be colored by the user who found it. First finder wins when multiple concurrent finds happen.
Once a word is found, subsequent 'finds' of that word should be rejected by the UI.
