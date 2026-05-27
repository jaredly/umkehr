import type {RemixNode} from 'remix/ui';
import {renderToStream} from 'remix/ui/server';
import {router} from '../router.ts';

export function render(node: RemixNode, request: Request, init?: ResponseInit) {
    const stream = renderToStream(node, {
        frameSrc: request.url,
        async resolveFrame(src, target) {
            const headers = new Headers({accept: 'text/html'});
            const cookie = request.headers.get('cookie');
            if (cookie) headers.set('cookie', cookie);
            if (target) headers.set('x-remix-target', target);

            const response = await router.fetch(new Request(new URL(src, request.url), {headers}));
            return response.body ?? response.text();
        },
    });

    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'text/html; charset=utf-8');
    }

    return new Response(stream, {...init, headers});
}
