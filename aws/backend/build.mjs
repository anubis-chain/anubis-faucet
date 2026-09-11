import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: {
    api: fileURLToPath(new URL('./api.js', import.meta.url)),
    reconcile: fileURLToPath(new URL('./reconcile.js', import.meta.url)),
  },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: fileURLToPath(new URL('./dist', import.meta.url)),
  outExtension: { '.js': '.mjs' },
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});
