import { describe, expect, it } from 'vitest';
import { getAgentPickerItems, getModePickerItems, orderProjectPaths, withRecentPath } from './newSessionPickerItems';
import { resolveAbsolutePath } from './pathUtils';

const HOME = '/Users/me';
// Mirrors normalizePathForComparison in the new-session screen.
const normalize = (path: string): string | null => {
    const trimmed = path.trim();
    if (!trimmed) return null;
    const absolute = resolveAbsolutePath(trimmed, HOME);
    return absolute === '/' ? absolute : absolute.replace(/\/+$/, '');
};

describe('new session picker items', () => {
    it('maps agents to picker item labels', () => {
        expect(getAgentPickerItems([
            { key: 'claude', label: 'claude code' },
            { key: 'codex', label: 'codex' },
        ])).toEqual([
            { key: 'claude', label: 'claude code' },
            { key: 'codex', label: 'codex' },
        ]);
    });

    it('maps model, effort, and permission options with descriptions', () => {
        expect(getModePickerItems([
            { key: 'default', name: 'default model', description: null },
            { key: 'opus', name: 'opus 4.7', description: 'larger context' },
        ])).toEqual([
            { key: 'default', label: 'default model' },
            { key: 'opus', label: 'opus 4.7', subtitle: 'larger context' },
        ]);
    });
});

describe('project path ordering', () => {
    it('offers the last used path first, not the alphabetically first one', () => {
        // The regression: with history alone, '/Users/me' sorts ahead of every
        // project under it, so the screen always defaulted to the home dir.
        expect(orderProjectPaths(
            ['/Users/me/Developer/op'],
            ['/Users/me', '/Users/me/Developer/happy'],
            normalize,
        )).toEqual(['/Users/me/Developer/op', '/Users/me', '/Users/me/Developer/happy']);
    });

    it('keeps history alphabetical and drops entries already listed as recent', () => {
        expect(orderProjectPaths(
            ['~/b'],
            ['/Users/me/c', '/Users/me/a', '/Users/me/b/'],
            normalize,
        )).toEqual(['~/b', '/Users/me/a', '/Users/me/c']);
    });

    it('still lists recents when session history is empty', () => {
        expect(orderProjectPaths(['~/Developer/op'], [], normalize)).toEqual(['~/Developer/op']);
    });
});

describe('recent path bookkeeping', () => {
    it('moves a repeat path back to the front instead of duplicating it', () => {
        expect(withRecentPath(['/Users/me/a', '/Users/me/b'], '~/b', normalize))
            .toEqual(['/Users/me/b', '/Users/me/a']);
    });

    it('stores the normalized form so tilde and trailing-slash variants collapse', () => {
        expect(withRecentPath([], '~/Developer/op/', normalize)).toEqual(['/Users/me/Developer/op']);
    });

    it('caps the list so it cannot grow without bound', () => {
        const many = Array.from({ length: 12 }, (_, i) => `/Users/me/p${i}`);
        const result = withRecentPath(many, '/Users/me/fresh', normalize);
        expect(result).toHaveLength(8);
        expect(result[0]).toBe('/Users/me/fresh');
    });

    it('leaves the list alone when the path is unusable', () => {
        expect(withRecentPath(['/Users/me/a'], '   ', normalize)).toEqual(['/Users/me/a']);
    });
});
