import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../tools/release/prepare-build.cjs', import.meta.url), 'utf8');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-build-env-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const root = path.join(dir, 'repo');
    const files = ['backend/Dockerfile', 'frontend/Dockerfile.cloudrun', 'frontend/src/App.jsx', 'frontend/.env.test', 'frontend/tests/ignored.test.mjs'];
    for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), `synthetic fixture ${file}`); }
    let gitCalls = 0;
    function pack(name, environment, extra = []) {
        const output = path.join(dir, name);
        const argv = ['node', 'prepare-build.cjs', output, ...(environment === undefined ? [] : [environment]), ...extra];
        vm.runInNewContext(source, {
            __dirname: path.join(root, 'tools/release'), process: { argv }, console: { log: () => {} },
            require: name => name === 'node:child_process' ? { execFileSync: (command, args) => {
                gitCalls++; assert.equal(command, 'git');
                if (args[0] === 'status') return '';
                if (args[0] === 'ls-files') return files.join('\n');
                if (args[0] === 'rev-parse') return '1'.repeat(40);
                throw new Error('Unexpected fixture git command');
            } } : require(name),
        });
        return { output, manifest: JSON.parse(fs.readFileSync(path.join(output, 'source-manifest.json'), 'utf8')), build: JSON.parse(fs.readFileSync(path.join(output, 'cloudbuild.json'), 'utf8')) };
    }
    return { dir, pack, gitCalls: () => gitCalls };
}

test('release packaging defaults to production and explicit dev changes only frontend build settings and tag', t => {
    const data = fixture(t);
    const production = data.pack('production');
    const explicit = data.pack('explicit-production', 'production');
    const dev = data.pack('dev', 'dev');
    assert.equal(production.manifest.environment, 'production'); assert.equal(dev.manifest.environment, 'dev');
    assert.equal(production.manifest.digest, dev.manifest.digest);
    assert.deepEqual(production.build, explicit.build);
    assert.deepEqual(production.build.steps[0], dev.build.steps[0]);
    assert.equal(production.build.images[0], dev.build.images[0]);
    assert.notEqual(production.build.images[1], dev.build.images[1]);
    assert.match(dev.build.images[1], /corely-wms-frontend:dev-/);
    assert.doesNotMatch(JSON.stringify(production.build), /--build-arg|VITE_DEPLOY_ENV/);
    assert.deepEqual(dev.build.steps[1].args.slice(3, 5), ['--build-arg', 'VITE_DEPLOY_ENV=dev']);
    assert.doesNotMatch(JSON.stringify(dev.build), /NODE_ENV|--mode|development/);
    assert.deepEqual(dev.manifest.files.map(file => file.path), ['backend/Dockerfile', 'frontend/Dockerfile.cloudrun', 'frontend/src/App.jsx']);
    assert.equal(fs.existsSync(path.join(dev.output, 'build-source/frontend/.env.test')), false);
});

test('unknown deployment environment and surplus arguments are rejected before git reads or file output', t => {
    const data = fixture(t);
    for (const [index, value] of ['staging', 'development', 'DEV', ''].entries()) {
        assert.throws(() => data.pack(`bad-${index}`, value), /Environment must be/);
        assert.equal(fs.existsSync(path.join(data.dir, `bad-${index}`)), false);
    }
    assert.throws(() => data.pack('extra', 'dev', ['extra']), /Environment must be/);
    assert.equal(data.gitCalls(), 0);
});
