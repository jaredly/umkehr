import type {PatchBuilderInternal} from '../types';
import type {Context} from './react';

export type Updater<Current, Tag extends PropertyKey = 'type'> = PatchBuilderInternal<
    unknown,
    Current,
    Tag,
    void,
    Context
>;
