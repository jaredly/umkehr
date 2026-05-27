export type TabLock =
    | {
          kind: 'acquired';
          release(): void;
      }
    | {
          kind: 'blocked';
          message: string;
      };

type LockLike = unknown;
type LockManagerLike = {
    request<T>(
        name: string,
        options: {mode: 'exclusive'; ifAvailable: true},
        callback: (lock: LockLike | null) => Promise<T> | T,
    ): Promise<T>;
};

export async function acquireReplicaTabLock(docId: string, replicaId: string): Promise<TabLock> {
    const locks = navigatorWithLocks().locks;
    if (!locks) {
        return {
            kind: 'blocked',
            message:
                'This browser does not expose the Web Locks API needed to protect this IndexedDB replica from multiple tabs.',
        };
    }

    const name = `umkehr-local-first:${docId}:${replicaId}`;
    let release: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });

    const granted = new Promise<TabLock>((resolve, reject) => {
        locks
            .request(name, {mode: 'exclusive', ifAvailable: true}, async (lock) => {
                if (!lock) {
                    resolve({
                        kind: 'blocked',
                        message:
                            'This local-first replica is already open in another tab. Close that tab before editing here.',
                    });
                    return;
                }

                resolve({
                    kind: 'acquired',
                    release() {
                        release?.();
                    },
                });
                await released;
            })
            .catch(reject);
    });

    return granted;
}

function navigatorWithLocks() {
    return navigator as Navigator & {locks?: LockManagerLike};
}
