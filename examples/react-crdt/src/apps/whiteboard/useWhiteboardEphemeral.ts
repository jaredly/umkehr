import {useCallback, useEffect, useRef} from 'react';
import type {EphemeralMessage} from 'umkehr';
import {whiteboardEphemeralKinds, type WhiteboardEphemeralData} from './model';
import type {WhiteboardEditorContext} from './types';

export type PublishWhiteboardEphemeral = (
    messages: EphemeralMessage<WhiteboardEphemeralData>[],
    mode?: 'now' | 'frame',
) => void;

export function useWhiteboardEphemeral(editor: WhiteboardEditorContext) {
    const pendingEphemeralRef = useRef<EphemeralMessage<WhiteboardEphemeralData>[] | null>(null);
    const publishFrameRef = useRef<number | null>(null);
    const remoteEphemeralRecords = editor.useEphemeral({kinds: whiteboardEphemeralKinds});

    const publishEphemeral = useCallback<PublishWhiteboardEphemeral>(
        (messages, mode = 'now') => {
            if (mode === 'now') {
                if (publishFrameRef.current !== null) {
                    cancelAnimationFrame(publishFrameRef.current);
                    publishFrameRef.current = null;
                    pendingEphemeralRef.current = null;
                }
                editor.publishEphemeral(messages);
                return;
            }
            pendingEphemeralRef.current = messages;
            if (publishFrameRef.current !== null) return;
            publishFrameRef.current = requestAnimationFrame(() => {
                publishFrameRef.current = null;
                const pending = pendingEphemeralRef.current;
                pendingEphemeralRef.current = null;
                if (pending) editor.publishEphemeral(pending);
            });
        },
        [editor],
    );

    useEffect(() => {
        return () => {
            if (publishFrameRef.current !== null) cancelAnimationFrame(publishFrameRef.current);
        };
    }, []);

    return {remoteEphemeralRecords, publishEphemeral};
}
