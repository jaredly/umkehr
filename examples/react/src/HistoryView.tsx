import {useCallback, useMemo, useState} from 'react';
import {History} from 'umkehr';

const addToMap = <T,>(map: Record<string | number, T[]>, k: string | number, t: T) => {
    if (!map[k]) map[k] = [t];
    else map[k].push(t);
};

type SizeInfo = {size: number; height: number; skipTo?: {id: string; count: number}};
export const HistoryView = ({
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
}) => {
    // const ref = useRef<HTMLCanvasElement>(null);
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
            if (byParent[pid]?.length > 1) {
                skipTo = undefined;
            }
            sizes[pid] = {size: Math.max(1, size), height, skipTo};
        };
        walk(history.root);
        return {byParent, sizes};
    }, [history]);
    const [previewing, setPreviewing] = useState<null | string>(null);
    const pj = useCallback(
        (id: string) => {
            previewJump(id);
            setPreviewing(id);
        },
        [previewJump],
    );

    const nctx = useMemo(
        () => ({history, byParent, sizes, jump, previewJump: pj, previewing}),
        [history, byParent, sizes, jump, pj, previewing],
    );

    return (
        <div
            className="modal-box flex flex-col w-11/12 max-w-full"
            onMouseLeave={() => {
                clearPreview();
                setPreviewing(null);
            }}
        >
            <h3 className="font-bold text-lg">History</h3>
            <div className="overflow-auto p-5">
                <div style={{position: 'relative'}}>{renderNode(history.root, nctx)}</div>
            </div>
        </div>
    );
};

type NCtx = {
    history: History<unknown, unknown>;
    byParent: Record<string, string[]>;
    sizes: Record<string, SizeInfo>;
    jump: (id: string) => void;
    previewJump: (id: string) => void;
    // clearPreview: () => void;
    previewing: null | string;
};

const renderNode = (id: string, ctx: NCtx) => {
    const oneHeight = 22;
    const {history, byParent, sizes, jump, previewJump} = ctx;

    const self = (
        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}} key={id}>
            {id === history.root ? null : (
                <div
                    style={{
                        marginLeft: -10,
                        width: 10,
                        height: 4,
                        background: '#aaa',
                    }}
                />
            )}
            <button
                ref={(node) => {
                    if (id === history.tip && node) {
                        node.scrollIntoView();
                    }
                }}
                onClick={() => {
                    jump(id);
                }}
                onMouseEnter={() => previewJump(id)}
                style={{
                    zIndex: 5,
                    width: 20,
                    height: oneHeight - 4 * 2,
                    marginBlock: 4,
                    flexShrink: 0,
                    background:
                        ctx.previewing === id ? '#aaf' : id === history.tip ? 'blue' : '#333',
                    border: '2px solid ' + (ctx.previewing === id ? '#eee' : '#aaa'),
                    borderRadius: 10,
                }}
            />
        </div>
    );
    if (!byParent[id]) {
        return self;
    }
    if (sizes[id].skipTo && sizes[id].skipTo.count > 5) {
        return (
            <div
                style={{
                    flexDirection: 'row',
                    display: 'flex',
                    alignItems: 'center',
                }}
                className="flex flex-row items-center"
                key={id}
            >
                {self}
                <div
                    style={{
                        width: 20 * 3,
                        height: 4,
                        // flex: 1,
                        background: '#aaa',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    className="flex items-center justify-center"
                >
                    <div className="bg-base-100 px-1 border-slate-50 border rounded-xl text-xs">
                        {sizes[id].skipTo.count}
                    </div>
                </div>
                {renderNode(sizes[id].skipTo.id, ctx)}
            </div>
        );
    }
    const children = byParent[id];
    const y0 = sizes[children[0]].size / 2;
    const y1 = sizes[children[children.length - 1]].size / 2;
    const lineHeight = sizes[id].size - y0 - y1;
    // sizes[id].size
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
            }}
            className="flex flex-row items-center"
            key={id}
        >
            {self}
            <div
                style={{
                    height: oneHeight * sizes[id].size,
                    paddingTop: y0 * oneHeight,
                    marginLeft: -6,
                    marginRight: 6,
                }}
            >
                <div
                    style={{
                        height: oneHeight * lineHeight,
                        width: 4,
                        background: '#aaa',
                    }}
                ></div>
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                }}
                className="flex flex-col"
            >
                {byParent[id].map((cid) => renderNode(cid, ctx))}
            </div>
        </div>
    );
};
