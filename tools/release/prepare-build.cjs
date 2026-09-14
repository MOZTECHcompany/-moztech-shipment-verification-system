// Creates a reproducible, secret-free Cloud Build input from a committed checkout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const out = process.argv[2];
if (!out || !path.isAbsolute(out) || fs.existsSync(out)) throw Error('Provide a new absolute output directory');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw Error('Commit all intended changes before packaging');
const tracked = git(['ls-files']).split('\n').filter(file => /^(backend|frontend)\//.test(file)
  && !/(^|\/)(node_modules|tests|__tests__|coverage|dist|uploads|\.env[^/]*)\//.test(file)
  && !/(^|\/)\.env/.test(file) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.log'));
const files = [];
for (const file of tracked) {
  const origin = path.join(root, file);
  if (!fs.lstatSync(origin).isFile()) throw Error('Only regular tracked files may be packaged');
  const content = fs.readFileSync(origin);
  const destination = path.join(out, 'build-source', file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  files.push({ path: file, sha256: crypto.createHash('sha256').update(content).digest('hex') });
}
const digest = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
const images = ['backend', 'frontend'].map(type => `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/corely-wms-${type}:workstation-${digest.slice(0, 12)}`);
fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify({ commit: git(['rev-parse', 'HEAD']), digest, files }, null, 2));
fs.writeFileSync(path.join(out, 'cloudbuild.json'), JSON.stringify({ steps: [
  { name: 'gcr.io/cloud-builders/docker', args: ['build', '-f', 'backend/Dockerfile', '-t', images[0], 'backend'] },
  { name: 'gcr.io/cloud-builders/docker', args: ['build', '-f', 'frontend/Dockerfile.cloudrun', '-t', images[1], 'frontend'] }
], images }, null, 2));
console.log(JSON.stringify({ output: out, commit: git(['rev-parse', 'HEAD']), digest, files: files.length }));
