import { describe, expect, it } from 'vitest';
import type { SessionListViewItem, SessionRowData } from '@/sync/storage';
import {
    buildActiveSessionDisplayGroups,
    getSessionShortcutIdsInDisplayOrder,
} from './sessionDisplayOrder';

function session(
    id: string,
    machineId: string,
    path: string,
    createdAt = 0,
): SessionRowData {
    return {
        id,
        name: id,
        subtitle: '',
        avatarId: id,
        flavor: null,
        clientId: null,
        identityLine: null,
        providerKind: null,
        modelName: null,
        activitySummary: null,
        state: 'waiting',
        createdAt,
        hasDraft: false,
        active: true,
        machineId,
        path,
        homeDir: null,
        completedTodosCount: 0,
        totalTodosCount: 0,
        hasUnread: false,
    };
}

const machines = [
    { id: 'machine-z', metadata: { displayName: 'Zulu' } },
    { id: 'machine-a', metadata: { displayName: 'Alpha' } },
];

describe('session display order', () => {
    it('matches the sidebar machine, project, and session ordering', () => {
        const groups = buildActiveSessionDisplayGroups([
            session('zulu', 'machine-z', '/project-b'),
            session('alpha-new', 'machine-a', '/project-z', 20),
            session('alpha-old', 'machine-a', '/project-z', 10),
            session('alpha-first-project', 'machine-a', '/project-a'),
        ], machines, 'Unknown');

        expect(groups.map((group) => group.machineName)).toEqual(['Alpha', 'Zulu']);
        expect(Array.from(groups[0].projects.values())
            .sort((a, b) => a.displayPath.localeCompare(b.displayPath))
            .flatMap((project) => project.sessions.map((item) => item.id)))
            .toEqual(['alpha-first-project', 'alpha-new', 'alpha-old']);
    });

    it('keeps the caller-supplied order inside a project instead of re-sorting by creation time', () => {
        // Callers hand us sessions already ordered by the user's sortSessionsByActivity
        // choice. Re-sorting here by createdAt threw that away, so a session the user
        // had been talking to all morning sank below every session spawned after it —
        // including old ones brought back online by resume, which keep their old
        // createdAt but re-enter the list ahead of it.
        const groups = buildActiveSessionDisplayGroups([
            session('talked-to-this-morning', 'machine-a', '/project', 10),
            session('spawned-later-never-used', 'machine-a', '/project', 20),
        ], machines, 'Unknown');

        expect(Array.from(groups[0].projects.values())
            .flatMap((project) => project.sessions.map((item) => item.id)))
            .toEqual(['talked-to-this-morning', 'spawned-later-never-used']);
    });

    it('numbers the first nine session rows from top to bottom', () => {
        const activeSessions = [
            session('zulu', 'machine-z', '/project'),
            session('alpha', 'machine-a', '/project'),
        ];
        const inactiveSessions = Array.from({ length: 9 }, (_, index) => ({
            type: 'session' as const,
            session: session(`inactive-${index}`, 'machine-z', '/project'),
        }));
        const data: SessionListViewItem[] = [
            { type: 'active-sessions', sessions: activeSessions },
            { type: 'archive-toggle', hidden: false },
            ...inactiveSessions,
        ];

        expect(getSessionShortcutIdsInDisplayOrder(data, machines, 'Unknown')).toEqual([
            'alpha',
            'zulu',
            'inactive-0',
            'inactive-1',
            'inactive-2',
            'inactive-3',
            'inactive-4',
            'inactive-5',
            'inactive-6',
        ]);
    });
});
