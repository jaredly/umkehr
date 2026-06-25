examples/block-rich-text: let's make a "document import format" where you specify blocks and their metadata, and like their children, but not block IDs, and the 'content' is a flat string, with marks indicated by grapheme index into the string.
So like
```json
[
    {type: 'paragraph', content: 'Hello world'},
    {type: 'todo', meta: {checked: true}, content: 'Write a list', children: [
        {type: 'paragraph', content: 'add a block'},
        {content: 'type in it', marks: [{type: 'bold', start: 0, end: 4}]},
    ]},
]
```
note that `type` should be optional, defaulting to paragraph.
this is just a rough estimate, feel free to change anything about it to make more sense or fit the current data model better.
