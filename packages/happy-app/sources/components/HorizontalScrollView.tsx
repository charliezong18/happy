import * as React from 'react';
import { Platform, ScrollView, ScrollViewProps } from 'react-native';

// Gesture-locked horizontal wheel scroll for tables/code blocks inside the
// inverted chat list.
//
// Two things conspire to kill horizontal trackpad swipes here, so this handler
// both claims the event and applies the scroll itself:
//
// 1. The chat is an inverted FlatList, and react-native-web's inverted-wheel
//    patch (react-native-web#995, still unfixed upstream — see #2418) attaches
//    a wheel listener on the list's scroll node that calls preventDefault() on
//    every event while only ever applying deltaY. That listener is on an
//    ancestor in the bubble phase, so stopPropagation() here keeps the event
//    away from it.
// 2. Chromium does not natively scroll a nested horizontal scroller when an
//    ancestor is transformed with scaleY(-1) — which is exactly how the
//    inverted list is built. Verified with a standalone repro: identical
//    markup scrolls natively without the transform and not at all with it,
//    with no JS handlers involved. So stopPropagation() alone is not enough;
//    nothing would move. We apply scrollLeft by hand.
//
// Trackpad swipes ramp up from 1-2px deltas, so deciding the axis solely on
// the first event of a gesture misclassifies nearly every real horizontal
// swipe as vertical (and momentum-tail events keep re-arming the stale lock).
// Instead the lock is asymmetric: 'h' is sticky until 150ms of idle, while
// 'v' is soft — any clearly horizontal event (|deltaX| > |deltaY|, min 2px)
// upgrades the gesture to 'h' mid-flight. Vertical scrolls with 1px deltaX
// noise stay vertical, and a purely vertical event during an 'h' lock is
// passed back to the outer list so chat scrolling never goes dead.
//
// Events we don't consume bubble up to the inverted chat list, whose
// react-native-web wheel handler swallows them unless a nested horizontal
// scroller can take them natively (see
// patches/fix-rnw-inverted-wheel-horizontal.cjs) — that native path also
// covers sub-2px slow swipes that the lock ignores.
//
// At a horizontal boundary the event also bubbles, so the list's
// preventDefault() suppresses the browser's back/forward swipe gesture.
//
// Shift + wheel converts vertical wheel to horizontal scroll for mouse users.
function useHorizontalWheelScroll() {
    const ref = React.useRef<ScrollView>(null);
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !ref.current) return;
        const node = (ref.current as any)?.getScrollableNode?.() ?? (ref.current as any);
        if (!node || !node.addEventListener) return;

        let gestureAxis: 'h' | 'v' | null = null;
        let gestureTimer = 0;

        const handler = (e: WheelEvent) => {
            const el = node as HTMLElement;
            const maxScroll = el.scrollWidth - el.clientWidth;
            if (maxScroll <= 0) return;

            // Room left to move in the direction the delta points.
            const canScroll = (delta: number) => delta < 0
                ? el.scrollLeft > 0
                : delta > 0 && el.scrollLeft < maxScroll - 1;

            // Shift + wheel: convert vertical wheel to horizontal scroll.
            if (e.shiftKey && e.deltaY !== 0) {
                if (!canScroll(e.deltaY)) return;
                e.preventDefault();
                e.stopPropagation();
                el.scrollLeft += e.deltaY;
                return;
            }

            // Reset gesture lock after 150ms idle.
            window.clearTimeout(gestureTimer);
            gestureTimer = window.setTimeout(() => { gestureAxis = null; }, 150);

            // 'h' is sticky until idle; 'v' is soft and can upgrade mid-gesture.
            const absX = Math.abs(e.deltaX);
            const absY = Math.abs(e.deltaY);
            if (gestureAxis !== 'h') {
                if (absX > absY && absX >= 2) gestureAxis = 'h';
                else if (gestureAxis === null) gestureAxis = 'v';
            }

            if (gestureAxis === 'v') return;

            // 'h'-locked but purely vertical event: give it back to the list.
            if (e.deltaX === 0 && absY > 0) return;

            // Horizontal-locked: scroll the element, unless at boundary.
            const atStart = el.scrollLeft <= 0 && e.deltaX < 0;
            const atEnd = el.scrollLeft >= maxScroll - 1 && e.deltaX > 0;
            if (atStart || atEnd) return;

            e.preventDefault();
            e.stopPropagation();
            el.scrollLeft += e.deltaX;
        };
        node.addEventListener('wheel', handler, { passive: false });
        return () => {
            node.removeEventListener('wheel', handler);
            window.clearTimeout(gestureTimer);
        };
    }, []);
    return ref;
}

type Props = Omit<ScrollViewProps, 'horizontal'>;

export function HorizontalScrollView(props: Props) {
    const {
        showsHorizontalScrollIndicator = true,
        nestedScrollEnabled = true,
        ...rest
    } = props;
    const ref = useHorizontalWheelScroll();
    return (
        <ScrollView
            ref={ref}
            horizontal
            showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
            nestedScrollEnabled={nestedScrollEnabled}
            {...rest}
        />
    );
}
