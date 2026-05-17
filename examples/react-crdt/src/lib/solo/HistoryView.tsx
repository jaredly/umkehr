import {useCallback, useMemo, useState} from 'react';
import type {History} from 'umkehr';

const addToMap = <T,>(map: Record<string | number, T[]>, key: string | number, value: T) => {
    if (!map[key]) map[key] = [value];
    else map[key].push(value);
};

type SizeInfo = {size: number; height: number; skipTo?: {id: string; count: number}};

export function HistoryView({
    history,
    jump,
    previewJump,
    clearPreview,
    collapseUnannotated,
}: {
    jump(id: string): void;
    previewJump(id: string): void;
    clearPreview(): void;
    history: History<unknown, unknown>;
    collapseUnannotated?: boolean;
}) {
    const {byParent, sizes} = useMemo(() => {
        const byParent: Record<string, string[]> = {};
        Object.values(history.nodes).forEach((node) => {
            if (node.pid === node.id) return;
            addToMap(byParent, node.pid, node.id);
        });

        const sizes: Record<string, SizeInfo> = {};
        const walk = (pid: string) => {
            let size = 0;
            let height = 1;
            let skipTo: undefined | {id: string; count: number};

            byParent[pid]?.forEach((id) => {
                walk(id);
                size += sizes[id].size;
                height = Math.max(height, 1 + sizes[id].height);
                if (
                    collapseUnannotated &&
                    sizes[id].skipTo &&
                    !history.annotations[id] &&
                    id !== history.tip
                ) {
                    skipTo = {...sizes[id].skipTo};
                    skipTo.count++;
                } else {
                    skipTo = {id, count: 1};
                }
            });

            if (byParent[pid]?.length > 1) skipTo = undefined;
            sizes[pid] = {size: Math.max(1, size), height, skipTo};
        };

        walk(history.root);
        return {byParent, sizes};
    }, [collapseUnannotated, history]);

    const [previewing, setPreviewing] = useState<null | string>(null);
    const preview = useCallback(
        (id: string) => {
            previewJump(id);
            setPreviewing(id);
        },
        [previewJump],
    );

    const context = useMemo(
        () => ({history, byParent, sizes, jump, previewJump: preview, previewing}),
        [history, byParent, sizes, jump, preview, previewing],
    );

    return (
        <div
            className="historyView"
            onMouseLeave={() => {
                clearPreview();
                setPreviewing(null);
            }}
        >
            <h2>History</h2>
            <div className="historyScroller">
                <div className="historyTree">{renderNode(history.root, context)}</div>
            </div>
        </div>
    );
}

type RenderContext = {
    history: History<unknown, unknown>;
    byParent: Record<string, string[]>;
    sizes: Record<string, SizeInfo>;
    jump: (id: string) => void;
    previewJump: (id: string) => void;
    previewing: null | string;
};

function renderNode(id: string, context: RenderContext) {
    const oneHeight = 22;
    const {history, byParent, sizes, jump, previewJump} = context;

    const self = (
        <div className="historyNodeRow" key={id}>
            {id === history.root ? null : <div className="historyNodeStem" />}
            <button
                ref={(node) => {
                    if (id === history.tip && node) node.scrollIntoView();
                }}
                aria-label={id === history.tip ? 'Current history point' : 'Jump to history point'}
                className={
                    context.previewing === id
                        ? 'historyNode previewing'
                        : id === history.tip
                          ? 'historyNode current'
                          : 'historyNode'
                }
                onClick={() => jump(id)}
                onMouseEnter={() => previewJump(id)}
                type="button"
            />
        </div>
    );

    if (!byParent[id]) return self;

    if (sizes[id].skipTo && sizes[id].skipTo.count > 5) {
        return (
            <div className="historyBranch" key={id}>
                {self}
                <div className="historySkip">
                    <span>{sizes[id].skipTo.count}</span>
                </div>
                {renderNode(sizes[id].skipTo.id, context)}
            </div>
        );
    }

    const children = byParent[id];
    const y0 = sizes[children[0]].size / 2;
    const y1 = sizes[children[children.length - 1]].size / 2;
    const lineHeight = sizes[id].size - y0 - y1;

    return (
        <div className="historyBranch" key={id}>
            {self}
            <div
                className="historyBranchLineWrap"
                style={{
                    height: oneHeight * sizes[id].size,
                    paddingTop: y0 * oneHeight,
                }}
            >
                <div
                    className="historyBranchLine"
                    style={{
                        height: oneHeight * lineHeight,
                    }}
                />
            </div>
            <div className="historyChildren">
                {byParent[id].map((childId) => renderNode(childId, context))}
            </div>
        </div>
    );
}
