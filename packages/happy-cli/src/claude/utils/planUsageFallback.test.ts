import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
    // The module under test calls promisify(execFile) at import time, so the
    // custom-promisify symbol has to be attached before then; it delegates to a
    // swappable impl so individual tests can still change the behaviour.
    const impl: { run: () => Promise<{ stdout: string, stderr: string }> } = {
        run: async () => ({ stdout: '', stderr: '' }),
    };
    const execFile = Object.assign(vi.fn(), {
        [Symbol.for('nodejs.util.promisify.custom')]: () => impl.run(),
    });
    return { execFile, impl };
});
// Spread the real module: other importers in this graph need `exec`.
vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(),
    execFile: mocks.execFile,
}));

import { usableAccessToken, fetchPlanUsageSnapshot } from './planUsageFallback';
import { windowsFromGetUsage } from './usageLimits';

const NOW = Date.parse('2026-08-04T18:30:00Z');
const blob = (oauth: unknown) => ({ claudeAiOauth: oauth });

describe('usableAccessToken', () => {
    it('returns the token when the credential is still valid', () => {
        expect(usableAccessToken(blob({ accessToken: 'tok', expiresAt: NOW + 3_600_000 }), NOW)).toBe('tok');
    });

    it('rejects an expired credential instead of signalling a refresh', () => {
        expect(usableAccessToken(blob({ accessToken: 'tok', expiresAt: NOW - 1 }), NOW)).toBeNull();
    });

    it('rejects a credential inside the expiry grace window', () => {
        // Racing a token that dies mid-request buys nothing, and refreshing it
        // is the one thing this module must never do.
        expect(usableAccessToken(blob({ accessToken: 'tok', expiresAt: NOW + 30_000 }), NOW)).toBeNull();
    });

    it('rejects malformed payloads rather than throwing', () => {
        for (const bad of [null, undefined, 'string', {}, blob(null), blob({ accessToken: 'tok' }),
            blob({ expiresAt: NOW + 3_600_000 }), blob({ accessToken: '', expiresAt: NOW + 3_600_000 }),
            blob({ accessToken: 'tok', expiresAt: 'soon' })]) {
            expect(usableAccessToken(bad, NOW)).toBeNull();
        }
    });
});

describe('fetchPlanUsageSnapshot', () => {
    const fetchMock = vi.fn();

    const keychainReturns = (payload: unknown) => {
        mocks.impl.run = async () => ({ stdout: JSON.stringify(payload), stderr: '' });
    };
    const keychainFails = () => {
        mocks.impl.run = async () => {
            throw new Error('The specified item could not be found in the keychain.');
        };
    };
    const respondsWith = (body: unknown, ok = true, status = 200) =>
        fetchMock.mockResolvedValue({ ok, status, json: async () => body });

    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        keychainReturns({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 3_600_000 } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        fetchMock.mockReset();
    });

    it('returns the snapshot body on success', async () => {
        respondsWith({ five_hour: { utilization: 9, resets_at: null } });
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toEqual({ five_hour: { utilization: 9, resets_at: null } });
    });

    it('only ever issues a single read against the usage endpoint', async () => {
        // Fossilizes the read-only constraint: any future "helpful" token
        // refresh would have to POST somewhere else and fails here first.
        respondsWith({ five_hour: { utilization: 9, resets_at: null } });
        await fetchPlanUsageSnapshot(NOW);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
        expect(init.method ?? 'GET').toBe('GET');
        expect(init.body).toBeUndefined();
    });

    it('returns null for non-200, non-object and array bodies', async () => {
        respondsWith({ error: 'nope' }, false, 500);
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toBeNull();
        respondsWith([{ five_hour: null }]);
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toBeNull();
        respondsWith('<html>gateway timeout</html>');
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toBeNull();
    });

    it('returns null without fetching when no credential is readable', async () => {
        keychainFails();
        respondsWith({ five_hour: { utilization: 9, resets_at: null } });
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null without touching the Keychain off macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        await expect(fetchPlanUsageSnapshot(NOW)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    describe('against payloads captured from the real endpoint on 2026-08-04', () => {
        // Hand-written fixtures encode the shape you assumed; these encode the
        // shape the backend actually sent. Two blockers were once proposed
        // against this path — that `expiresAt` might be in seconds, and that
        // the body might be wrapped in a `rate_limits` envelope. Both were
        // false, and both would have been caught here rather than by argument.
        const KEYCHAIN_BLOB = {
            claudeAiOauth: {
                accessToken: 'sk-ant-oat01-REDACTED',
                refreshToken: 'sk-ant-ort01-REDACTED',
                expiresAt: 1785889612537, // 13 digits: epoch MILLISECONDS
                scopes: ['user:file_upload', 'user:inference', 'user:mcp_servers', 'user:profile', 'user:sessions:claude_code'],
            },
        };
        const USAGE_BODY = {
            five_hour: { utilization: 26.0, resets_at: '2026-08-04T20:20:00.380619+00:00', limit_dollars: null },
            seven_day: { utilization: 74.0, resets_at: '2026-08-07T01:00:00.750913+00:00', limit_dollars: null },
            seven_day_oauth_apps: null,
            seven_day_opus: null,
            seven_day_sonnet: null,
            tangelo: null,
            extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 0.0, utilization: null },
            limits: [
                { kind: 'session', group: 'session', percent: 26, resets_at: '2026-08-04T20:20:00.380619+00:00', scope: null, is_active: false },
                { kind: 'weekly_all', group: 'weekly', percent: 74, resets_at: '2026-08-07T01:00:00.750913+00:00', scope: null, is_active: false },
                { kind: 'weekly_scoped', group: 'weekly', percent: 88, resets_at: '2026-08-07T00:59:59.751161+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
            ],
            spend: { used: { amount_minor: 0 }, limit: { amount_minor: 2000 }, percent: 0 },
            member_dashboard_available: false,
        };

        it('accepts the real credential shape — expiresAt is milliseconds, not seconds', () => {
            const capturedAt = 1785889612537 - 3_600_000;
            expect(usableAccessToken(KEYCHAIN_BLOB, capturedAt)).toBe('sk-ant-oat01-REDACTED');
            // Were the field ever seconds, the same value would read as far
            // future and this guard would silently never reject anything.
            expect(String(KEYCHAIN_BLOB.claudeAiOauth.expiresAt)).toHaveLength(13);
        });

        it('carries the real body end to end into numbered chips', async () => {
            keychainReturns(KEYCHAIN_BLOB);
            respondsWith(USAGE_BODY);

            const snapshot = await fetchPlanUsageSnapshot(1785889612537 - 3_600_000);
            expect(snapshot).not.toBeNull();
            // No `rate_limits` envelope: the buckets sit at the top level.
            expect(snapshot).toHaveProperty('five_hour');
            expect(snapshot).not.toHaveProperty('rate_limits');

            const windows = windowsFromGetUsage(snapshot!);
            const byId = Object.fromEntries(windows.map(w => [w.id, w]));
            expect(Object.keys(byId).sort()).toEqual(
                expect.arrayContaining(['five_hour', 'seven_day', 'weekly_fable']));
            expect(byId.five_hour.utilization).toBe(26);
            expect(byId.seven_day.utilization).toBe(74);
            expect(byId.weekly_fable.utilization).toBe(88);
            expect(byId.weekly_fable.label).toBe('Fable');
            // Billing state and the unscoped duplicates must not become chips.
            expect(byId).not.toHaveProperty('extra_usage');
            expect(byId).not.toHaveProperty('spend');
            expect(windows.filter(w => w.id.startsWith('session'))).toHaveLength(0);
        });
    });
});
