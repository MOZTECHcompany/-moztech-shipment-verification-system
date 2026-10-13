import { getNativeRuntime } from './nativeRuntime.js';

// react-to-print copies document-head styles into its isolated iframe. The
// clone must retain the owned native portal scope for those styles to match.
export function withWorkspacePrintOptions(options) {
    if (!getNativeRuntime()) return options;
    const classes = new Set(String(options.bodyClass || '').split(/\s+/).filter(Boolean));
    classes.add('wms-native-portal');
    return { ...options, bodyClass: [...classes].join(' ') };
}
