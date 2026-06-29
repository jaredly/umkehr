export class BlockEditorSelectionPluginError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'BlockEditorSelectionPluginError';
        this.code = code;
    }
}
