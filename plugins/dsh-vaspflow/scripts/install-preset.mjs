/**
 * Install VASPFlow's bundled Agent preset into one DSH home directory.
 *
 * The script never overwrites an existing preset unless --replace is explicit.
 * A replaced preset is renamed to a timestamped backup instead of deleted.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
let replace = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--dsh-home') {
    const value = args[index + 1];
    if (!value) throw new Error('--dsh-home requires a directory path');
    dshHome = value;
    index += 1;
  } else if (arg === '--replace') {
    replace = true;
  } else if (arg === '--help') {
    console.log('Usage: node scripts/install-preset.mjs [--dsh-home <path>] [--replace]');
    process.exit(0);
  } else {
    throw new Error(`Unknown option: ${arg}`);
  }
}

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pluginRoot, 'preset', 'vasp');
const destination = resolve(dshHome, '.agent-presets', 'vasp');

if (!existsSync(source)) throw new Error(`Bundled preset not found: ${source}`);

let backup = null;
if (existsSync(destination)) {
  if (!replace) {
    console.log(`Preset already exists and was not changed: ${destination}`);
    console.log('Run again with --replace to install this bundled version and keep a backup.');
    process.exit(0);
  }
  backup = `${destination}.backup-${Date.now()}`;
  renameSync(destination, backup);
}

const staging = `${destination}.tmp-${process.pid}-${Date.now()}`;
try {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, staging, { recursive: true, errorOnExist: true });
  renameSync(staging, destination);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  if (backup !== null && !existsSync(destination)) renameSync(backup, destination);
  throw error;
}

console.log(`Installed VASPFlow Agent preset: ${destination}`);
if (backup !== null) console.log(`Previous preset backup: ${backup}`);
console.log('Restart DSH, then choose “VASP 计算助手” when creating a new session.');
