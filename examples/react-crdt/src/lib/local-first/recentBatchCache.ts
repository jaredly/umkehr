export function createRecentBatchCache(limit = 256) {
    const keys: string[] = [];
    const seen = new Set<string>();

    return {
        has(key: string) {
            return seen.has(key);
        },
        add(key: string) {
            if (seen.has(key)) return;
            seen.add(key);
            keys.push(key);
            while (keys.length > limit) {
                const oldest = keys.shift();
                if (oldest) seen.delete(oldest);
            }
        },
        clear() {
            keys.length = 0;
            seen.clear();
        },
    };
}

export function batchKey(docId: string, origin: string, batchId: string) {
    return `${docId}:${origin}:${batchId}`;
}
