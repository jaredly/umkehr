export type Artifact = {
    id: string;
};

export type ArtifactManifestEntry = {
    id: string;
    kind: string;
    version: number;
    fingerprintHash: string;
};

export type SerializedArtifact = ArtifactManifestEntry & {
    data: unknown;
};

export type ArtifactStore<TArtifact extends Artifact = Artifact> = {
    get(id: string): TArtifact | null;
    serialize(id: string): SerializedArtifact | null;
    load(artifact: SerializedArtifact): void;
    manifest(): ArtifactManifestEntry[];
};

export function emptyArtifactStore(): ArtifactStore {
    return {
        get() {
            return null;
        },
        serialize() {
            return null;
        },
        load() {},
        manifest() {
            return [];
        },
    };
}

export function artifactManifestForStore(store?: ArtifactStore): ArtifactManifestEntry[] {
    return store?.manifest() ?? [];
}

export function serializedArtifactsForStore(store?: ArtifactStore): SerializedArtifact[] {
    if (!store) return [];
    return store
        .manifest()
        .map((entry) => store.serialize(entry.id))
        .filter((artifact): artifact is SerializedArtifact => artifact !== null);
}

export function loadSerializedArtifacts(
    store: ArtifactStore | undefined,
    artifacts: readonly SerializedArtifact[] | undefined,
) {
    if (!store || !artifacts) return;
    for (const artifact of artifacts) store.load(artifact);
}

export function validateSerializedArtifacts(input: unknown): SerializedArtifact[] | null {
    if (input === undefined) return [];
    if (!Array.isArray(input)) return null;
    const artifacts: SerializedArtifact[] = [];
    const seen = new Set<string>();
    for (const item of input) {
        if (!isRecord(item)) return null;
        const entry = validateArtifactManifestEntry(item);
        if (!entry) return null;
        if (seen.has(entry.id)) return null;
        seen.add(entry.id);
        artifacts.push({...entry, data: item.data});
    }
    return artifacts;
}

export function validateArtifactManifest(input: unknown): ArtifactManifestEntry[] | null {
    if (input === undefined) return [];
    if (!Array.isArray(input)) return null;
    const entries: ArtifactManifestEntry[] = [];
    const seen = new Set<string>();
    for (const item of input) {
        const entry = validateArtifactManifestEntry(item);
        if (!entry) return null;
        if (seen.has(entry.id)) return null;
        seen.add(entry.id);
        entries.push(entry);
    }
    return entries;
}

export function validateArtifactManifestEntry(input: unknown): ArtifactManifestEntry | null {
    if (!isRecord(input)) return null;
    if (typeof input.id !== 'string' || input.id.length === 0) return null;
    if (typeof input.kind !== 'string' || input.kind.length === 0) return null;
    if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
        return null;
    }
    if (typeof input.fingerprintHash !== 'string' || input.fingerprintHash.length === 0) {
        return null;
    }
    return {
        id: input.id,
        kind: input.kind,
        version: input.version,
        fingerprintHash: input.fingerprintHash,
    };
}

export function artifactFingerprintHash(value: unknown): string {
    return fnv1a64(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
}

function fnv1a64(input: string): string {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let index = 0; index < input.length; index++) {
        hash ^= BigInt(input.charCodeAt(index));
        hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
