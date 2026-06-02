import type {RichTextRenderView} from '../peritext/types.js';

export function RichTextSpanView({span}: {span: RichTextRenderView['spans'][number]}) {
    let content: React.ReactNode = span.text;
    if (span.marks?.code) content = <code>{content}</code>;
    if (span.marks?.em) content = <em>{content}</em>;
    if (span.marks?.strong) content = <strong>{content}</strong>;
    if (typeof span.marks?.link === 'string') content = <a href={span.marks.link}>{content}</a>;
    return <>{content}</>;
}
