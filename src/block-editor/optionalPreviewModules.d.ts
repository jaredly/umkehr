declare module 'mermaid' {
    const mermaid: {
        initialize(options: {startOnLoad: boolean; securityLevel: string}): void;
        render(id: string, source: string): Promise<{svg: string}>;
    };
    export default mermaid;
}

declare module 'vega-lite' {
    export function compile(spec: unknown): {spec: unknown};
}

declare module 'vega' {
    export function parse(spec: unknown): unknown;
    export class View {
        constructor(runtime: unknown, options: {renderer: string});
        toSVG(): Promise<string>;
        finalize(): Promise<void>;
    }
}

declare module 'yaml' {
    export function parse(source: string): unknown;
}
