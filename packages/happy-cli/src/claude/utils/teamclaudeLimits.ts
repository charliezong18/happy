/**
 * Fallback usage-limit source for sessions routed through a teamclaude proxy
 * (github.com/KarpelesLab — multi-account Claude proxy with quota rotation).
 *
 * Plan rate limits are unavailable from the Claude SDK when ANTHROPIC_API_KEY
 * is set (API-key sessions), which is exactly how teamclaude/claude-code-router
 * setups run. teamclaude tracks per-account 5h/7d utilization itself and
 * exposes it on /teamclaude/status, so we read the current account's quota
 * from there instead.
 */

import axios from 'axios';
import type { UsageLimits } from '@/api/types';

const DEFAULT_STATUS_URL = 'http://localhost:3456/teamclaude/status';

type TeamclaudeQuota = {
    unified5h?: number | null;
    unified7d?: number | null;
    unified5hReset?: number | null;
    unified7dReset?: number | null;
};

type TeamclaudeStatus = {
    currentAccount?: string;
    accounts?: Array<{ name?: string; quota?: TeamclaudeQuota }>;
};

function toWindow(utilization: number | null | undefined, resetMs: number | null | undefined) {
    if (utilization === null || utilization === undefined) {
        return null;
    }
    return {
        utilization: Math.round(utilization * 100),
        resetsAt: typeof resetMs === 'number' ? new Date(resetMs).toISOString() : null,
    };
}

/**
 * Fetch the current account's 5h/7d quota from teamclaude. Returns null when
 * the proxy is unreachable, the response is unexpected, or no quota is known.
 * Only worth calling when the SDK reported plan rate limits as unavailable.
 */
export async function fetchTeamclaudeLimits(): Promise<UsageLimits | null> {
    const url = process.env.HAPPY_USAGE_LIMITS_URL || DEFAULT_STATUS_URL;
    try {
        const response = await axios.get<TeamclaudeStatus>(url, { timeout: 2000 });
        const status = response.data;
        const account = status.accounts?.find((a) => a.name === status.currentAccount) ?? status.accounts?.[0];
        const quota = account?.quota;
        if (!quota) {
            return null;
        }
        const fiveHour = toWindow(quota.unified5h, quota.unified5hReset);
        const sevenDay = toWindow(quota.unified7d, quota.unified7dReset);
        if (!fiveHour && !sevenDay) {
            return null;
        }
        return { fiveHour, sevenDay, updatedAt: Date.now() };
    } catch {
        return null;
    }
}
