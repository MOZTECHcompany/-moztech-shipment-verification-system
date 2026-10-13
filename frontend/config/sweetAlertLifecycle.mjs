import { readFile } from 'node:fs/promises';

// SweetAlert 11.22.0 schedules textarea measurement after rendering. A host
// can dispose that prompt before the timer runs. Apply the same detached-node
// guard already used by its resize callback before its initial measurement.
// This preserves the official public class, inputs and preConfirm behavior.
export function guardDetachedTextarea(source) {
    const marker = 'const initialPopupWidth = parseInt(window.getComputedStyle(getPopup()).width);';
    if (source.split(marker).length !== 2) throw new Error('Review SweetAlert textarea lifecycle guard after dependency changes');
    return source.replace(marker, 'const measuredPopup = getPopup();\n        if (!measuredPopup || !document.body.contains(textarea)) return;\n        const initialPopupWidth = parseInt(window.getComputedStyle(measuredPopup).width);');
}
const headless = /[\\/]sweetalert2[\\/]dist[\\/]sweetalert2\.js$/;
export function sweetAlertLifecyclePlugin() {
    return { name: 'sweetalert-detached-textarea-guard', enforce: 'pre',
        transform(source, id) { if (headless.test(id)) return { code: guardDetachedTextarea(source), map: null }; },
    };
}
export function sweetAlertPrebundlePlugin() {
    return { name: 'sweetalert-detached-textarea-guard', setup(build) {
        build.onLoad({ filter: headless }, async ({ path }) => ({ contents: guardDetachedTextarea(await readFile(path, 'utf8')), loader: 'js' }));
    } };
}
