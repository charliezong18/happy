/**
 * Mobile-web viewport sizing, the half that cannot be expressed in CSS.
 *
 * Two things the stock expo web shell gets wrong on iOS WebKit:
 *
 * 1. Its viewport meta has no `viewport-fit=cover`, so env(safe-area-inset-*)
 *    resolves to 0 and react-native-safe-area-context hands the app zero insets
 *    on web. The session screen already pads by safeArea.bottom — it was just
 *    always being given nothing to pad with.
 *
 * 2. The on-screen keyboard does not resize the layout viewport, only the
 *    visual one, so a full-height shell keeps the composer behind the keyboard.
 *    react-native-keyboard-controller is native-only and reports nothing here.
 *    Publishing visualViewport.height as --happy-viewport-height lets the body
 *    rule in theme.css size the app to whatever is actually on screen.
 *
 * Only touch devices get the variable: on a desktop browser the toolbar problem
 * does not exist and `dvh` alone is right, whereas tracking visualViewport there
 * would also shrink the app during a trackpad pinch-zoom. The test is
 * maxTouchPoints rather than a `(pointer: coarse)` media query because this runs
 * at module eval, before the query reliably resolves.
 *
 * Deliberately done from the bundle rather than the HTML template: a broken
 * entry page white-screens every device, whereas a failure here just means the
 * fix does not apply. Imported first from index.ts so it lands before mount.
 *
 * Web-only; guarded on `document`, which native does not define.
 */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
        const content = meta.getAttribute('content') ?? '';
        if (!content.includes('viewport-fit')) {
            meta.setAttribute('content', `${content}, viewport-fit=cover`);
        }
    }

    const viewport = window.visualViewport;
    if (viewport && navigator.maxTouchPoints > 0) {
        const root = document.documentElement;
        let queued = false;

        const apply = () => {
            queued = false;
            root.style.setProperty('--happy-viewport-height', `${viewport.height}px`);
        };

        // Coalesce the burst of resizes a keyboard animation produces, but take
        // the first value synchronously so the shell is never briefly unsized.
        const schedule = () => {
            if (queued) {
                return;
            }
            queued = true;
            requestAnimationFrame(apply);
        };

        viewport.addEventListener('resize', schedule);
        apply();
    }
}
