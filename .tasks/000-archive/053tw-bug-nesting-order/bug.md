Somewhere probably in the implementation of virtual block parents (051s3), we broke nesting.
Trying to indent a block in the examples/block-rich-text app *when an annotation exists* throws up this error:
```
Uncaught Error: block order path for 0015-left references a missing block
    at validateBlockOrderPathSummary (blocks.ts:359:19)
    at deriveBlockParentsForBlocks (blocks.ts:191:26)
    at materializedBlockPath (blocks.ts:53:21)
    at isBlockDescendantOf (changes.ts:657:15)
    at moveBlockOps (changes.ts:370:66)
    at moveBlock (blockCommands.ts:287:17)
    at App.tsx:472:32
    at App.tsx:151:28
    at onCommand (App.tsx:342:45)
    at onMove (App.tsx:471:13)
```
