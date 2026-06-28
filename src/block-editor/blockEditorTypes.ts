import type {BareInlineMark, CodeTargetRange, LinkTargetRange} from './inlineMarks';

export type PendingInlineMarks = Partial<Record<BareInlineMark, boolean>>;

export type LinkPopoverState = {
    ranges: LinkTargetRange[];
    href: string;
    top: number;
    left: number;
};

export type LinkHoverPopoverState = LinkPopoverState;

export type CodePopoverState = {
    ranges: CodeTargetRange[];
    language: string;
    top: number;
    left: number;
};

export type CodeHoverPopoverState = CodePopoverState;

export type EmbedPopoverState = {
    charId: string;
    type: string;
    value: string;
    top: number;
    left: number;
};

export type BlockTypeMenuValue =
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'unordered'
    | 'ordered'
    | 'todo'
    | 'blockquote'
    | 'code'
    | 'mermaid'
    | 'vega-lite'
    | 'callout-info'
    | 'callout-warning'
    | 'callout-error'
    | 'recipe-ingredient'
    | 'table'
    | 'columns'
    | 'card-columns'
    | 'slide-deck'
    | 'slide'
    | 'preview'
    | 'poll-rating'
    | 'poll-children'
    | 'poll-matrix'
    | 'poll-long';
