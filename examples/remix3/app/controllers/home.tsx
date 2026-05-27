import type {BuildAction} from 'remix/fetch-router';
import {TodoPage} from '../ui/App.tsx';
import {render} from '../utils/render.tsx';
import type {routes} from '../routes.ts';

export const home: BuildAction<'GET', typeof routes.home> = {
    handler({request}) {
        return render(<TodoPage />, request);
    },
};
