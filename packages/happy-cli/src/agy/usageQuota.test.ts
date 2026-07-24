import { describe, expect, it } from 'vitest';

import { AGY_EXTERNAL_WINDOW_ID, AGY_GEMINI_WINDOW_ID, windowsFromAgyQuota } from './usageQuota';

/** Shape captured from a live retrieveUserQuota response (2026-07-23). */
const SAMPLE = {
    buckets: [
        { tokenType: 'WTUS', modelId: 'chat_20706', remainingFraction: 1 },
        { tokenType: 'WTUS', modelId: 'tab_flash_lite_preview', remainingFraction: 1 },
        { tokenType: 'WTUS', modelId: 'gemini-3.1-pro-high', remainingFraction: 0.9899, resetTime: '2026-07-24T10:05:05Z' },
        { tokenType: 'WTUS', modelId: 'gemini-2.5-flash', remainingFraction: 0.9899, resetTime: '2026-07-24T10:05:05Z' },
        { tokenType: 'WTUS', modelId: 'claude-opus-4-6-thinking', remainingFraction: 1, resetTime: '2026-07-24T10:22:35Z' },
        { tokenType: 'WTUS', modelId: 'gpt-oss-120b-medium', remainingFraction: 1, resetTime: '2026-07-24T10:22:35Z' },
    ],
};

describe('windowsFromAgyQuota', () => {
    it('collapses per-model buckets into one window per family', () => {
        const windows = windowsFromAgyQuota(SAMPLE);
        expect(windows.map(w => w.id)).toEqual([AGY_GEMINI_WINDOW_ID, AGY_EXTERNAL_WINDOW_ID]);
    });

    it('converts remaining fraction to percent used', () => {
        const gemini = windowsFromAgyQuota(SAMPLE).find(w => w.id === AGY_GEMINI_WINDOW_ID);
        expect(gemini?.utilization).toBe(1);
        expect(gemini?.status).toBe('allowed');
    });

    it('converts the ISO reset time to epoch milliseconds', () => {
        const gemini = windowsFromAgyQuota(SAMPLE).find(w => w.id === AGY_GEMINI_WINDOW_ID);
        expect(gemini?.resetsAt).toBe(Date.parse('2026-07-24T10:05:05Z'));
    });

    it('reports the binding bucket when a family disagrees', () => {
        const windows = windowsFromAgyQuota({
            buckets: [
                { modelId: 'gemini-3.1-pro-high', remainingFraction: 0.8, resetTime: '2026-07-24T10:00:00Z' },
                { modelId: 'gemini-2.5-flash', remainingFraction: 0.2, resetTime: '2026-07-24T12:00:00Z' },
            ],
        });
        expect(windows[0].utilization).toBe(80);
        expect(windows[0].resetsAt).toBe(Date.parse('2026-07-24T10:00:00Z'));
    });

    it('drops buckets without a reset time, which carry no real limit', () => {
        const windows = windowsFromAgyQuota({
            buckets: [{ modelId: 'chat_20706', remainingFraction: 1 }],
        });
        expect(windows).toEqual([]);
    });

    it('keeps gpt-oss out of the Gemini pool', () => {
        const windows = windowsFromAgyQuota({
            buckets: [{ modelId: 'gpt-oss-120b-medium', remainingFraction: 0.5, resetTime: '2026-07-24T10:00:00Z' }],
        });
        expect(windows.map(w => w.id)).toEqual([AGY_EXTERNAL_WINDOW_ID]);
    });

    it('flags an exhausted pool as rejected', () => {
        const windows = windowsFromAgyQuota({
            buckets: [{ modelId: 'gemini-3.1-pro-high', remainingFraction: 0, resetTime: '2026-07-24T10:00:00Z' }],
        });
        expect(windows[0].utilization).toBe(100);
        expect(windows[0].status).toBe('rejected');
    });

    it('returns nothing for an empty or malformed response', () => {
        expect(windowsFromAgyQuota(null)).toEqual([]);
        expect(windowsFromAgyQuota({})).toEqual([]);
        expect(windowsFromAgyQuota({ buckets: [] })).toEqual([]);
    });
});
