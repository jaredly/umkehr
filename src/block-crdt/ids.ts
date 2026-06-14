import {Lamport} from './types.js';

export const lamportToString = (lamport: Lamport) => {
    validateLamport(lamport);
    return `${lamport[0].toString().padStart(4, '0')}-${lamport[1]}`;
};

export const parseLamportString = (raw: string) => {
    const separator = raw.indexOf('-');
    if (separator <= 0 || raw.indexOf('-', separator + 1) !== -1) {
        throw new Error(`invalid lamport id ${raw}`);
    }
    const count = raw.slice(0, separator);
    const id = raw.slice(separator + 1);
    if (!/^\d+$/.test(count)) {
        throw new Error(`invalid lamport counter ${count}`);
    }
    assertActorId(id);
    return [parseInt(count, 10), id] as Lamport;
};

export const assertActorId = (actorId: string) => {
    if (!actorId || actorId.includes('-')) {
        throw new Error(`actor id must be non-empty and must not contain '-'`);
    }
};

export const validateLamport = (lamport: Lamport) => {
    if (!Number.isInteger(lamport[0]) || lamport[0] < 0) {
        throw new Error(`lamport counter must be a non-negative integer`);
    }
    assertActorId(lamport[1]);
};

export const compareLamports = (one: Lamport, two: Lamport) =>
    one[0] === two[0] ? one[1].localeCompare(two[1]) : one[0] - two[0];

export const compareLamportStrings = (one: string, two: string) =>
    compareLamports(parseLamportString(one), parseLamportString(two));
