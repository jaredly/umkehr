import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';

export type ActivePopover = {
    id: string;
    top: number;
    left: number;
    source: 'hover' | 'selection';
};

export type PopoverPointerTransition = {
    source: 'trigger' | 'panel';
    relatedTarget?: EventTarget | null;
    clientX?: number;
    clientY?: number;
};

type PopoverOpenReason = 'hover' | 'selection' | 'focus' | 'activation';

type PopoverReasons = Record<PopoverOpenReason, boolean>;

type ManagedPopover = {
    id: string;
    parentId: string | null;
    anchor: HTMLElement | null;
    top: number;
    left: number;
    reasons: PopoverReasons;
};

const emptyReasons = (): PopoverReasons => ({
    hover: false,
    selection: false,
    focus: false,
    activation: false,
});

const hasOpenReason = (popover: ManagedPopover): boolean =>
    popover.reasons.hover ||
    popover.reasons.selection ||
    popover.reasons.focus ||
    popover.reasons.activation;

const positionForAnchor = (element: HTMLElement): Pick<ManagedPopover, 'top' | 'left'> => {
    const rect = element.getBoundingClientRect();
    const width = 320;
    const margin = 12;
    const availableWidth = window.innerWidth || document.documentElement.clientWidth || width;
    return {
        top: rect.bottom + 8,
        left: Math.max(margin, Math.min(rect.left, availableWidth - width - margin)),
    };
};

const parentIdForAnchor = (element: HTMLElement): string | null =>
    element.closest<HTMLElement>('.annotationFloatingPopover')?.dataset.popoverId ?? null;

const descendantsOf = (popovers: ManagedPopover[], id: string): Set<string> => {
    const result = new Set<string>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const popover of popovers) {
            if (!popover.parentId) continue;
            if (popover.parentId === id || result.has(popover.parentId)) {
                if (!result.has(popover.id)) {
                    result.add(popover.id);
                    changed = true;
                }
            }
        }
    }
    return result;
};

const ancestorsOf = (popovers: ManagedPopover[], id: string): Set<string> => {
    const result = new Set<string>();
    let parentId = popovers.find((popover) => popover.id === id)?.parentId ?? null;
    while (parentId) {
        if (result.has(parentId)) break;
        result.add(parentId);
        parentId = popovers.find((popover) => popover.id === parentId)?.parentId ?? null;
    }
    return result;
};

const visiblePopoverIds = (popovers: ManagedPopover[]): Set<string> => {
    const visible = new Set<string>();
    for (const popover of popovers) {
        if (!hasOpenReason(popover)) continue;
        visible.add(popover.id);
        let parentId = popover.parentId;
        while (parentId) {
            if (visible.has(parentId)) break;
            visible.add(parentId);
            parentId = popovers.find((candidate) => candidate.id === parentId)?.parentId ?? null;
        }
    }
    return visible;
};

const popoverDepth = (popovers: ManagedPopover[], id: string): number => {
    let depth = 0;
    let parentId = popovers.find((popover) => popover.id === id)?.parentId ?? null;
    while (parentId) {
        depth += 1;
        parentId = popovers.find((popover) => popover.id === parentId)?.parentId ?? null;
    }
    return depth;
};

const isDescendantPopover = (
    popovers: ManagedPopover[],
    ancestorId: string,
    candidateId: string,
): boolean => descendantsOf(popovers, ancestorId).has(candidateId);

const eventElement = (target: EventTarget | null): Element | null => {
    if (!target || typeof target !== 'object') return null;
    const node = target as Node;
    const elementConstructor = node.ownerDocument?.defaultView?.Element;
    return elementConstructor && target instanceof elementConstructor
        ? (target as Element)
        : null;
};

const popoverPanelIdForTarget = (target: EventTarget | null): string | null =>
    eventElement(target)?.closest<HTMLElement>('.annotationFloatingPopover')?.dataset.popoverId ??
    null;

const popoverTriggerIdsForTarget = (target: EventTarget | null): string[] => {
    const trigger = eventElement(target)?.closest<HTMLElement>('[data-popover-id]');
    if (!trigger) return [];
    return popoverIdsForTrigger(trigger);
};

const targetPopoverIds = (target: EventTarget | null): string[] => {
    const panelId = popoverPanelIdForTarget(target);
    return panelId ? [panelId] : popoverTriggerIdsForTarget(target);
};

const targetIsInsidePopoverSubtree = (
    popovers: ManagedPopover[],
    id: string,
    target: EventTarget | null,
): boolean => {
    const relatedIds = targetPopoverIds(target);
    return relatedIds.some(
        (relatedId) => relatedId === id || isDescendantPopover(popovers, id, relatedId),
    );
};

