import {todoApp, todoCrdtRuntime, todoHistoryRuntime} from '../apps/todos/TodoApp';
import {
    whiteboardApp,
    whiteboardCrdtRuntime,
    whiteboardHistoryRuntime,
} from '../apps/whiteboard/WhiteboardApp';

export const registeredApps = [
    {app: todoApp, crdt: todoCrdtRuntime, history: todoHistoryRuntime},
    {app: whiteboardApp, crdt: whiteboardCrdtRuntime, history: whiteboardHistoryRuntime},
] as const;
export const apps = registeredApps.map((entry) => entry.app);
export const defaultApp = todoApp;
export const defaultCrdtRuntime = todoCrdtRuntime;
export const defaultHistoryRuntime = todoHistoryRuntime;

export function registeredAppForId(id: string) {
    return registeredApps.find((entry) => entry.app.id === id) ?? registeredApps[0];
}
