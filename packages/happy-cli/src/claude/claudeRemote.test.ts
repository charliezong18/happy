import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { query } from '@/claude/sdk';
import { fetchPlanUsageSnapshot } from './utils/planUsageFallback';
import type { EnhancedMode } from './loop';

vi.mock('@/claude/sdk', () => ({
    query: vi.fn(),
    AbortError: class AbortError extends Error {},
}));
vi.mock('./utils/planUsageFallback', () => ({
    fetchPlanUsageSnapshot: vi.fn(),
}));

const mode: EnhancedMode = {
    permissionMode: 'default',
};

describe('claudeRemote', () => {
    beforeEach(() => {
        vi.mocked(query).mockReset();
    });

    it('marks /clear as a completed reset turn', async () => {
        const callbackOrder: string[] = [];
        const onCompletionEvent = vi.fn((message: string) => {
            callbackOrder.push(`event:${message}`);
        });
        const onSessionReset = vi.fn(() => {
            callbackOrder.push('reset');
        });
        const onReady = vi.fn(() => {
            callbackOrder.push('ready');
        });

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => ({
                message: '/clear',
                mode,
            }),
            onReady,
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent,
            onSessionReset,
        });

        expect(onCompletionEvent).toHaveBeenCalledWith('Context was reset');
        expect(onSessionReset).toHaveBeenCalledOnce();
        expect(onReady).toHaveBeenCalledOnce();
        expect(callbackOrder).toEqual(['event:Context was reset', 'reset', 'ready']);
    });

    it('marks assistant messages from /compact as compact summaries', async () => {
        const setPermissionMode = vi.fn();
        vi.mocked(query).mockReturnValue({
            setPermissionMode,
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'assistant',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Long compaction summary' }],
                    },
                };
                yield {
                    type: 'result',
                    subtype: 'success',
                };
            },
        } as any);

        const onMessage = vi.fn();
        let messageCount = 0;

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount === 1
                    ? {
                        message: '/compact',
                        mode,
                    }
                    : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage,
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn(),
        });

        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'assistant',
            isCompactSummary: true,
        }));
    });
});

describe('claudeRemote plan-usage seeding', () => {
    const SNAPSHOT = { five_hour: { utilization: 9, resets_at: '2026-08-04T20:20:00Z' } };

    /** Drives `turns` turns and returns the usage patches they emitted. */
    async function runTurn(inBandUsage: unknown, turns = 1) {
        vi.mocked(query).mockReturnValue({
            setPermissionMode: vi.fn(),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => inBandUsage,
            // One result per turn: the seed runs per result, so a multi-turn
            // case needs the stream to actually produce that many.
            async *[Symbol.asyncIterator]() {
                for (let i = 0; i < turns; i += 1) {
                    yield { type: 'result', subtype: 'success' };
                }
            },
        } as any);
        const patches: any[] = [];
        let messageCount = 0;
        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/happy-test-settings.json',
            nextMessage: async () => {
                messageCount += 1;
                return messageCount <= turns ? { message: 'hi', mode } : null;
            },
            onReady: vi.fn(),
            canCallTool: async () => ({ behavior: 'allow' }) as any,
            isAborted: () => false,
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn(),
            onUsageLimits: (patch: any) => { patches.push(patch); },
        } as any);
        return patches;
    }

    beforeEach(() => {
        vi.mocked(query).mockReset();
        vi.mocked(fetchPlanUsageSnapshot).mockReset();
        process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
        delete process.env.ANTHROPIC_API_KEY;
    });
    afterEach(() => {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    });

    it('falls back out of band when the in-band seed reports no rate limits', async () => {
        vi.mocked(fetchPlanUsageSnapshot).mockResolvedValue(SNAPSHOT);
        const patches = await runTurn({ rate_limits_available: false });

        expect(fetchPlanUsageSnapshot).toHaveBeenCalledOnce();
        expect(patches).toHaveLength(1);
        expect(patches[0].replace).toBe(true);
        expect(patches[0].windows).toContainEqual(expect.objectContaining({ id: 'five_hour', utilization: 9 }));
    });

    it('leaves the fallback alone when the in-band seed already has data', async () => {
        const patches = await runTurn({ rate_limits_available: true, rate_limits: SNAPSHOT });

        expect(fetchPlanUsageSnapshot).not.toHaveBeenCalled();
        expect(patches[0].windows).toContainEqual(expect.objectContaining({ id: 'five_hour', utilization: 9 }));
    });

    it('leaves the fallback alone under an API key, whose quota is not the subscription\'s', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        await runTurn({ rate_limits_available: false });

        expect(fetchPlanUsageSnapshot).not.toHaveBeenCalled();
    });

    it('retries a failed out-of-band pull on the next turn, but not forever', async () => {
        // A blip must not cost the session its percentages until the next reset
        // boundary; an unusable credential must not cost every turn a subprocess.
        vi.mocked(fetchPlanUsageSnapshot).mockResolvedValue(null);
        await runTurn({ rate_limits_available: false }, 4);

        expect(fetchPlanUsageSnapshot).toHaveBeenCalledTimes(2);
    });

    it('does not let a window-less snapshot claim to be a full replace', async () => {
        // A 200 with an unexpected body must not wipe persisted percentages.
        vi.mocked(fetchPlanUsageSnapshot).mockResolvedValue({ unexpected: 'envelope' });
        const patches = await runTurn({ rate_limits_available: false });

        expect(fetchPlanUsageSnapshot).toHaveBeenCalledOnce();
        expect(patches.every(p => !p.replace)).toBe(true);
    });
});