export const popoverIdsForTrigger = (trigger: HTMLElement): string[] => {
    const ids = trigger.dataset.popoverIds?.split(/\s+/).filter(Boolean);
    if (ids?.length) return ids;
    return trigger.dataset.popoverId ? [trigger.dataset.popoverId] : [];
};

const derivedActivePopovers = (popovers: ManagedPopover[]): ActivePopover[] => {
    const visible = visiblePopoverIds(popovers);
    return popovers
        .filter((popover) => visible.has(popover.id))
        .sort((one, two) => popoverDepth(popovers, one.id) - popoverDepth(popovers, two.id))
        .map((popover) => ({
            id: popover.id,
            top: popover.top,
            left: popover.left,
            source: popover.reasons.selection ? 'selection' : 'hover',
        }));
};

const upsertPopover = (
    popovers: ManagedPopover[],
    id: string,
    element: HTMLElement,
    reason: PopoverOpenReason,
): ManagedPopover[] => {
    const position = positionForAnchor(element);
    const existingIndex = popovers.findIndex((popover) => popover.id === id);
    const parentId = parentIdForAnchor(element);
    if (existingIndex < 0) {
        return [
            ...popovers,
            {
                id,
                parentId,
                anchor: element,
                ...position,
                reasons: {...emptyReasons(), [reason]: true},
            },
        ];
    }

    return popovers.map((popover, index) =>
        index === existingIndex
            ? {
                  ...popover,
                  parentId,
                  anchor: element,
                  ...position,
                  reasons: {...popover.reasons, [reason]: true},
              }
            : popover,
    );
};

const triggerSelectorForId = (id: string): string => {
    const escaped = CSS.escape(id);
    return `[data-popover-id="${escaped}"], [data-popover-ids~="${escaped}"]`;
};

const triggerForPopover = (
    panel: HTMLElement,
    id: string,
    currentAnchor: HTMLElement | null,
): HTMLElement | null => {
    if (
        currentAnchor?.isConnected &&
        panel.contains(currentAnchor) &&
        popoverIdsForTrigger(currentAnchor).includes(id)
    ) {
        return currentAnchor;
    }
    return panel.querySelector<HTMLElement>(triggerSelectorForId(id));
};

const clearReasons = (
    popovers: ManagedPopover[],
    ids: Set<string>,
    reasons: PopoverOpenReason[],
): ManagedPopover[] =>
    popovers.map((popover) =>
        ids.has(popover.id)
            ? {
                  ...popover,
                  reasons: reasons.reduce(
                      (next, reason) => ({...next, [reason]: false}),
                      popover.reasons,
                  ),
              }
            : popover,
    );

const pruneClosedPopovers = (popovers: ManagedPopover[]): ManagedPopover[] => {
    const visible = visiblePopoverIds(popovers);
    return popovers.filter((popover) => visible.has(popover.id));
};

const pointerLooksTowardPopover = (
    popovers: ManagedPopover[],
    id: string,
    transition: PopoverPointerTransition,
): boolean => {
    if (transition.source !== 'trigger') return false;
    if (typeof transition.clientX !== 'number' || typeof transition.clientY !== 'number') {
        return false;
    }
    if (transition.clientX === 0 && transition.clientY === 0) return false;
    const popover = popovers.find((candidate) => candidate.id === id);
    if (!popover) return false;

    const width = 320;
    const horizontalSlop = 56;
    const verticalBridge = 160;
    const earlyPanelSlop = 32;
    const x = transition.clientX;
    const y = transition.clientY;
    const left = popover.left - horizontalSlop;
    const right = popover.left + width + horizontalSlop;
    const top = popover.top;

    return x >= left && x <= right && y >= top - verticalBridge && y <= top + earlyPanelSlop;
};

const pointerClearIds = (
    popovers: ManagedPopover[],
    id: string | undefined,
    relatedTarget: EventTarget | null,
): Set<string> => {
    const ids = id ? descendantsOf(popovers, id) : new Set<string>();
    if (id) {
        ids.add(id);
        for (const ancestorId of ancestorsOf(popovers, id)) {
            if (!targetIsInsidePopoverSubtree(popovers, ancestorId, relatedTarget)) {
                ids.add(ancestorId);
            }
        }
    } else {
        popovers.forEach((popover) => ids.add(popover.id));
    }
    return ids;
};

