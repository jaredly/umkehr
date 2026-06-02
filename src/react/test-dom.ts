import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
});

Object.defineProperties(globalThis, {
    window: {value: dom.window, configurable: true},
    document: {value: dom.window.document, configurable: true},
    navigator: {value: dom.window.navigator, configurable: true},
    HTMLElement: {value: dom.window.HTMLElement, configurable: true},
    HTMLButtonElement: {value: dom.window.HTMLButtonElement, configurable: true},
    HTMLInputElement: {value: dom.window.HTMLInputElement, configurable: true},
    InputEvent: {value: dom.window.InputEvent, configurable: true},
    Node: {value: dom.window.Node, configurable: true},
    MutationObserver: {value: dom.window.MutationObserver, configurable: true},
});

globalThis.requestAnimationFrame ??= (callback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
