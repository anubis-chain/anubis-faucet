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
  // The AWS SDK still contains CommonJS modules with runtime requires for
  // Node built-ins. Give esbuild's ESM require shim a real Node require so
  // those modules work in Lambda instead of throwing during initialization.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  outdir: fileURLToPath(new URL('./dist', import.meta.url)),
  outExtension: { '.js': '.mjs' },
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Import both artifacts from a real ESM process so a missing CommonJS bridge
// fails the build instead of surfacing only after Lambda deployment.
await Promise.all([
  import(new URL('./dist/api.mjs', import.meta.url).href),
  import(new URL('./dist/reconcile.mjs', import.meta.url).href),
]);
