import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as entryDestination from '../src/utils/entryDestination.js';
import * as environment from '../src/utils/deploymentEnvironment.js';

test('only the explicit dev deployment flag enables the marker', () => {
    assert.equal(environment.isDevDeployment('dev'), true);
    for (const flag of [undefined, null, '', 'production', 'development', 'DEV', true]) assert.equal(environment.isDevDeployment(flag), false);
});

test('production title is untouched; DEV title survives repeated mounting without duplicate prefixes', () => {
    const document = { title: 'Corely AI 儲運管理系統' };
    environment.applyDeploymentTitle(document, false)();
    assert.equal(document.title, 'Corely AI 儲運管理系統');
    const cleanup = environment.applyDeploymentTitle(document, true);
    assert.equal(document.title, '[DEV] Corely AI 儲運管理系統');
    const repeated = environment.applyDeploymentTitle(document, true);
    assert.equal(document.title, '[DEV] Corely AI 儲運管理系統');
    repeated(); cleanup();
    assert.equal(document.title, 'Corely AI 儲運管理系統');
    const previousRoute = environment.applyDeploymentTitle(document, true);
    document.title = 'New route title'; previousRoute();
    assert.equal(document.title, 'New route title');
});

const require = createRequire(import.meta.url);
async function component(path, overrides, flag) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.VITE_DEPLOY_ENV': flag === undefined ? 'undefined' : JSON.stringify(flag) } });
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, require: name => overrides[name] || require(name), localStorage: { getItem: () => null }, navigator: { onLine: true } });
    return module.exports;
}
const Link = ({ to, children, className, end: _end, ...props }) => React.createElement('a', { ...props, href: to, className: typeof className === 'function' ? className({ isActive: false }) : className }, children);

for (const flag of [undefined, 'production', 'dev']) {
    test(`login and authenticated layout show the same environment marker only for ${flag ?? 'default production'}`, async () => {
        const { EnvironmentBanner } = await component('../src/components/EnvironmentBanner.jsx', { '../utils/deploymentEnvironment': environment }, flag);
        const router = { useNavigate: () => () => {}, useLocation: () => ({ pathname: '/tasks' }), Link, NavLink: Link };
        const { LoginPage } = await component('../src/components/LoginPage.jsx', { './EnvironmentBanner': { EnvironmentBanner }, 'react-router-dom': router, '../api/api': {}, './LoginPage.css': {}, '../utils/entryDestination': entryDestination }, flag);
        const { AppLayout } = await component('../src/ui/AppLayout.jsx', { '../components/EnvironmentBanner': { EnvironmentBanner }, 'react-router-dom': router, '../components/ErrorBoundary': ({ children }) => children }, flag);
        const pages = [React.createElement(LoginPage, { onLogin: () => {} }), React.createElement(AppLayout, { user: { id: 1, role: 'picker', name: 'Test Picker' }, onLogout: () => {} }, React.createElement('p', null, 'Warehouse tasks'))];
        for (const page of pages) {
            const html = renderToStaticMarkup(page);
            if (flag === 'dev') {
                assert.equal((html.match(/data-testid="deployment-environment"/g) || []).length, 1);
                assert.match(html, /DEV 開發環境/); assert.match(html, /開發環境/);
            } else assert.doesNotMatch(html, /deployment-environment|DEV 開發環境|開發環境/);
        }
    });
}
