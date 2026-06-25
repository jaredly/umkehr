import {useLayoutEffect, useState} from 'react';

import type {CodeTargetRange} from './inlineMarks';
import type {
    CodeHoverPopoverState,
    CodePopoverState,
    EmbedPopoverState,
    LinkHoverPopoverState,
    LinkPopoverState,
} from './blockEditorTypes';

export function LinkFloatingPopover({
    state,
    onApply,
    onRemove,
    onClose,
}: {
    state: LinkPopoverState | null;
    onApply(href: string): void;
    onRemove(): void;
    onClose(): void;
}) {
    const [href, setHref] = useState('');

    useLayoutEffect(() => {
        setHref(state?.href ?? '');
    }, [state?.href]);

    if (!state) return null;

    return (
        <form
            className="linkFloatingPopover"
            role="dialog"
            aria-label="Link"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(href);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                value={href}
                autoFocus
                aria-label="Link target"
                onChange={(event) => setHref(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
            <button type="button" onClick={onRemove}>
                Remove
            </button>
        </form>
    );
}

export function DateEmbedFloatingPopover({
    state,
    onApply,
    onClose,
}: {
    state: EmbedPopoverState | null;
    onApply(value: string): void;
    onClose(): void;
}) {
    const [value, setValue] = useState('');

    useLayoutEffect(() => {
        setValue(state?.value ?? '');
    }, [state?.value]);

    if (!state) return null;

    return (
        <form
            className="embedFloatingPopover"
            role="dialog"
            aria-label="Date embed"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(value);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                type="date"
                value={value}
                autoFocus
                aria-label="Date value"
                onChange={(event) => setValue(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
        </form>
    );
}

export function LinkHoverPopover({
    state,
    onEdit,
    onMouseEnter,
    onMouseLeave,
}: {
    state: LinkHoverPopoverState | null;
    onEdit(state: LinkPopoverState): void;
    onMouseEnter(): void;
    onMouseLeave(): void;
}) {
    if (!state) return null;
    const targetHref = state.href.trim();

    return (
        <div
            className="linkHoverPopover"
            role="dialog"
            aria-label="Link actions"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <a className="linkHoverUrl" href={targetHref} target="_blank" rel="noreferrer">
                {state.href}
            </a>
            <button type="button" onClick={() => onEdit(state)}>
                Edit
            </button>
        </div>
    );
}

export function CodeFloatingPopover({
    state,
    onApply,
    onClearLanguage,
    onRemove,
    onClose,
}: {
    state: CodePopoverState | null;
    onApply(language: string, ranges: CodeTargetRange[]): void;
    onClearLanguage(ranges: CodeTargetRange[]): void;
    onRemove(ranges: CodeTargetRange[]): void;
    onClose(): void;
}) {
    const [language, setLanguage] = useState('');

    useLayoutEffect(() => {
        if (state) setLanguage(state.language);
    }, [state?.language]);

    if (!state) return null;

    return (
        <form
            className="linkFloatingPopover codeFloatingPopover"
            role="dialog"
            aria-label="Inline code language"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(language, state.ranges);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                value={language}
                name="language"
                autoFocus
                aria-label="Code language"
                placeholder="language"
                onChange={(event) => setLanguage(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
            <button type="button" onClick={() => onClearLanguage(state.ranges)}>
                Clear language
            </button>
            <button type="button" onClick={() => onRemove(state.ranges)}>
                Remove code
            </button>
        </form>
    );
}

export function CodeHoverPopover({
    state,
    onEdit,
    onMouseEnter,
    onMouseLeave,
}: {
    state: CodeHoverPopoverState | null;
    onEdit(state: CodePopoverState): void;
    onMouseEnter(): void;
    onMouseLeave(): void;
}) {
    if (!state) return null;

    return (
        <div
            className="linkHoverPopover codeHoverPopover"
            role="dialog"
            aria-label="Inline code actions"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <span className="codeHoverLanguage">{state.language || 'No language'}</span>
            <button type="button" onClick={() => onEdit(state)}>
                Edit
            </button>
        </div>
    );
}
