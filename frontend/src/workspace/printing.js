import { getNativeRuntime } from './nativeRuntime.js';

const nativePaperStyle = '@media print { body.wms-native-portal { background: #fff !important; color: #000 !important; } }';

// react-to-print copies document-head styles into its isolated iframe. The
// clone must retain the owned native portal scope for those styles to match.
export function withWorkspacePrintOptions(options) {
    if (!getNativeRuntime()) return options;
    const classes = new Set(String(options.bodyClass || '').split(/\s+/).filter(Boolean));
    classes.add('wms-native-portal');
    const pageStyle = String(options.pageStyle || '');
    return { ...options, bodyClass: [...classes].join(' '), pageStyle: pageStyle.includes(nativePaperStyle) ? pageStyle : `${pageStyle}\n${nativePaperStyle}` };
}
