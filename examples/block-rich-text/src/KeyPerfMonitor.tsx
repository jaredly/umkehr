import {type CSSProperties} from 'react';

import type {EditorId} from './blockEditorRuntime';

export type KeyPerfSample = {
    id: number;
    editorId: EditorId;
    label: string;
    ms: number;
};

export type KeyPerfSampleInput = Omit<KeyPerfSample, 'id'>;

export const KEY_PERF_SAMPLE_LIMIT = 60;

const KEY_PERF_MAX_BAR_MS = 50;

export function KeyPerfMonitor({
    samples,
    rainbowLamportIds,
    onRainbowLamportIdsChange,
}: {
    samples: KeyPerfSample[];
    rainbowLamportIds: boolean;
    onRainbowLamportIdsChange(value: boolean): void;
}) {
    const latest = samples.at(-1);
    return (
        <aside className="keyPerfMonitor" aria-label="Keypress performance monitor">
            <div className="keyPerfHeader">
                <span>Event ms</span>
                <strong>{latest ? `${formatDuration(latest.ms)} ms` : '-- ms'}</strong>
            </div>
            <div className="keyPerfLatest">{latest ? latest.label : 'No samples'}</div>
            <div className="keyPerfBars" aria-label="Recent keypress durations">
                {samples.map((sample) => {
                    const capped = Math.min(sample.ms, KEY_PERF_MAX_BAR_MS);
                    const height = Math.max(4, (capped / KEY_PERF_MAX_BAR_MS) * 100);
                    return (
                        <span
                            key={sample.id}
                            className={`keyPerfBar ${keyPerfClass(sample.ms)}`}
                            style={{'--key-perf-height': `${height}%`} as CSSProperties}
                            title={`${sample.label}: ${formatDuration(sample.ms)} ms`}
                            data-testid="key-perf-bar"
                        />
                    );
                })}
            </div>
            <label className="keyPerfDebugToggle">
                <input
                    type="checkbox"
                    checked={rainbowLamportIds}
                    onChange={(event) => onRainbowLamportIdsChange(event.currentTarget.checked)}
                />
                <span>Rainbow IDs</span>
            </label>
        </aside>
    );
}

const formatDuration = (ms: number): string => {
    if (ms >= 100) return String(Math.round(ms));
    if (ms >= 10) return ms.toFixed(1);
    return ms.toFixed(2);
};

const keyPerfClass = (ms: number): string => {
    if (ms > 16) return 'slow';
    if (ms >= 8) return 'medium';
    return 'fast';
};
