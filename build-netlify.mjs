import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const output = 'netlify-dist';
const assets = `${output}/operador/assets`;

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  outfile: `${assets}/app.js`,
  loader: { '.css': 'css' },
});
await cp('index.html', `${output}/index.html`);
await cp('index.html', `${output}/operador/index.html`);
await cp('public', assets, { recursive: true });