export const useAnnotationPopoverController = ({
    rootRef,
    selectedPopoverIds,
    selectedPopoverIdsKey,
    selectedPopoverSelectionKey,
}: {
    rootRef: {readonly current: HTMLElement | null};
    selectedPopoverIds: string[];
    selectedPopoverIdsKey: string;
    selectedPopoverSelectionKey: string;
}) => {
    const [managedPopovers, setManagedPopovers] = useState<ManagedPopover[]>([]);
    const focusedPopoverIdRef = useRef<string | null>(null);
    const intentHideTimersRef = useRef<Map<string, number>>(new Map());

    const activePopovers = useMemo(
        () => derivedActivePopovers(managedPopovers),
        [managedPopovers],
    );

    const cancelPopoverHide = useCallback(() => {
        for (const timer of intentHideTimersRef.current.values()) window.clearTimeout(timer);
        intentHideTimersRef.current.clear();
    }, []);

    const cancelPopoverHideForIds = useCallback((ids: Set<string>) => {
        for (const id of ids) {
            const timer = intentHideTimersRef.current.get(id);
            if (!timer) continue;
            window.clearTimeout(timer);
            intentHideTimersRef.current.delete(id);
        }
    }, []);

    const popoverContainsFocus = useCallback(() => {
        const panel = rootRef.current?.closest<HTMLElement>('.editorPanel');
        const popovers = panel
            ? Array.from(panel.querySelectorAll<HTMLElement>('.annotationFloatingPopover'))
            : [];
        return Boolean(
            document.activeElement instanceof Node &&
                popovers.some((popover) => popover.contains(document.activeElement)),
        );
    }, [rootRef]);

    const focusedPopoverId = useCallback(() => {
        const panel = rootRef.current?.closest<HTMLElement>('.editorPanel');
        if (!(document.activeElement instanceof Node) || !panel) return null;
        const popover = Array.from(
            panel.querySelectorAll<HTMLElement>('.annotationFloatingPopover'),
        ).find((candidate) => candidate.contains(document.activeElement));
        return popover?.dataset.popoverId ?? null;
    }, [rootRef]);

    const schedulePopoverHideFromPointer = useCallback(
        (id?: string, transition?: PopoverPointerTransition) => {
            const relatedTarget = transition?.relatedTarget ?? null;
            setManagedPopovers((current) => {
                if (id && targetIsInsidePopoverSubtree(current, id, relatedTarget)) {
                    const timer = intentHideTimersRef.current.get(id);
                    if (timer) {
                        window.clearTimeout(timer);
                        intentHideTimersRef.current.delete(id);
                    }
                    return current;
                }
                const ids = pointerClearIds(current, id, relatedTarget);
                if (id && transition && pointerLooksTowardPopover(current, id, transition)) {
                    const existingTimer = intentHideTimersRef.current.get(id);
                    if (existingTimer) window.clearTimeout(existingTimer);
                    const timer = window.setTimeout(() => {
                        intentHideTimersRef.current.delete(id);
                        setManagedPopovers((latest) => {
                            if (targetIsInsidePopoverSubtree(latest, id, relatedTarget)) return latest;
                            return pruneClosedPopovers(
                                clearReasons(
                                    latest,
                                    pointerClearIds(latest, id, relatedTarget),
                                    ['hover', 'activation'],
                                ),
                            );
                        });
                    }, 100);
                    intentHideTimersRef.current.set(id, timer);
                    return current;
                }
                cancelPopoverHideForIds(ids);
                return pruneClosedPopovers(clearReasons(current, ids, ['hover', 'activation']));
            });
        },
        [cancelPopoverHideForIds],
    );

    const showPopover = useCallback(
        (id: string, element: HTMLElement, source: ActivePopover['source'] = 'hover') => {
            cancelPopoverHide();
            setManagedPopovers((current) =>
                upsertPopover(current, id, element, source === 'selection' ? 'selection' : 'hover'),
            );
        },
        [cancelPopoverHide],
    );

    const setPopoverFocusPinned = useCallback(
        (focused: boolean, id?: string, _relatedTarget?: EventTarget | null) => {
            cancelPopoverHide();
            if (focused && id) {
                focusedPopoverIdRef.current = id;
                setManagedPopovers((current) =>
                    current.map((popover) => ({
                        ...popover,
                        reasons: {
                            ...popover.reasons,
                            focus: popover.id === id,
                        },
                    })),
                );
                return;
            }

            if (!id || focusedPopoverIdRef.current === id) focusedPopoverIdRef.current = null;
            setManagedPopovers((current) =>
                pruneClosedPopovers(
                    current.map((popover) =>
                        !id || popover.id === id
                            ? {...popover, reasons: {...popover.reasons, focus: false}}
                            : popover,
                    ),
                ),
            );
        },
        [cancelPopoverHide],
    );

    const closeAllPopovers = useCallback(() => {
        cancelPopoverHide();
        setManagedPopovers([]);
        focusedPopoverIdRef.current = null;
    }, [cancelPopoverHide]);

    const closeDeepestPopover = useCallback(() => {
        cancelPopoverHide();
        setManagedPopovers((current) => {
            const active = derivedActivePopovers(current);
            if (!active.length) return current;
            const deepest = active.reduce((selected, candidate) =>
                popoverDepth(current, candidate.id) > popoverDepth(current, selected.id)
                    ? candidate
                    : selected,
            );
            const ids = descendantsOf(current, deepest.id);
            ids.add(deepest.id);
            if (focusedPopoverIdRef.current && ids.has(focusedPopoverIdRef.current)) {
                focusedPopoverIdRef.current = null;
            }
            return pruneClosedPopovers(
                clearReasons(current, ids, ['hover', 'selection', 'focus', 'activation']),
            );
        });
    }, [cancelPopoverHide]);

    const repositionOpenPopovers = useCallback(() => {
        const root = rootRef.current;
        const panel = root?.closest<HTMLElement>('.editorPanel');
        if (!panel) return;

        setManagedPopovers((current) => {
            let changed = false;
            const next: ManagedPopover[] = [];
            for (const popover of current) {
                const anchor = triggerForPopover(panel, popover.id, popover.anchor);
                if (!anchor) {
                    changed = true;
                    continue;
                }
                const position = positionForAnchor(anchor);
                if (
                    anchor !== popover.anchor ||
                    position.top !== popover.top ||
                    position.left !== popover.left
                ) {
                    changed = true;
                    next.push({...popover, anchor, ...position});
                } else {
                    next.push(popover);
                }
            }
            return changed ? next : current;
        });
    }, [rootRef]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const panel = root?.closest<HTMLElement>('.editorPanel');
        const document = root?.ownerDocument;
        if (!panel || !document) return;

        const onMouseDown = (event: globalThis.MouseEvent) => {
            const nodeConstructor = document.defaultView?.Node;
            if (!nodeConstructor || !(event.target instanceof nodeConstructor)) return;
            if (panel.contains(event.target)) return;
            closeAllPopovers();
        };

        document.addEventListener('mousedown', onMouseDown, true);
        return () => document.removeEventListener('mousedown', onMouseDown, true);
    }, [closeAllPopovers, rootRef]);

    useLayoutEffect(() => () => cancelPopoverHide(), [cancelPopoverHide]);

    useLayoutEffect(() => {
        repositionOpenPopovers();
    });

    useLayoutEffect(() => {
        const root = rootRef.current;
        const view = root?.ownerDocument.defaultView;
        if (!view) return;

        view.addEventListener('resize', repositionOpenPopovers);
        view.addEventListener('scroll', repositionOpenPopovers, true);
        return () => {
            view.removeEventListener('resize', repositionOpenPopovers);
            view.removeEventListener('scroll', repositionOpenPopovers, true);
        };
    }, [repositionOpenPopovers, rootRef]);

    useLayoutEffect(() => {
        setManagedPopovers((current) => {
            const withoutSelection = current.map((popover) => ({
                ...popover,
                reasons: {...popover.reasons, selection: false},
            }));
            if (selectedPopoverIds.length) return withoutSelection;
            if (popoverContainsFocus()) return withoutSelection;
            const ids = new Set(withoutSelection.map((popover) => popover.id));
            return pruneClosedPopovers(
                clearReasons(withoutSelection, ids, ['hover', 'activation']),
            );
        });

        if (!selectedPopoverIds.length) return;
        const root = rootRef.current;
        const panel = root?.closest<HTMLElement>('.editorPanel');
        if (!panel) return;
        setManagedPopovers((current) =>
            selectedPopoverIds.reduce((next, id) => {
                const trigger = panel.querySelector<HTMLElement>(triggerSelectorForId(id));
                return trigger ? upsertPopover(next, id, trigger, 'selection') : next;
            }, current),
        );
    }, [
        popoverContainsFocus,
        rootRef,
        selectedPopoverIdsKey,
        selectedPopoverSelectionKey,
    ]);

    return {
        activePopovers,
        cancelPopoverHide,
        focusedPopoverId,
        popoverContainsFocus,
        schedulePopoverHideFromPointer,
        setPopoverFocusPinned,
        showPopover,
        closeAllPopovers,
        closeDeepestPopover,
    };
};
