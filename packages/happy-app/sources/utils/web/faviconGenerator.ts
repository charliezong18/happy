/**
 * Simple utility for switching between normal and active favicons
 */

/**
 * Derives the deploy's base path from the <link rel="icon"> Expo bakes into
 * index.html. On a sub-path deploy (GitHub Pages at /happy/) that href is
 * "/happy/favicon.ico", so hardcoding "/favicon.ico" here would 404 and blank
 * the tab icon the moment the first swap runs. Read once, before any swap.
 */
function resolveFaviconBase(): string {
    if (typeof document === 'undefined') return '/';

    const href = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href');
    if (!href) return '/';

    const path = href.split('?')[0];
    // Expo always emits an absolute href; anything else can't be resolved
    // safely from a deep-linked route, so fall back to the root.
    if (!path.startsWith('/') && !/^https?:\/\//.test(path)) return '/';

    return path.replace(/[^/]*$/, '');
}

const FAVICON_BASE = resolveFaviconBase();
const FAVICON_NORMAL = FAVICON_BASE + 'favicon.ico';
const FAVICON_ACTIVE = FAVICON_BASE + 'favicon-active.ico';

/**
 * Updates the favicon in the document
 */
function setFavicon(url: string) {
    if (typeof document === 'undefined') return;
    
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/x-icon';
        document.head.appendChild(link);
    }
    
    // Force reload by adding timestamp
    link.href = url + '?t=' + Date.now();
}

/**
 * Updates the favicon to show a notification indicator
 */
export function updateFaviconWithNotification() {
    setFavicon(FAVICON_ACTIVE);
}

/**
 * Resets the favicon to its original state
 */
export function resetFavicon() {
    setFavicon(FAVICON_NORMAL);
}