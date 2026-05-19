import type {AppDefinition} from './crdtApp';

export function AppPicker({
    apps,
    activeAppId,
    setAppId,
}: {
    apps: AppDefinition<unknown>[];
    activeAppId: string;
    setAppId(appId: string): void;
}) {
    return (
        <nav className="appPicker" aria-label="Example app">
            {apps.map((app) => (
                <button
                    key={app.id}
                    type="button"
                    className={app.id === activeAppId ? 'active' : ''}
                    onClick={() => setAppId(app.id)}
                >
                    {app.title}
                </button>
            ))}
        </nav>
    );
}
