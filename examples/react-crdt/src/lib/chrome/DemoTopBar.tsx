import type {AppDefinition} from '../crdtApp';
import {modeOptions} from '../modeOptions';
import type {AppMode} from '../useUrlSelection';
import {useTopBarState} from './TopBarContext';

export function DemoTopBar({
    apps,
    activeAppId,
    setAppId,
    mode,
    setMode,
}: {
    apps: AppDefinition<unknown>[];
    activeAppId: string;
    setAppId(appId: string): void;
    mode: AppMode;
    setMode(mode: AppMode): void;
}) {
    const controls = useTopBarState();

    return (
        <header className="demoTopBar">
            <div className="topBarGroup topBarPrimary">
                <label>
                    <span>App</span>
                    <select
                        value={activeAppId}
                        onChange={(event) => setAppId(event.currentTarget.value)}
                        aria-label="Example app"
                    >
                        {apps.map((app) => (
                            <option key={app.id} value={app.id}>
                                {app.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Architecture</span>
                    <select
                        value={mode}
                        onChange={(event) => setMode(event.currentTarget.value as AppMode)}
                        aria-label="Architecture"
                    >
                        {modeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                {controls.documentPicker}
            </div>
            <div className="topBarGroup topBarActions">
                {controls.seedControls}
                {controls.archiveControls}
                {controls.statusMessage}
            </div>
        </header>
    );
}
