import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MAX_CONTEXT_SIZE } from './AgentInput';

// Persistent per-session status strip (slopus/happy#1441, mockup option A):
// model · cwd · git branch · context %. All data already flows through
// session metadata / git status sync / usage reducer — this is display only.

type UsageLimitWindow = {
    utilization: number | null;
    resetsAt: string | null;
} | null;

type SessionStatusBarProps = {
    modelName: string | null;
    path: string;
    homeDir?: string;
    gitBranch: string | null;
    contextSize: number | null;
    usageLimits?: {
        fiveHour?: UsageLimitWindow;
        sevenDay?: UsageLimitWindow;
    } | null;
};

export const SessionStatusBar = React.memo((props: SessionStatusBarProps) => {
    const { theme } = useUnistyles();
    const [showFullPath, setShowFullPath] = React.useState(false);

    const displayPath = React.useMemo(() => {
        if (!showFullPath) {
            return props.path.split('/').filter(Boolean).pop() ?? props.path;
        }
        if (props.homeDir && props.path.startsWith(props.homeDir)) {
            return '~' + props.path.slice(props.homeDir.length);
        }
        return props.path;
    }, [props.path, props.homeDir, showFullPath]);

    const contextPercent = props.contextSize !== null
        ? Math.max(0, Math.min(100, Math.round((props.contextSize / MAX_CONTEXT_SIZE) * 100)))
        : null;

    const percentColor = (percent: number) => percent >= 95
        ? theme.colors.warningCritical
        : percent >= 90
            ? theme.colors.warning
            : theme.colors.textSecondary;
    const contextColor = contextPercent !== null ? percentColor(contextPercent) : theme.colors.textSecondary;

    const limitFiveHour = props.usageLimits?.fiveHour?.utilization ?? null;
    const limitSevenDay = props.usageLimits?.sevenDay?.utilization ?? null;

    return (
        <View style={styles.container}>
            {props.modelName && (
                <Text style={styles.text} numberOfLines={1}>{props.modelName}</Text>
            )}
            <Pressable
                onPress={() => setShowFullPath((v) => !v)}
                style={styles.pathPressable}
                hitSlop={8}
            >
                <Ionicons name="folder-outline" size={11} color={theme.colors.textSecondary} />
                <Text style={styles.text} numberOfLines={1}>{displayPath}</Text>
            </Pressable>
            {props.gitBranch && (
                <View style={styles.segment}>
                    <Ionicons name="git-branch-outline" size={11} color={theme.colors.textSecondary} />
                    <Text style={styles.text} numberOfLines={1}>{props.gitBranch}</Text>
                </View>
            )}
            <View style={styles.spacer} />
            {limitFiveHour !== null && (
                <Text style={[styles.text, { color: percentColor(limitFiveHour) }]}>
                    5h {Math.round(limitFiveHour)}%
                </Text>
            )}
            {limitSevenDay !== null && (
                <Text style={[styles.text, { color: percentColor(limitSevenDay) }]}>
                    7d {Math.round(limitSevenDay)}%
                </Text>
            )}
            {contextPercent !== null && (
                <View style={styles.segment}>
                    <View style={styles.contextTrack}>
                        <View
                            style={[
                                styles.contextFill,
                                { width: `${contextPercent}%`, backgroundColor: contextColor },
                            ]}
                        />
                    </View>
                    <Text style={[styles.text, { color: contextColor }]}>{contextPercent}%</Text>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginBottom: 4,
    },
    segment: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        flexShrink: 1,
    },
    pathPressable: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        flexShrink: 1,
    },
    spacer: {
        flexGrow: 1,
    },
    text: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    contextTrack: {
        width: 48,
        height: 3,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
        overflow: 'hidden',
    },
    contextFill: {
        height: '100%',
        borderRadius: 2,
    },
}));
