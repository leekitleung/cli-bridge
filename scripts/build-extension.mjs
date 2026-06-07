import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = process.cwd();
const extensionRoot = resolve(root, 'apps/extension');
const distRoot = resolve(extensionRoot, 'dist');

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, 'background'), { recursive: true });
await mkdir(resolve(distRoot, 'content'), { recursive: true });

await build({
  entryPoints: [resolve(extensionRoot, 'src/background/index.ts')],
  outfile: resolve(distRoot, 'background/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'silent',
});

await build({
  entryPoints: [resolve(extensionRoot, 'src/content/index.ts')],
  outfile: resolve(distRoot, 'content/index.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'silent',
});

const sourceManifest = JSON.parse(
  await readFile(resolve(extensionRoot, 'manifest.json'), 'utf8'),
);

const distManifest = {
  ...sourceManifest,
  background: {
    ...sourceManifest.background,
    service_worker: 'background/index.js',
  },
  content_scripts: sourceManifest.content_scripts.map((contentScript) => ({
    ...contentScript,
    js: ['content/index.js'],
  })),
};

await writeFile(
  resolve(distRoot, 'manifest.json'),
  `${JSON.stringify(distManifest, null, 2)}\n`,
);
