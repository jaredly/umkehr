Can you write playwright tests to exercise the migration story?
So like: 
- server has a todosV1 document, and client todosV2 loads it, sees the 'please migrate' message, clicks it, migration happens, all is well
- server has a todosV1 document, client A w/ todosV1 loads it, client B with todosV2 loads it, clicks 'please migrate', client A sees the 'migration is happening' message and then the 'you need to upgrade to reenable sync'

There are probably some other scenarios we should cover, especially with pending events and intermittent connectivity.
