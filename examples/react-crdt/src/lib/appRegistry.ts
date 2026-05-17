import {todoApp} from '../apps/todos/TodoApp';

export const apps = [todoApp] as const;
export const defaultApp = todoApp;
