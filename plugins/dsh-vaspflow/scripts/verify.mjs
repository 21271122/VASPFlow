/**
 * dsh-vaspflow verify: artifact consistency checks.
 *
 * - package.json exports "." and "./client" point at real files;
 * - the client bundle starts with the __ModuleLoader__.load header;
 * - cordis.patch.yml exists;
 * - the host half imports cleanly (deps resolvable from the package dir).
 *
 * Exit non-zero on any failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(root, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`[verify] FAIL: ${msg}`);
};

// 1) exports targets exist
for (const [sub, spec] of Object.entries(pkg.exports ?? {})) {
  const target = typeof spec === 'string' ? spec : spec.default;
  if (typeof target !== 'string') continue;
  if (!existsSync(resolve(root, '..', target))) {
    fail(`exports["${sub}"] target missing: ${target}`);
  }
}

// 1b) the published npx command must be included in the package.
for (const target of Object.values(pkg.bin ?? {})) {
  if (typeof target === 'string' && !existsSync(resolve(root, '..', target))) {
    fail(`bin target missing: ${target}`);
  }
}

// 2) client bundle header
const clientPath = resolve(root, '../lib/client.js');
if (!existsSync(clientPath)) {
  fail('lib/client.js missing');
} else {
  const head = readFileSync(clientPath, 'utf8').slice(0, 200);
  if (!head.includes('window.__ModuleLoader__.load')) {
    fail('lib/client.js does not start with __ModuleLoader__.load header');
  }
}

// 3) cordis.patch.yml exists
if (!existsSync(resolve(root, '../cordis.patch.yml'))) {
  fail('cordis.patch.yml missing');
}

// 4) host half imports
try {
  const mod = await import('../lib/index.js');
  if (mod.name !== 'dsh-vaspflow') fail(`host name mismatch: ${mod.name}`);
} catch (error) {
  fail(`host import failed: ${error.message}`);
}

if (failed) process.exit(1);
console.log('[verify] dsh-vaspflow artifacts OK');
