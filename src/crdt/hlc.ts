/**
 * This implementation of the [Hybric Logical Clocks][1] paper was very much based
 * on [this go implementation][2] and [james long's demo][3]
 *
 * [1]: https://muratbuffalo.blogspot.com/2014/07/hybrid-logical-clocks.html
 * [2]: https://github.com/lafikl/hlc/blob/master/hlc.go
 * [3]: https://github.com/jlongster/crdt-example-app/blob/master/shared/timestamp.js
 */

export type HLC = {
    ts: number;
    count: number;
    node: string;
    suffix?: string;
};

export const pack = ({ts, count, node, suffix}: HLC) => {
    // 13 digits is enough for the next 100 years, so this is probably fine
    const base =
        ts.toString().padStart(15, '0') + ':' + count.toString(36).padStart(5, '0') + ':' + node;
    return suffix === undefined ? base : `${base}~${suffix}`;
};

export const unpack = (serialized: string) => {
    const [ts, count, ...node] = serialized.split(':');
    const {node: nodeId, suffix} = unpackNodeAndSuffix(node.join(':'));
    return {
        ts: parseInt(ts, 10),
        count: parseInt(count, 36),
        node: nodeId,
        ...(suffix === undefined ? {} : {suffix}),
    };
};

export function tryUnpack(serialized: string): HLC | null {
    const unpacked = unpack(serialized);
    return isValid(unpacked) && pack(unpacked) === serialized ? unpacked : null;
}

export function isValid(time: HLC) {
    return (
        Number.isSafeInteger(time.ts) &&
        time.ts >= 0 &&
        Number.isSafeInteger(time.count) &&
        time.count >= 0 &&
        time.count < Math.pow(36, 5) &&
        time.node.length > 0 &&
        (time.suffix === undefined || isValidSuffix(time.suffix))
    );
}

export function withSuffix(timestamp: string, suffix: string) {
    const unpacked = unpack(timestamp);
    if (!isValid(unpacked)) throw new Error(`Cannot suffix invalid HLC timestamp "${timestamp}".`);
    if (!isValidSuffix(suffix)) throw new Error(`Invalid HLC timestamp suffix "${suffix}".`);
    return pack({...unpacked, suffix});
}

export function withoutSuffix(timestamp: string) {
    const {suffix: _suffix, ...unpacked} = unpack(timestamp);
    return pack(unpacked);
}

export const init = (node: string, now: number): HLC => ({
    ts: now,
    count: 0,
    node,
});

export const cmp = (one: HLC, two: HLC) => {
    if (one.ts == two.ts) {
        if (one.count === two.count) {
            if (one.node === two.node) {
                return compareSuffixes(one.suffix, two.suffix);
            }
            return one.node < two.node ? -1 : 1;
        }
        return one.count - two.count;
    }
    return one.ts - two.ts;
};

export const inc = (local: HLC, now: number): HLC => {
    if (now > local.ts) {
        return {ts: now, count: 0, node: local.node};
    }

    return {...local, count: local.count + 1};
};

export const recv = (local: HLC, remote: HLC, now: number): HLC => {
    if (now > local.ts && now > remote.ts) {
        return {...local, ts: now, count: 0};
    }

    if (local.ts === remote.ts) {
        return {...local, count: Math.max(local.count, remote.count) + 1};
    } else if (local.ts > remote.ts) {
        return {...local, count: local.count + 1};
    } else {
        return {...local, ts: remote.ts, count: remote.count + 1};
    }
};

// This impl is closer to the article's algorithm, but I find it a little trickier to explain.
// export const recv = (time: HLC, remote: HLC, now: number): HLC => {
//     const node = time.node;
//     const ts = Math.max(time.ts, remote.ts, now);
//     if (ts == time.ts && ts == remote.ts) {
//         return { node, ts, count: Math.max(time.count, remote.count) + 1 };
//     }
//     if (ts == time.ts) {
//         return { node, ts, count: time.count + 1 };
//     }
//     if (ts == remote.ts) {
//         return { node, ts, count: remote.count + 1 };
//     }
//     return { node, ts, count: 0 };
// };

const validate = (time: HLC, now: number, maxDrift: number = 60 * 1000) => {
    if (time.count >= Math.pow(36, 5)) {
        return 'counter-overflow';
    }
    // if a timestamp is more than 1 minute off from our local wall clock, something has gone horribly wrong.
    if (Math.abs(time.ts - now) > maxDrift) {
        return 'clock-off';
    }
    return null;
};

function unpackNodeAndSuffix(input: string) {
    const suffixMarker = input.lastIndexOf('~');
    if (suffixMarker === -1) return {node: input, suffix: undefined};
    return {
        node: input.slice(0, suffixMarker),
        suffix: input.slice(suffixMarker + 1),
    };
}

function compareSuffixes(a: string | undefined, b: string | undefined) {
    if (a === b) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return a < b ? -1 : 1;
}

function isValidSuffix(input: string) {
    return /^[0-9A-Za-z._-]+$/.test(input);
}
