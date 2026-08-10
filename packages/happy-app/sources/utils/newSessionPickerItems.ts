type AgentPickerSource = {
    key: string;
    label: string;
};

type ModePickerSource = {
    key: string;
    name: string;
    description?: string | null;
};

export type NewSessionPickerItem = {
    key: string;
    label: string;
    subtitle?: string;
};

export function getAgentPickerItems(agents: AgentPickerSource[]): NewSessionPickerItem[] {
    return agents.map((agent) => ({
        key: agent.key,
        label: agent.label,
    }));
}

export function getModePickerItems(options: ModePickerSource[]): NewSessionPickerItem[] {
    return options.map((option) => ({
        key: option.key,
        label: option.name,
        ...(option.description ? { subtitle: option.description } : {}),
    }));
}

/**
 * Path comparison depends on the machine's home directory, which the caller
 * already resolves, so both helpers below take the normalizer rather than
 * rebuilding it. Returning null means "not a usable path" and drops the entry.
 */
type PathNormalizer = (path: string) => string | null;

const MAX_RECENT_PATHS = 8;

/**
 * Moves a path to the front of a machine's recent list, deduping on the
 * normalized form so `~/proj`, `~/proj/` and `/Users/me/proj` collapse to one.
 */
export function withRecentPath(
    existing: string[] | undefined,
    path: string,
    normalize: PathNormalizer,
): string[] {
    const normalized = normalize(path);
    if (!normalized) {
        return existing ?? [];
    }
    const rest = (existing ?? []).filter((p) => normalize(p) !== normalized);
    return [normalized, ...rest].slice(0, MAX_RECENT_PATHS);
}

/**
 * Orders the project paths offered for a machine: locally remembered ones
 * first (newest first), then anything else seen in session history,
 * alphabetically. Recents lead because session history lives on the server —
 * switching or resetting one wipes it and the list collapses to the home
 * directory, which the caller would then auto-select.
 */
export function orderProjectPaths(
    recentPaths: string[] | undefined,
    historyPaths: string[],
    normalize: PathNormalizer,
): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (path: string) => {
        const key = normalize(path);
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        ordered.push(path);
    };

    (recentPaths ?? []).forEach(push);
    [...historyPaths].sort().forEach(push);
    return ordered;
}
