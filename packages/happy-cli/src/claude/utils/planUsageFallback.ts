/**
 * Pulls the plan-usage snapshot straight from the OAuth usage endpoint when the
 * SDK's `get_usage` seed comes back empty.
 *
 * Why this exists: daemon-spawned sessions run with `CLAUDE_CODE_OAUTH_TOKEN`
 * set (the 2026-08-03 stopgap for the Keychain refresh-chain mutual
 * revocation). Under that token the backend answers `rate_limits_available:
 * false` and omits `rate_limits` entirely, so every window arrives with a null
 * utilization and the app drops all chips. The subscription credential still
 * answers the same snapshot over HTTP, so fetch it out of band.
 *
 * STRICTLY READ-ONLY. It reads the Keychain item and never refreshes a token or
 * writes one back — refreshing is the very act that rotates the refresh chain
 * and invalidates the other one, which is the failure the OAuth token was
 * introduced to escape. An expired credential is skipped, not renewed; claude
 * itself keeps the item current, and the chips degrade to hidden (the
 * pre-existing behaviour) until it does.
 */
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';
import { logger } from '@/lib';

const execFileAsync = promisify(execFile);

/** Absolute path: an execFile miss here fails silently, so don't let PATH decide. */
const SECURITY_BIN = '/usr/bin/security';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FETCH_TIMEOUT_MS = 5_000;
/** Treat a token expiring within the minute as unusable rather than racing it. */
const EXPIRY_GRACE_MS = 60_000;

/**
 * Extracts a still-valid access token from a parsed Keychain blob.
 * Exported for tests: everything else in this module is I/O.
 */
export function usableAccessToken(blob: unknown, now: number): string | null {
    if (!blob || typeof blob !== 'object') return null;
    const oauth = (blob as { claudeAiOauth?: unknown }).claudeAiOauth;
    if (!oauth || typeof oauth !== 'object') return null;
    const { accessToken, expiresAt } = oauth as { accessToken?: unknown, expiresAt?: unknown };
    if (typeof accessToken !== 'string' || !accessToken) return null;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
    if (expiresAt <= now + EXPIRY_GRACE_MS) return null;
    return accessToken;
}

/**
 * Mirrors how every claude binary derives the Keychain account (verified
 * identical across Desktop / CLI / npm / SDK builds): `USER`, else the passwd
 * username, else a constant. Matching it matters because the item must be
 * looked up by account — a bare service lookup returns whichever item comes
 * first, and this service has historically held a second one written by the
 * third-party `Claude God` menubar app with an empty account. That item runs
 * its own refresh loop (it is one half of the mutual revocation) and its token
 * is stale, so an account-less lookup is how you end up authenticating with
 * garbage. Never fall back to a bare lookup for that reason.
 */
function keychainAccountCandidates(): string[] {
    const candidates = [process.env.USER];
    try {
        candidates.push(userInfo().username);
    } catch {
        // No passwd entry; the other candidates still apply.
    }
    candidates.push('claude-code-user');
    return [...new Set(candidates.filter((a): a is string => !!a))];
}

async function readKeychainToken(now: number): Promise<string | null> {
    for (const account of keychainAccountCandidates()) {
        try {
            const { stdout } = await execFileAsync(
                SECURITY_BIN,
                ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
                { timeout: FETCH_TIMEOUT_MS },
            );
            const token = usableAccessToken(JSON.parse(stdout.trim()), now);
            if (token) return token;
        } catch {
            // Missing item, no Keychain access (errSecInteractionNotAllowed in a
            // headless context), or unparseable payload — try the next candidate.
            //
            // Deliberately swallowed rather than logged: a JSON.parse failure
            // embeds a snippet of its input in the message, and the input here
            // is the credential blob. Do not "improve" this into a logged catch.
        }
    }
    return null;
}

/**
 * Returns the `rate_limits`-shaped snapshot for `windowsFromGetUsage`, or null
 * when unavailable. Never throws.
 */
export async function fetchPlanUsageSnapshot(now: number): Promise<Record<string, unknown> | null> {
    if (process.platform !== 'darwin') return null;
    try {
        const token = await readKeychainToken(now);
        if (!token) {
            logger.debug('[planUsageFallback] no usable subscription credential; leaving chips hidden');
            return null;
        }
        const response = await fetch(USAGE_URL, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            logger.debug(`[planUsageFallback] usage endpoint returned ${response.status}`);
            return null;
        }
        const body = await response.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        return body as Record<string, unknown>;
    } catch (e) {
        logger.debug('[planUsageFallback] snapshot fetch failed (ignored)', e);
        return null;
    }
}
