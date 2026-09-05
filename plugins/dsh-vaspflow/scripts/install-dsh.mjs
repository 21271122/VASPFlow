#!/usr/bin/env node

/**
 * Install the published VASPFlow bundle into one DSH profile, then install
 * its bundled Agent preset. This is the command exposed through `npx`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, '..');
const pkg = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8'));
const supportedDshVersion = '0.1.0-rc.6';

const args = process.argv.slice(2);
let profile = null;
let dshHome = null;
let replace = false;
let packageSpec = `${pkg.name}@${pkg.version}`;

function usage() {
  console.log(`Usage: ${pkg.name} install --profile <name> [--replace] [--dsh-home <path>]`);
  console.log('');
  console.log('Installs the VASPFlow DSH bundle and its bundled VASP Agent preset.');
  console.log('Existing presets are kept unless --replace is supplied.');
}

function readDshVersion(command, env) {
  const result = spawnSync(command, ['--version'], {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const version = output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null;
  return { ok: result.status === 0 && version !== null, version };
}

if (args[0] === '--help' || args[0] === '-h') {
  usage();
  process.exit(0);
}

if (args.shift() !== 'install') {
  usage();
  process.exitCode = 1;
} else {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--profile') {
      profile = args[index + 1] ?? null;
      index += 1;
    } else if (arg === '--dsh-home') {
      dshHome = args[index + 1] ?? null;
      index += 1;
    } else if (arg === '--replace') {
      replace = true;
    } else if (arg === '--package') {
      packageSpec = args[index + 1] ?? '';
      index += 1;
    } else {
      console.error(`Unknown option: ${arg}`);
      usage();
      process.exitCode = 1;
      break;
    }
  }
}

if (process.exitCode === undefined && (!profile || !/^[A-Za-z0-9_-]+$/.test(profile))) {
  console.error('A profile name containing only letters, numbers, hyphens, and underscores is required.');
  usage();
  process.exitCode = 1;
}

if (process.exitCode === undefined && !packageSpec) {
  console.error('--package requires an npm package specifier.');
  process.exitCode = 1;
}

if (process.exitCode === undefined && !/^[A-Za-z0-9@._/:#-]+$/.test(packageSpec)) {
  console.error('--package contains unsupported characters.');
  process.exitCode = 1;
}

if (process.exitCode === undefined) {
  const env = { ...process.env };
  if (dshHome) env.DSH_HOME = resolve(dshHome);
  const dshCommand = 'dsh';
  const dshAvailable = process.platform === 'win32'
    ? spawnSync('where.exe', [dshCommand], { stdio: 'ignore' }).status === 0
    : spawnSync('sh', ['-c', `command -v ${dshCommand}`], { stdio: 'ignore' }).status === 0;

  if (!dshAvailable) {
    console.error(`DSH was not found on PATH. Install @deepseek-ai/dsh@${supportedDshVersion}, then restart the terminal and run this command again.`);
    process.exitCode = 1;
  } else {
    const dshVersion = readDshVersion(dshCommand, env);
    if (!dshVersion.ok) {
      console.error('Could not determine the installed DSH version. Run "dsh --version" and make sure it works before installing VASPFlow.');
      process.exitCode = 1;
    } else if (dshVersion.version !== supportedDshVersion) {
      console.error(`VASPFlow ${pkg.version} supports DSH ${supportedDshVersion}; found ${dshVersion.version}.`);
      console.error(`Install the supported version with: npm install -g @deepseek-ai/dsh@${supportedDshVersion}`);
      process.exitCode = 1;
    } else {
      console.log(`DSH ${supportedDshVersion} detected. Installing ${packageSpec} into profile "${profile}"...`);
      const pluginResult = spawnSync(dshCommand, ['plugin', '--profile', profile, 'add', packageSpec], {
        cwd: process.cwd(),
        env,
        shell: process.platform === 'win32',
        stdio: 'inherit',
      });

      if (pluginResult.error) {
        console.error(`DSH could not be started: ${pluginResult.error.message}`);
        process.exitCode = 1;
      } else if (pluginResult.status !== 0) {
        process.exitCode = pluginResult.status ?? 1;
      } else {
        const presetArgs = [resolve(scriptDir, 'install-preset.mjs')];
        if (dshHome) presetArgs.push('--dsh-home', resolve(dshHome));
        if (replace) presetArgs.push('--replace');

        const presetResult = spawnSync(process.execPath, presetArgs, { env, stdio: 'inherit' });
        process.exitCode = presetResult.status ?? 1;
        if (presetResult.status === 0) {
          console.log('VASPFlow installation complete. Restart DSH, then choose “VASP 计算助手” for a new session.');
        }
      }
    }
  }
}
