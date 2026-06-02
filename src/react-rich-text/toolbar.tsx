import {linkValueForRange, rangeHasMark} from './marks.js';
import type {TextRange} from './selection.js';
import type {RichTextBinding} from '../react-crdt/react-crdt.js';

export type ToolbarState = {
    range: TextRange;
    rect: {top: number; left: number; width: number; height: number};
};

type Props = {
    state: ToolbarState;
    view: RichTextBinding['view'];
    onToggleMark(markType: string): void;
    onToggleLink(): void;
};

export function SelectionToolbar({state, view, onToggleMark, onToggleLink}: Props) {
    const top = Math.max(8, state.rect.top - 42);
    const left = Math.max(8, state.rect.left + state.rect.width / 2 - 88);
    return (
        <div
            role="toolbar"
            aria-label="Text formatting"
            onMouseDown={(event) => event.preventDefault()}
            style={{
                position: 'fixed',
                top,
                left,
                zIndex: 10_000,
                display: 'flex',
                gap: 4,
                padding: 4,
                border: '1px solid #d0d7de',
                borderRadius: 6,
                background: '#ffffff',
                boxShadow: '0 6px 18px rgba(27, 31, 36, 0.16)',
            }}
        >
            <ToolbarButton
                label="Bold"
                active={rangeHasMark(view, state.range, 'strong')}
                onClick={() => onToggleMark('strong')}
            >
                B
            </ToolbarButton>
            <ToolbarButton
                label="Italic"
                active={rangeHasMark(view, state.range, 'em')}
                onClick={() => onToggleMark('em')}
            >
                I
            </ToolbarButton>
            <ToolbarButton
                label="Code"
                active={rangeHasMark(view, state.range, 'code')}
                onClick={() => onToggleMark('code')}
            >
                {'<>'}
            </ToolbarButton>
            <ToolbarButton
                label={linkValueForRange(view, state.range) ? 'Remove link' : 'Link'}
                active={rangeHasMark(view, state.range, 'link')}
                onClick={onToggleLink}
            >
                Link
            </ToolbarButton>
        </div>
    );
}

function ToolbarButton({
    active,
    children,
    label,
    onClick,
}: {
    active: boolean;
    children: React.ReactNode;
    label: string;
    onClick(): void;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            style={{
                minWidth: 30,
                height: 28,
                border: '1px solid transparent',
                borderRadius: 4,
                background: active ? '#0969da' : 'transparent',
                color: active ? '#ffffff' : '#24292f',
                font: '600 13px/1 system-ui, sans-serif',
                cursor: 'pointer',
            }}
        >
            {children}
        </button>
    );
}
