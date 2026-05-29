import type {PeerOptions} from 'peerjs';

export function peerOptions(): PeerOptions {
    const host = import.meta.env.VITE_UMKEHR_PEERJS_HOST?.trim();
    const port = Number(import.meta.env.VITE_UMKEHR_PEERJS_PORT ?? 0);
    const path = import.meta.env.VITE_UMKEHR_PEERJS_PATH?.trim();
    const secureValue = import.meta.env.VITE_UMKEHR_PEERJS_SECURE?.trim().toLowerCase();
    const secure =
        secureValue === 'true' ? true : secureValue === 'false' ? false : undefined;

    return {
        debug: 1,
        ...(host ? {host} : {}),
        ...(Number.isFinite(port) && port > 0 ? {port} : {}),
        ...(path ? {path} : {}),
        ...(secure !== undefined ? {secure} : {}),
    };
}
