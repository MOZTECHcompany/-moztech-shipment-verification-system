import { createHash } from 'node:crypto';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export function shadowCss(source) {
    const css = postcss.parse(source);
    css.walkRules(rule => {
        let parent = rule.parent;
        while (parent) { if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return; parent = parent.parent; }
        rule.selector = selectorParser(selectors => {
            selectors.walkTags(tag => { if (['html', 'body'].includes(tag.value)) tag.replaceWith(selectorParser.pseudo({ value: ':host' })); });
            selectors.walkPseudos(pseudo => { if (pseudo.value === ':root') pseudo.replaceWith(selectorParser.pseudo({ value: ':host' })); });
        }).processSync(rule.selector);
    });
    return css.toString();
}

// Dialog libraries require a light-DOM target. Scope their complete theme and
// WMS utilities to that owned portal; never install WMS preflight on the ERP.
export function portalCss(source) {
    const css = postcss.parse(source);
    const names = new Map();
    css.walkAtRules(/keyframes$/i, rule => {
        const name = rule.params.trim();
        // SweetAlert completes dismissal by matching animationName to its
        // public hideClass. Its existing swal2 prefix must remain unchanged.
        if (name.startsWith('swal2-')) return;
        names.set(name, `wms-native-${name}`); rule.params = names.get(name);
    });
    css.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/, declaration => {
        declaration.value = declaration.value.replace(/[A-Za-z_][\w-]*/g, name => names.get(name) || name);
    });
    css.walkRules(rule => {
        let parent = rule.parent;
        while (parent) { if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return; parent = parent.parent; }
        rule.selector = postcss.list.comma(rule.selector).map(selector => selectorParser(selectors => {
            selectors.each(item => {
                item.walkTags(tag => { if (['html', 'body'].includes(tag.value)) tag.replaceWith(selectorParser.className({ value: 'wms-native-portal' })); });
                item.walkPseudos(pseudo => { if ([':root', ':host'].includes(pseudo.value)) pseudo.replaceWith(selectorParser.className({ value: 'wms-native-portal' })); });
                while (item.nodes[0]?.value === 'wms-native-portal' && item.nodes[1]?.type === 'combinator' && item.nodes[2]?.value === 'wms-native-portal') { item.nodes[0].remove(); item.nodes[0].remove(); }
                if (item.nodes[0]?.type !== 'class' || item.nodes[0].value !== 'wms-native-portal') {
                    item.prepend(selectorParser.combinator({ value: ' ' }));
                    item.prepend(selectorParser.className({ value: 'wms-native-portal' }));
                }
            });
        }).processSync(selector)).join(',');
    });
    // SweetAlert's close detector treats any nonzero transition duration as an
    // active close animation. WMS preflight gives every element a transition;
    // native dialogs intentionally close immediately, so no transition may
    // make the library wait for an event that will never be emitted.
    css.append(postcss.rule({ selector: '.wms-native-portal .swal2-popup', nodes: [
        postcss.decl({ prop: 'transition-duration', value: '0s', important: true }),
    ] }));
    return css.toString();
}

export function workspaceManifestPlugin(sourceCommit) {
    return { name: 'wms-workspace-manifest', enforce: 'post',
        generateBundle: { order: 'post', handler(_options, bundle) {
            const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.name === 'workspace');
            const styles = Object.values(bundle).filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
            if (!entry || !entry.exports?.includes('mountWorkspace') || !entry.exports?.includes('sourceCommit') || !styles.length) throw new Error('Workspace SDK exports and CSS must be emitted together');
            const source = styles.map(style => String(style.source)).join('\n');
            const shadow = shadowCss(source);
            const shadowPath = `assets/workspace-shadow-${createHash('sha256').update(shadow).digest('hex').slice(0, 16)}.css`;
            this.emitFile({ type: 'asset', fileName: shadowPath, source: shadow });
            const scoped = portalCss(source);
            const portalPath = `assets/workspace-portal-${createHash('sha256').update(scoped).digest('hex').slice(0, 16)}.css`;
            this.emitFile({ type: 'asset', fileName: portalPath, source: scoped });
            this.emitFile({ type: 'asset', fileName: 'workspace-manifest.json', source: JSON.stringify({ version: 1,
                entry: '/' + entry.fileName, styles: ['/' + shadowPath], portalStyles: ['/' + portalPath], sourceCommit }) });
        } },
    };
}
