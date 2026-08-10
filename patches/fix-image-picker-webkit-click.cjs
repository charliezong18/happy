/**
 * Make the image picker actually open on iOS Safari / iOS Chrome.
 *
 * expo-image-picker's web implementation opens its hidden <input type="file">
 * by *synthesizing* a click:
 *
 *     const event = new MouseEvent('click');
 *     input.dispatchEvent(event);
 *
 * A constructed MouseEvent has isTrusted === false. Blink tolerates that and
 * shows the file dialog anyway, which is why this is invisible on desktop
 * Chrome — but WebKit gates the file dialog on a genuine user gesture and
 * silently drops the event. On iPhone the attach button simply did nothing.
 *
 * HTMLElement.click() is the documented way to do this: it runs the element's
 * activation behavior directly and inherits the user activation of the press
 * we are still inside of. (See also the companion change in
 * sources/hooks/useImagePicker.ts, which stops awaiting anything before the
 * launch so that activation is still live when we get here.)
 *
 * Usage: `node patches/fix-image-picker-webkit-click.cjs`
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'HAPPY PATCH fix-image-picker-webkit-click';
const ANCHOR = `        const event = new MouseEvent('click');
        input.dispatchEvent(event);`;
const REPLACEMENT = `        // ${MARKER}: a synthesized MouseEvent is untrusted and WebKit
        // refuses to open the file dialog for it. click() carries the real
        // user activation.
        input.click();`;

const targets = [
    'build/ExponentImagePicker.web.js',
];

for (const rel of targets) {
    const file = path.resolve(__dirname, '..', 'node_modules', 'expo-image-picker', rel);
    if (!fs.existsSync(file)) {
        console.warn('[fix-image-picker-webkit-click] missing', file, '— skipping');
        continue;
    }
    let src = fs.readFileSync(file, 'utf8');
    if (src.includes(MARKER)) {
        console.log('[fix-image-picker-webkit-click] already patched:', rel);
        continue;
    }
    const occurrences = src.split(ANCHOR).length - 1;
    if (occurrences !== 1) {
        throw new Error(`[fix-image-picker-webkit-click] expected 1 anchor in ${rel}, found ${occurrences}`);
    }
    src = src.replace(ANCHOR, REPLACEMENT);
    fs.writeFileSync(file, src);
    console.log('[fix-image-picker-webkit-click] patched:', rel);
}
