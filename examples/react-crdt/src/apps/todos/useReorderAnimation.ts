import {useLayoutEffect, useRef} from 'react';

export function useReorderAnimation({
    ids,
    getElement,
    durationMs,
}: {
    ids: readonly string[];
    getElement(id: string): HTMLElement | null;
    durationMs: number;
}) {
    const previousRects = useRef(new Map<string, DOMRect>());

    useLayoutEffect(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const nextRects = new Map<string, DOMRect>();
        for (const id of ids) {
            const element = getElement(id);
            if (element) nextRects.set(id, element.getBoundingClientRect());
        }

        if (!reduceMotion) {
            for (const [id, next] of nextRects) {
                const previous = previousRects.current.get(id);
                const element = getElement(id);
                if (!previous || !element) continue;
                const deltaY = previous.top - next.top;
                if (Math.abs(deltaY) < 1) continue;
                element.animate(
                    [{transform: `translateY(${deltaY}px)`}, {transform: 'translateY(0)'}],
                    {
                        duration: durationMs,
                        easing: 'cubic-bezier(0.2, 0, 0, 1)',
                    },
                );
            }
        }

        previousRects.current = nextRects;
    }, [durationMs, getElement, ids]);
}
