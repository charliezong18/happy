/**
 * Agy (Antigravity) quota → UsageLimits
 *
 * agy's CLI never reports quota, so we read it from the same endpoint the
 * Antigravity IDE uses: cloudcode-pa `retrieveUserQuota`. The response is a flat
 * list of per-model buckets:
 *
 *   { modelId: 'gemini-3.1-pro-high', remainingFraction: 0.98, resetTime: '<ISO>', tokenType: 'WTUS' }
 *
 * There is no 5h/7d style window split — buckets are grouped by model family and
 * every model in a family shares one fraction and one reset time. So we collapse
 * them into two backend-neutral windows: the Gemini pool (what agy sessions burn
 * by default) and the external-model pool (Claude / GPT-OSS served through
 * Antigravity, which resets on its own clock).
 *
 * Auth mirrors the proven SwiftBar plugin path: the refresh token comes from
 * agy's own token file, and the OAuth client id/secret are extracted from the agy
 * binary (so an agy upgrade that rotates the client self-heals). We only ever
 * mint access tokens in memory — agy's token file is never written back, so we
 * can't clobber agy's own session.
 */

import os from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import type { UsageLimitWindow } from '@/api/types';
import { synthesizeStatus } from '@/claude/utils/usageLimits';
import { resolveAgyBin } from './constants';

/** Window id for the Gemini model pool. */
export const AGY_GEMINI_WINDOW_ID = 'agy_gemini';
/** Window id for the non-Gemini models Antigravity serves (Claude, GPT-OSS). */
export const AGY_EXTERNAL_WINDOW_ID = 'agy_external';

const TOKEN_FILE = join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const CREDS_CACHE = join(os.homedir(), '.gemini', 'antigravity-cli', '.happy-usage-creds.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

export type AgyQuotaBucket = {
  modelId?: string,
  remainingFraction?: number | null,
  resetTime?: string | null,
  tokenType?: string,
};

export type AgyQuotaResponse = {
  buckets?: AgyQuotaBucket[],
};

type Group = {
  id: string,
  label: string,
  matches: (modelId: string) => boolean,
};

// Ordered: the first matching group wins, so `gpt-oss` can't fall into Gemini.
const GROUPS: Group[] = [
  {
    id: AGY_GEMINI_WINDOW_ID,
    label: 'agy Gemini',
    matches: (id) => id.startsWith('gemini'),
  },
  {
    id: AGY_EXTERNAL_WINDOW_ID,
    label: 'agy Claude/GPT',
    matches: (id) => id.startsWith('claude') || id.startsWith('gpt'),
  },
];

/**
 * Collapse the per-model buckets into one window per model family, taking the
 * *binding* bucket (lowest remaining fraction) — same convention as the plan
 * chips, where the number shown is the limit you'll hit first.
 *
 * Buckets without a resetTime (`chat_*`, `tab_*`) carry no real limit and are
 * dropped; they always report a full fraction and would mask a real one.
 */
export function windowsFromAgyQuota(response: AgyQuotaResponse | null | undefined): UsageLimitWindow[] {
  const buckets = Array.isArray(response?.buckets) ? response.buckets : [];
  const windows: UsageLimitWindow[] = [];

  for (const group of GROUPS) {
    let fraction: number | null = null;
    let resetsAt: number | null = null;

    for (const bucket of buckets) {
      const modelId = bucket?.modelId;
      const remaining = bucket?.remainingFraction;
      if (typeof modelId !== 'string' || !group.matches(modelId)) continue;
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)) continue;
      if (!bucket.resetTime) continue;
      const reset = Date.parse(bucket.resetTime);
      if (!Number.isFinite(reset)) continue;

      if (fraction === null || remaining < fraction) {
        fraction = remaining;
      }
      // Earliest reset in the family: the soonest moment the number can move.
      if (resetsAt === null || reset < resetsAt) {
        resetsAt = reset;
      }
    }

    if (fraction === null) continue;

    // Metadata carries percent *used*; the API reports fraction remaining.
    const utilization = Math.min(100, Math.max(0, Math.round((1 - fraction) * 1000) / 10));
    windows.push({
      id: group.id,
      label: group.label,
      utilization,
      resetsAt,
      status: synthesizeStatus(utilization),
    });
  }

  return windows;
}

