/**
 * dsh-vaspflow client bundle build.
 *
 * Bundles src/client/index.tsx into lib/client.js in the shell's client-plugin
 * format:
 *
 *   window.__ModuleLoader__.load({
 *     id: 'dsh-vaspflow',
 *     factory: (require) => {
 *       var module = { exports: {} };
 *       var exports = module.exports;
 *       ...bundled code (externalized requires for react / react-dom)...
 *       return module.exports;
 *     }
 *   });
 *
 * react / react-dom / react/jsx-runtime and @deepseek-ai/* stay external
 * (resolved through the shell's shared require at runtime); antd / recharts /
 * three are bundled in.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const banner = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-vaspflow",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
].join('\n');

const footer = [
  '    return module.exports;',
  '  }',
  '});',
].join('\n');

const result = await build({
  entryPoints: [resolve(root, 'src/client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: resolve(root, 'lib/client.js'),
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
    '@deepseek-ai/*',
  ],
  banner: { js: banner },
  footer: { js: footer },
  sourcemap: false,
  minify: false,
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx' },
  jsx: 'automatic',
  logLevel: 'warning',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log(`[build-client] wrote lib/client.js (${result.outputFiles?.[0]?.contents?.length ?? '?'} bytes)`);
