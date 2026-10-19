import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
let installed = false;
try {
  const client = JSON.parse(readFileSync(new URL('node_modules/@getpaseo/client/package.json', root), 'utf8'));
  installed = client.version === manifest.dependencies['@getpaseo/client'];
} catch { /* A fresh Git checkout has no node_modules. */ }
if (!installed) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: fileURLToPath(root), stdio: 'inherit',
  });
}
