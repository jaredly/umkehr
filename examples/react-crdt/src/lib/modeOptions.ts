import type {AppMode} from './useUrlSelection';

export const modeOptions: {value: AppMode; label: string}[] = [
    {value: 'solo', label: 'Solo'},
    {value: 'local', label: 'Local'},
    {value: 'peerjs', label: 'PeerJS'},
    {value: 'local-first', label: 'Local-first'},
    {value: 'server', label: 'Server'},
];
