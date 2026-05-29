import {describe, expect, it} from 'vitest';
import {apps, registeredAppForId, routeIdForRegisteredApp} from './appRegistry';

describe('app registry', () => {
    it('allows @ versions in URL app ids without changing AppDefinition.id', () => {
        const registered = registeredAppForId('todos@1');
        expect(registered.app.id).toBe('todos');
        expect(routeIdForRegisteredApp(registered)).toBe('todos@1');
        expect(apps.map((app) => app.id)).toContain('todos@3');
    });
});
