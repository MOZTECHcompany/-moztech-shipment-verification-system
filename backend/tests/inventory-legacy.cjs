// Read every tracked legacy source, then inventory AST routes, handlers, UI controls,
// imports, browser preferences and realtime events. This is structural evidence;
// executable workflow tests and browser checks are recorded separately.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const parser = require(require.resolve('@babel/parser', { paths: [root + '/frontend/node_modules'] }));
const generate = require(require.resolve('@babel/generator', { paths: [root + '/frontend/node_modules'] })).default;
const old = process.argv[2];
if (!old || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: old, encoding: 'utf8' }).trim() !== 'd4e2bff12545d9243787d52850c16f36e1db4eed') throw Error('Expected immutable original WMS baseline');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function scan(directory) {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files = {}, routes = [], controls = [], events = [], preferences = [], handlers = [];
    for (const file of tracked) {
        if (file === 'docs/legacy-parity/source-inventory.json') continue; // Avoid a self-referential hash.
        if (!fs.existsSync(path.join(directory, file))) continue;
        const bytes = fs.readFileSync(path.join(directory, file));
        const entry = files[file] = { sha256: hash(bytes), bytes: bytes.length, imports: [] };
        if (!/\.[cm]?jsx?$/.test(file) || /(?:^|\/)(dist|build|node_modules)\//.test(file)) continue;
        const source = bytes.toString();
        let ast;
        try { ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx'], errorRecovery: false }); }
        catch (error) { entry.parseError = error.message; continue; }
        const code = node => generate(node, { compact: true, comments: false }).code;
        const walk = node => {
            if (!node || typeof node !== 'object') return;
            const line = node.loc?.start.line;
            if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.source) entry.imports.push(node.source.value);
            if (node.type === 'CallExpression' && node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') entry.imports.push(node.arguments[0].value);
            if (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) {
                const body = node.type === 'FunctionDeclaration' ? node : node.init;
                handlers.push({ file, line, name: node.id?.name, sha256: hash(code(body)) });
            }
            if (node.type === 'CallExpression') {
                const callee = code(node.callee), arg = node.arguments[0];
                if (/^(router|callbackRouter)\.(get|post|patch|put|delete)$/.test(callee) && arg?.type === 'StringLiteral') routes.push({ file, line, method: callee.split('.')[1].toUpperCase(), path: arg.value });
                if (/(?:\.on|\.emit)$/.test(callee) && arg?.type === 'StringLiteral') events.push({ file, line, call: callee, event: arg.value });
                if (/(?:localStorage|sessionStorage)\.(getItem|setItem)/.test(callee)) preferences.push({ file, line, call: code(node).slice(0, 250) });
            }
            if (node.type === 'JSXOpeningElement') {
                const tag = code(node.name), attributes = node.attributes.filter(a => a.type === 'JSXAttribute');
                if (attributes.some(a => /^on(Click|Change|Submit|Drop|KeyDown)$/.test(a.name.name)) || ['Route', 'Link'].includes(tag)) controls.push({ file, line, tag, attributes: attributes.filter(a => a.name.name !== 'className' && a.name.name !== 'style').map(a => code(a)).join(' ').slice(0, 800) });
            }
            for (const [key, child] of Object.entries(node)) if (!['loc','start','end','tokens','comments'].includes(key)) {
                if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === 'object') walk(child);
            }
        }; walk(ast);
    }
    const active = new Set();
    function visit(file) {
        if (active.has(file) || !files[file]) return;
        active.add(file);
        for (const specifier of files[file].imports) {
            let stem;
            if (specifier.startsWith('@/')) stem = 'frontend/src/' + specifier.slice(2);
            else if (specifier.startsWith('.')) stem = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
            if (stem) { const resolved = [stem, ...['.jsx','.js','.mjs','/index.jsx','/index.js'].map(ext => stem + ext)].find(candidate => files[candidate]); if (resolved) visit(resolved); }
        }
    }
    visit('frontend/src/main.jsx');
    return { files, routes, controls, events, preferences, handlers, activeFrontend: [...active].sort() };
}
const legacy = scan(old), current = scan(root);
const key = r => `${r.file}:${r.method} ${r.path}`;
const currentRoutes = new Set(current.routes.map(key));
const missing = legacy.routes.filter(r => !currentRoutes.has(key(r)));
const comparison = { kind: 'source_inventory_not_end_to_end_acceptance', baseline: 'd4e2bff12545d9243787d52850c16f36e1db4eed', legacy, current,
    missingRoutes: missing,
    changedFiles: Object.keys(legacy.files).filter(f => legacy.files[f].sha256 !== current.files[f]?.sha256),
    activeLegacyControls: legacy.controls.filter(c => legacy.activeFrontend.includes(c.file)),
    changedHandlers: legacy.handlers.filter(h => legacy.activeFrontend.includes(h.file)).filter(h => !current.handlers.some(n => n.file === h.file && n.name === h.name && n.sha256 === h.sha256)),
};
fs.writeFileSync(path.join(root, 'docs/legacy-parity/source-inventory.json'), JSON.stringify(comparison, null, 2));
fs.writeFileSync(path.join(root, 'docs/legacy-parity/legacy-routes.json'), JSON.stringify(legacy.routes.filter(r => r.file.includes('/routes/')), null, 2));
console.log(JSON.stringify({ legacyFiles: Object.keys(legacy.files).length, activeFrontend: legacy.activeFrontend, legacyRoutes: legacy.routes.length, currentRoutes: current.routes.length, missingRoutes: missing,
    activeControls: comparison.activeLegacyControls.length, parseErrors: Object.entries(legacy.files).filter(([,f])=>f.parseError).map(([file,f])=>({file,error:f.parseError})), changedHandlers: comparison.changedHandlers.map(h=>`${h.file}:${h.name}`) }, null, 2));