// --- auth ---

function readRefreshToken(): string {
  const raw = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  const token = raw?.token?.refresh_token;
  if (typeof token !== 'string' || !token) {
    throw new Error('no refresh_token in agy token file');
  }
  return token;
}

type OAuthClient = { client_id: string, secret: string };

function readCachedClient(): OAuthClient | null {
  if (!existsSync(CREDS_CACHE)) return null;
  try {
    const cached = JSON.parse(readFileSync(CREDS_CACHE, 'utf8'));
    if (typeof cached?.client_id === 'string' && typeof cached?.secret === 'string') {
      return cached;
    }
  } catch {
    // corrupt cache — fall back to extraction
  }
  return null;
}

/**
 * `resolveAgyBin` may return the bare command name — enough to spawn, since the
 * OS resolves it against PATH, but `strings` needs a file it can open.
 */
function resolveAgyBinaryPath(): string {
  const bin = resolveAgyBin();
  if (bin.includes('/')) return bin;
  return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim();
}

/**
 * Pull candidate OAuth client id/secret pairs out of the agy binary. agy embeds
 * them as plain strings; which pair works changes across agy releases, so we try
 * every combination and cache the one that authenticates.
 */
function extractClients(): OAuthClient[] {
  const out = execFileSync('strings', ['-n', '6', resolveAgyBinaryPath()], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const ids = [...new Set(out.match(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/g) ?? [])];
  const secrets = [...new Set((out.match(/GOCSPX-[A-Za-z0-9_-]{28,}/g) ?? []).map(s => s.slice(0, 35)))];
  const pairs: OAuthClient[] = [];
  for (const client_id of ids) {
    for (const secret of secrets) {
      pairs.push({ client_id, secret });
    }
  }
  return pairs;
}

async function exchangeRefreshToken(client: OAuthClient, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.client_id,
      client_secret: client.secret,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const body = await res.json() as { access_token?: string };
  if (!body.access_token) {
    throw new Error('token exchange returned no access_token');
  }
  return body.access_token;
}

async function mintAccessToken(): Promise<string> {
  const refreshToken = readRefreshToken();

  const cached = readCachedClient();
  if (cached) {
    try {
      return await exchangeRefreshToken(cached, refreshToken);
    } catch {
      // client rotated (agy upgrade) — fall through to re-extraction
    }
  }

  for (const client of extractClients()) {
    try {
      const token = await exchangeRefreshToken(client, refreshToken);
      try {
        writeFileSync(CREDS_CACHE, JSON.stringify(client));
      } catch {
        // cache is an optimization only
      }
      return token;
    } catch {
      continue;
    }
  }
  throw new Error('no working OAuth client found in the agy binary');
}

async function requestQuota(accessToken: string): Promise<{ ok: true, body: AgyQuotaResponse } | { ok: false, status: number }> {
  const res = await fetch(QUOTA_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'happy-cli/agy-usage',
    },
    body: '{}',
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  return { ok: true, body: await res.json() as AgyQuotaResponse };
}

/**
 * Fetch the current agy quota as usage windows.
 *
 * Access tokens are cached in memory for the process. 401 *and* 429 both mean
 * "get a fresh token and retry": the quota endpoint throttles per access token,
 * so a new token gets a clean bucket (verified 2026-07-17 on the SwiftBar path).
 */
export function createAgyUsageReader() {
  let accessToken: string | null = null;

  const fetchWindows = async (): Promise<UsageLimitWindow[]> => {
    if (!accessToken) {
      accessToken = await mintAccessToken();
    }
    let result = await requestQuota(accessToken);
    if (!result.ok && (result.status === 401 || result.status === 429)) {
      accessToken = await mintAccessToken();
      result = await requestQuota(accessToken);
    }
    if (!result.ok) {
      throw new Error(`retrieveUserQuota failed: ${result.status}`);
    }
    return windowsFromAgyQuota(result.body);
  };

  return { fetchWindows };
}
