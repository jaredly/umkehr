import {useRef} from 'react';

export const useLatest = <T,>(value: T) => {
    const latest = useRef(value);
    latest.current = value;
    return latest;
};
