import {todoApp, todoCrdtRuntime, todoHistoryRuntime} from '../apps/todos/TodoApp';

export const registeredApps = [
    {app: todoApp, crdt: todoCrdtRuntime, history: todoHistoryRuntime},
] as const;
export const apps = registeredApps.map((entry) => entry.app);
export const defaultApp = todoApp;
export const defaultCrdtRuntime = todoCrdtRuntime;
export const defaultHistoryRuntime = todoHistoryRuntime;
