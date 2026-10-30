import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Render the real response components; only native host primitives and RPC transport are simulated. */
export async function loadResponseUi(t: { after(fn: () => unknown): void }, entry: string, hostKey: string) {
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/inline-response-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = `globalThis[${JSON.stringify(hostKey)}]`;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'host',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(\/ui)?|\.\/markdown)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',Text='Text',View='View';`
                : args.path === './markdown'
                  ? `export const Markdown='Markdown';`
                  : args.path.endsWith('/ui')
                    ? `export const TextInput='TextInput',SettingsSelect='SettingsSelect'; export function Modal(){throw new Error('Response controls must remain inline');}`
                    : `export function useRpc(c){return ${host}.rpc(c.name);} export function useSettings(){return {status:'ready',values:{language:${host}.language??'fr'}};}`,
          }));
        },
      },
    ],
  });
  const file = join(dir, 'bundle.mjs');
  await writeFile(file, result.outputFiles[0].text);
  return import(file);
}
