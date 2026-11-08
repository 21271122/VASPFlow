/** Real DSH contract smoke. Set DSH_RUNTIME_ROOT to a directory containing
 * node_modules/@deepseek-ai/dsh; requires Node >=24.9 and pnpm on PATH.
 * Uses its own temporary DSH_HOME, profile and VASP fixture. No model call. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

assert.ok(process.env.DSH_RUNTIME_ROOT, 'Set DSH_RUNTIME_ROOT to the isolated DSH installation directory');
const runtime = createRequire(join(resolve(process.env.DSH_RUNTIME_ROOT), 'package.json'));
const load = (name) => import(pathToFileURL(runtime.resolve(name)).href);
assert.equal(runtime('@deepseek-ai/dsh/package.json').version, '0.2.2-rc.1');
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'vaspflow-dsh-022-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const { runProfile, initializeProfileFromDefault } = await load('@deepseek-ai/dsh/profile-boot');
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment');
const { assembleContextFor } = await load('@deepseek-ai/dsh-agent');
let shutdown;
let succeeded = false;
try {
  initializeProfileFromDefault('vaspflow-smoke', 'web', home);
  const cli = join(dirname(runtime.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
  const installed = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'vaspflow-smoke', 'add', plugin], { env: process.env, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  const boot = await runProfile({ environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]), profile: 'vaspflow-smoke', patchFiles: [], args: ['--host', '127.0.0.1', '--port', '0', '--no-open'] });
  shutdown = boot.shutdown;
  const { ctx } = boot;
  const preset = await ctx.agentPresets.resolve('vasp');
  assert.ok(!preset.error, JSON.stringify(preset));
  assert.equal(ctx.tools.get('vasp_build_inputs'), undefined, 'VASP tools must not leak globally');
  const fixture = join(home, 'fixture');
  const destination = join(fixture, 'current');
  mkdirSync(destination, { recursive: true });
  const inputs = { POSCAR: 'H\n1\n3 0 0\n0 3 0\n0 0 10\nH\n1\nDirect\n0 0 0\n', INCAR: 'ENCUT = 400\n', KPOINTS: 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n', POTCAR: 'TITEL = PAW_PBE H 1.0\n', 'notes.txt': 'extra template preview\n' };
  for (const [name, content] of Object.entries(inputs)) writeFileSync(join(destination, name), content);
  const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: fixture, agentPreset: 'vasp' }, setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'vasp'); } });
  try {
    const { agent } = handle;
    const assemble = () => ctx.systemPrompt.assemble(assembleContextFor(agent));
    const initial = await assemble();
    assert.equal(initial.tools.filter(t => t.name.startsWith('vasp_')).length, 10);
    await ctx.workingDirectory.set(agent, destination);
    const execute = async (name, args) => {
      const result = await ctx.tools.execute({ agent, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) }] });
      assert.equal(result.results[0].result.isError, false, JSON.stringify(result));
      if (name === 'vasp_build_inputs') assert.equal(result.concluded, true, 'preview must conclude the turn');
      return result.results[0].result.value;
    };
    const discovered = await execute('vasp_discover_inputs', { maxDepth: 0 });
    assert.equal(discovered.root_path, destination, 'must use committed cwd, not session header');
    const preview = await execute('vasp_build_inputs', { tasks: [{ dir: 'built', poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep', extraFiles: [{ src: 'notes.txt', dest: 'notes.txt' }] }] });
    assert.ok(preview.planId, JSON.stringify(preview));
    assert.match((await assemble()).contexts.find(c => c.name === 'vasp-build-outcomes').text, /尚未写入/);
    assert.ok(!(await ctx.systemPrompt.assemble()).contexts.some(c => c.name === 'vasp-build-outcomes'), 'operational context must remain scoped');
    assert.equal(preview.results[0].files['notes.txt'].written, inputs['notes.txt']);
    const origin = ctx.webServer.getOrigin();
    const response = await fetch(new URL('/plugins/dsh-vaspflow/build-inputs/confirm', origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: preview.planId, revision: preview.revision, selectedIndices: [0] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).wroteCount, 1);
    assert.equal(readFileSync(join(destination, 'built', 'notes.txt'), 'utf8'), inputs['notes.txt']);
    assert.match((await assemble()).contexts.find(c => c.name === 'vasp-build-outcomes').text, /用户已在界面确认，写入 1\/1/);
    console.log('[runtime] official install, preset activation, 10 scoped tools, native executor, working directory, extra file preview, HTTP confirmation and build outcome context passed');
  } finally { await handle.dispose(); }
  succeeded = true;
} finally {
  if (shutdown) await shutdown.shutdown(succeeded ? 0 : 1);
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
}
