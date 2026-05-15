import type {PatchBuilderInternal} from '../types.js';
import type {Context} from './react.js';

export type Updater<Current, Tag extends PropertyKey = 'type'> = PatchBuilderInternal<
    unknown,
    Current,
    Tag,
    void,
    Context
>;
