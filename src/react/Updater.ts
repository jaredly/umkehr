import {PatchBuilderInternal} from '../types';
import type {Extra} from './react';

export type Updater<Current, Tag extends PropertyKey = 'type'> = PatchBuilderInternal<
    unknown,
    Current,
    Tag,
    void,
    Extra
>;
