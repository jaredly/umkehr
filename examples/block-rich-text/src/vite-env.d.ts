/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_PREVIEW_CORS_PROXY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
