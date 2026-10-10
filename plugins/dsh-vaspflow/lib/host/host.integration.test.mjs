/**
 * dsh-vaspflow host integration smoke test: exercises the HTTP route
 * handlers and agent tool payloads against a real sample directory without a
 * full Cordis runtime. Uses a minimal fake ctx/webServer to drive `apply`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { apply } from '../index.js';
import * as vaspPresetTools from '../../preset/vasp/tools/vaspflow-tools.mjs';

/** Minimal fake Cordis context + webServer that captures registered routes. */
function makeFakeCtx() {
  const routes = new Map(); // path -> route
  const exact = new Map();
  const prefixes = new Map();
  const registered = [];
  const services = new Map();
  const hooks = new Map();
  const tools = {
    register(def) {
      registered.push(def);
      return () => {};
    },
  };
  /** Longest-prefix-wins after an exact miss (mirrors dsh-host-webserver). */
  const match = (pathname) => {
    const exactHit = exact.get(pathname);
    if (exactHit !== undefined) return exactHit;
    let best;
    for (const [prefix, route] of prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (best === undefined || prefix.length > best.path.length) best = route;
    }
    return best;
  };
  const ctx = {
    get(key) {
      if (key === 'webServer' || key === 'httpServer') return webServer;
      return undefined;
    },
    on(name, handler) { hooks.set(name, handler); },
    effect(fn) {
      fn();
      return () => {};
    },
    provide(key, value) {
      services.set(key, value);
      return () => services.delete(key);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools,
  };
  const webServer = {
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes;
      table.set(route.path, route);
      routes.set(route.path, route);
    },
    match,
  };
  return { ctx, routes, match, registered, services, hooks };
}

/** Drive a route handler with a request and return the parsed JSON body. */
async function callRoute(matchFn, url, method = 'GET', payload) {
  const pathname = new URL(url, 'http://x').pathname;
  const route = matchFn(pathname);
  assert.ok(route !== undefined, `no route matched ${pathname}`);
  let body = '';
  const res = {
    writeHead(status, headers) {
      res._status = status;
      res._headers = headers;
    },
    end(chunk) {
      body = chunk;
    },
  };
  const req = { url, method, async *[Symbol.asyncIterator]() { if (payload !== undefined) yield Buffer.from(JSON.stringify(payload)); } };
  await route.handler(req, res);
  return { status: res._status, body: body === '' ? null : JSON.parse(body) };
}

async function callStreamRoute(matchFn, url) {
  const pathname = new URL(url, 'http://x').pathname;
  const route = matchFn(pathname);
  assert.ok(route !== undefined, `no route matched ${pathname}`);
  let body = '';
  const res = {
    writeHead(status, headers) { res._status = status; res._headers = headers; },
    write(chunk) { body += chunk; },
    end(chunk = '') { body += chunk; },
  };
  await route.handler({ url, method: 'GET' }, res);
  return { status: res._status, body };
}

const SAMPLE_ROOT = mkdtempSync(join(tmpdir(), 'vfp-integration-'));
const ORIGINAL_DSH_HOME = process.env.DSH_HOME;
const TEST_DSH_HOME = mkdtempSync(join(tmpdir(), 'vfp-integration-home-'));
process.env.DSH_HOME = TEST_DSH_HOME;
const SAMPLE_TASK = join(SAMPLE_ROOT, '1-NO3-Cu111');
mkdirSync(SAMPLE_TASK);
const SAMPLE_POSCAR = 'sample\n1\n3 0 0\n0 3 0\n0 0 10\nH\n1\nDirect\n0 0 0\n';
writeFileSync(join(SAMPLE_TASK, 'POSCAR'), SAMPLE_POSCAR);
writeFileSync(join(SAMPLE_TASK, 'CONTCAR'), SAMPLE_POSCAR);
writeFileSync(join(SAMPLE_TASK, 'INCAR'), 'SYSTEM = sample\nIBRION = 2\nNSW = 20\n');
writeFileSync(join(SAMPLE_TASK, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
writeFileSync(join(SAMPLE_TASK, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
writeFileSync(join(SAMPLE_TASK, 'OSZICAR'), '  1 F= -1\n  2 F= -2\n  3 F= -3\n');
writeFileSync(join(SAMPLE_TASK, 'OUTCAR'), 'reached required accuracy\nGeneral timing and accounting\n');
after(() => {
  if (ORIGINAL_DSH_HOME === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = ORIGINAL_DSH_HOME;
  rmSync(SAMPLE_ROOT, { recursive: true, force: true });
  rmSync(TEST_DSH_HOME, { recursive: true, force: true });
});

test('apply registers routes globally and VASP tools only through the preset service', () => {
  const { ctx, routes, registered, services } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const paths = [...routes.keys()];
  assert.ok(paths.includes('/plugins/dsh-vaspflow/ping'));
  assert.ok(paths.includes('/plugins/dsh-vaspflow/version'));
  assert.ok(paths.includes('/plugins/dsh-vaspflow/scan'));
  assert.ok(paths.includes('/plugins/dsh-vaspflow/tasks'));
  assert.ok(paths.includes('/plugins/dsh-vaspflow/task/open-by-path'));
  assert.ok(paths.includes('/plugins/dsh-vaspflow/task'));
  assert.deepEqual(registered, [], 'host startup must not expose VASP tools globally');
  const vaspflowTools = services.get('vaspflowTools');
  assert.ok(vaspflowTools, 'host must provide the VASP preset service');
  vaspflowTools.register(ctx);
  const toolNames = registered.map((t) => t.name);
  assert.deepEqual(toolNames.sort(), [
    'vasp_build_inputs', 'vasp_check_inputs',
    'vasp_collect_results', 'vasp_convergence', 'vasp_discover_inputs', 'vasp_done', 'vasp_inspect_tasks',
    'vasp_say', 'vasp_scan', 'vasp_structure_scene',
  ].sort());
});

test('ping returns ok', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const result = await callRoute(match, '/plugins/dsh-vaspflow/ping');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('build preview confirmation writes selected tasks and user can switch direct mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-confirm-'));
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    const { ctx, match, registered, services } = makeFakeCtx();
    apply(ctx, { defaultScanRoot: '' });
    services.get('vaspflowTools').register(ctx);
    const builder = registered.find((tool) => tool.name === 'vasp_build_inputs');
    const task = (dir) => ({ dir, poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep' });
    const preview = await builder.execute({ projectRoot: root, tasks: [task('confirmed-one'), task('confirmed-two')] }, {});
    assert.equal(preview.written, false);
    assert.ok(preview.planId);
    assert.equal(builder.output.presentationMeta({}, preview).planId, preview.planId);
    assert.equal(existsSync(join(root, 'confirmed-two')), false);
    const result = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: preview.revision, selectedIndices: [1] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.wroteCount, 1);
    assert.equal(existsSync(join(root, 'confirmed-one')), false);
    assert.equal(existsSync(join(root, 'confirmed-two', 'POSCAR')), true);
    const retry = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: preview.revision, selectedIndices: [1] });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, result.body);
    const again = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: preview.revision, selectedIndices: [0] });
    assert.equal(again.status, 409);
    const secondPreview = await builder.execute({ projectRoot: root, tasks: [task('cancelled')] }, {});
    const cancelled = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: secondPreview.planId, revision: secondPreview.revision, cancel: true });
    assert.equal(cancelled.body.cancelled, true);
    const afterCancel = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: secondPreview.planId, selectedIndices: [0] });
    assert.equal(afterCancel.status, 409);
    assert.equal(existsSync(join(root, 'cancelled')), false);
    const thirdPreview = await builder.execute({ projectRoot: root, tasks: [task('enable-direct')] }, {});
    const enabled = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: thirdPreview.planId, revision: thirdPreview.revision, selectedIndices: [0], enableDirect: true });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal(enabled.body.dryRunMode, false);
    const direct = await builder.execute({ projectRoot: root, tasks: [task('direct-build')], dryRun: true }, {});
    assert.equal(direct.dryRun, false, 'legacy model argument must not override the global mode');
    assert.equal(direct.wroteCount, 1);
    assert.equal(existsSync(join(root, 'direct-build', 'POSCAR')), true);
    const restored = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/mode', 'POST', { dryRun: true });
    assert.equal(restored.body.dryRun, true);
    const againPreview = await builder.execute({ projectRoot: root, tasks: [task('after-restore')] }, {});
    assert.equal(againPreview.dryRun, true);
    assert.equal(existsSync(join(root, 'after-restore')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dragged sources re-preview one build task and confirmation writes the revised plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-repreview-'));
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    writeFileSync(join(root, 'ALT.vasp'), SAMPLE_POSCAR.replace('sample', 'alternate'));
    mkdirSync(join(root, 'template-b'));
    writeFileSync(join(root, 'template-b', 'INCAR'), 'SYSTEM = new-template\nNSW = 80\n');
    for (const name of ['KPOINTS', 'POTCAR']) copyFileSync(join(root, name), join(root, 'template-b', name));
    const { ctx, match, registered, services } = makeFakeCtx();
    apply(ctx, {});
    services.get('vaspflowTools').register(ctx);
    const builder = registered.find((tool) => tool.name === 'vasp_build_inputs');
    const preview = await builder.execute({ projectRoot: root, tasks: [{ dir: 'revised', poscarSrc: 'POSCAR', incarSrc: 'INCAR', sources: { incar: 'INCAR', kpoints: 'KPOINTS', potcar: 'POTCAR' }, sdPolicy: 'keep' }] }, {});
    const source = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/repreview', 'POST', { planId: preview.planId, revision: preview.revision, taskIndex: 0, sourceKind: 'structure', rootPath: root, relPath: '.', file: 'ALT.vasp' });
    assert.equal(source.status, 200, JSON.stringify(source.body));
    assert.equal(source.body.tasks[0].poscarSrc, join(root, 'ALT.vasp'));
    const template = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/repreview', 'POST', { planId: preview.planId, revision: source.body.revision, taskIndex: 0, sourceKind: 'template', rootPath: root, relPath: 'template-b' });
    assert.equal(template.status, 200, JSON.stringify(template.body));
    assert.equal(template.body.tasks[0].incarSrc, undefined);
    assert.equal(template.body.tasks[0].sources.incar, undefined);
    assert.equal(template.body.wroteCount, 0);
    assert.equal(existsSync(join(root, 'revised')), false);
    const oldRevision = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: preview.revision, selectedIndices: [0] });
    assert.equal(oldRevision.status, 409);
    assert.equal(existsSync(join(root, 'revised')), false);
    const result = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: template.body.revision, selectedIndices: [0] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(readFileSync(join(root, 'revised', 'POSCAR'), 'utf8'), /alternate/);
    assert.match(readFileSync(join(root, 'revised', 'INCAR'), 'utf8'), /new-template/);
    const stale = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/repreview', 'POST', { planId: preview.planId, taskIndex: 0, sourceKind: 'template', rootPath: root, relPath: 'template-b' });
    assert.equal(stale.status, 409);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a confirmed preview is visible to the next model turn and after host restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-confirm-context-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'dsh-home');
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    writeFileSync(join(root, 'ALT.vasp'), SAMPLE_POSCAR.replace('sample', 'alternate'));
    const sessionId = 'test-confirm-context';
    const { ctx, match, registered, services, hooks } = makeFakeCtx();
    apply(ctx, {});
    services.get('vaspflowTools').register(ctx);
    const builder = registered.find((item) => item.name === 'vasp_build_inputs');
    const preview = await builder.execute({ projectRoot: root, tasks: [{ dir: 'confirmed', poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep' }] }, { agent: { session: { header: { id: sessionId } } }, concludeTurn() {} });
    const assembled = () => hooks.get('system-prompt/assemble')({}, { agent: { session: { header: { id: sessionId } } } }, async () => ({ tools: [{ name: 'vasp_build_inputs' }], contexts: [] }));
    assert.match((await assembled()).contexts[0].text, /尚未写入/);
    const revised = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/repreview', 'POST', { planId: preview.planId, taskIndex: 0, sourceKind: 'structure', rootPath: root, relPath: '.', file: 'ALT.vasp' });
    assert.equal(revised.status, 200);
    assert.match((await assembled()).contexts[0].text, /ALT\.vasp/);
    const response = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: revised.body.revision, selectedIndices: [0] });
    assert.equal(response.status, 200);
    assert.match((await assembled()).contexts[0].text, /用户已在界面确认，写入 1\/1/);
    assert.match((await assembled()).contexts[0].text, /ALT\.vasp/);
    const restarted = makeFakeCtx();
    apply(restarted.ctx, {});
    const context = await restarted.hooks.get('system-prompt/assemble')({}, { agent: { session: { header: { id: sessionId } } } }, async () => ({ tools: [{ name: 'vasp_build_inputs' }], contexts: [] }));
    assert.match(context.contexts[0].text, /用户已在界面确认，写入 1\/1/);
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pending build survives restart and confirmation can be retried without another write', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-persistent-plan-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'dsh-home');
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    const first = makeFakeCtx();
    apply(first.ctx, {});
    first.services.get('vaspflowTools').register(first.ctx);
    const builder = first.registered.find((item) => item.name === 'vasp_build_inputs');
    const preview = await builder.execute({ projectRoot: root, tasks: [{ dir: 'survives', poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep' }] }, {});
    const restarted = makeFakeCtx();
    apply(restarted.ctx, {});
    const status = await callRoute(restarted.match, `/plugins/dsh-vaspflow/build-inputs/plan?planId=${preview.planId}`);
    assert.equal(status.body.state, 'pending');
    assert.equal(status.body.revision, 1);
    const confirmed = await callRoute(restarted.match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: 1, selectedIndices: [0] });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const target = join(root, 'survives', 'INCAR');
    writeFileSync(target, 'marker after confirmation\n');
    const restartedAgain = makeFakeCtx();
    apply(restartedAgain.ctx, {});
    const retry = await callRoute(restartedAgain.match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: 1, selectedIndices: [0] });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, confirmed.body);
    assert.equal(readFileSync(target, 'utf8'), 'marker after confirmation\n');
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a source changed after preview invalidates confirmation before writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-source-changed-'));
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    const { ctx, match, registered, services } = makeFakeCtx();
    apply(ctx, {});
    services.get('vaspflowTools').register(ctx);
    const builder = registered.find((item) => item.name === 'vasp_build_inputs');
    const preview = await builder.execute({ projectRoot: root, tasks: [{ dir: 'should-not-write', poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep' }] }, {});
    writeFileSync(join(root, 'INCAR'), 'SYSTEM = changed after preview\nIBRION = 2\nNSW = 20\n');
    const result = await callRoute(match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: preview.revision, selectedIndices: [0] });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /来源.*变化/);
    assert.equal(existsSync(join(root, 'should-not-write')), false);
    const status = await callRoute(match, `/plugins/dsh-vaspflow/build-inputs/plan?planId=${preview.planId}`);
    assert.equal(status.body.state, 'invalidated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an interrupted write is reported as uncertain and cannot be confirmed again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-interrupted-write-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'dsh-home');
  try {
    for (const name of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, name));
    const first = makeFakeCtx();
    apply(first.ctx, {});
    first.services.get('vaspflowTools').register(first.ctx);
    const builder = first.registered.find((item) => item.name === 'vasp_build_inputs');
    const preview = await builder.execute({ projectRoot: root, tasks: [{ dir: 'interrupted', poscarSrc: 'POSCAR', incarSrc: 'INCAR', kpointsSrc: 'KPOINTS', potcarSrc: 'POTCAR', sdPolicy: 'keep' }] }, {});
    const planFile = join(process.env.DSH_HOME, 'vaspflow', 'build-plans.json');
    const plans = JSON.parse(readFileSync(planFile, 'utf8'));
    plans[preview.planId].state = 'writing';
    writeFileSync(planFile, JSON.stringify(plans));
    const restarted = makeFakeCtx();
    apply(restarted.ctx, {});
    const status = await callRoute(restarted.match, `/plugins/dsh-vaspflow/build-inputs/plan?planId=${preview.planId}`);
    assert.equal(status.body.state, 'uncertain');
    const retry = await callRoute(restarted.match, '/plugins/dsh-vaspflow/build-inputs/confirm', 'POST', { planId: preview.planId, revision: 1, selectedIndices: [0] });
    assert.equal(retry.status, 409);
    assert.equal(existsSync(join(root, 'interrupted')), false);
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan returns tasks matching the Python field contract', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const url = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`;
  const result = await callRoute(match, url, 'POST');
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.project_id, 'number');
  assert.equal(result.body.tasks.length, 1);
  const task = result.body.tasks[0];
  assert.equal(task.label, '1-NO3-Cu111');
  assert.equal(task.status, 'finished');
  assert.equal(task.is_converged, true);
  assert.equal(task.n_ion_steps, 3);
  assert.equal(typeof task.final_energy, 'number');
  assert.deepEqual(Object.keys(task).sort(), [
    'directory_type', 'error_message', 'final_energy', 'final_max_force', 'id', 'incar_summary', 'input_check',
    'is_converged', 'is_vasp_task', 'label', 'lattice_consts', 'magmom_total',
    'n_ion_steps', 'output_files', 'rel_path', 'status', 'status_record', 'system', 'task_type',
  ].sort());
});

test('task input-check route uses an explicit profile and saves its result', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const scan = await callRoute(match, `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`, 'POST');
  const taskId = scan.body.tasks[0].id;
  const checked = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/input-check?profile_id=structure-optimization`, 'POST');
  assert.equal(checked.status, 200);
  assert.equal(checked.body.input_check.profileId, 'structure-optimization');
  assert.equal(checked.body.raw_check.poscarPotcar, 'OK');
  assert.equal(checked.body.input_check.code, 'PASS');
  const projectTasks = await callRoute(match, `/plugins/dsh-vaspflow/tasks/${scan.body.project_id}`);
  assert.equal(projectTasks.body[0].input_check.profileId, 'structure-optimization');
});

test('agent input checks link after scanning a parent root and then a nested root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-nested-root-'));
  const nestedRoot = join(root, 'client_verify');
  const taskDir = join(nestedRoot, '8-_NH2OH');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'POSCAR'), SAMPLE_POSCAR);
  writeFileSync(join(taskDir, 'INCAR'), 'IBRION = 2\nNSW = 20\n');
  writeFileSync(join(taskDir, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
  writeFileSync(join(taskDir, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
  try {
    const { ctx, match, registered, services } = makeFakeCtx();
    apply(ctx, { defaultScanRoot: '' });
    services.get('vaspflowTools').register(ctx);
    const scanParent = await callRoute(match, `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(root)}`, 'POST');
    assert.equal(scanParent.body.tasks[0].rel_path.replace(/\\/g, '/'), 'client_verify/8-_NH2OH');
    const scanNested = await callRoute(match, `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(nestedRoot)}`, 'POST');
    assert.equal(scanNested.body.tasks[0].rel_path, '8-_NH2OH');

    const checkInputs = registered.find((tool) => tool.name === 'vasp_check_inputs');
    const checked = await checkInputs.execute({
      projectRoot: nestedRoot,
      dirs: ['8-_NH2OH'],
      profileId: 'structure-optimization',
    }, {});
    assert.equal(checked.linked_count, 1);
    assert.deepEqual(checked.unlinked_dirs, []);
    assert.match(checkInputs.output.render({}, checked)[0].text, /\[规则通过\]/);

    const tasks = await callRoute(match, `/plugins/dsh-vaspflow/tasks/${scanNested.body.project_id}`);
    assert.equal(tasks.body[0].input_check.code, 'PASS');
    assert.equal(tasks.body[0].input_check.profileId, 'structure-optimization');
    const parentTasks = await callRoute(match, `/plugins/dsh-vaspflow/tasks/${scanParent.body.project_id}`);
    assert.equal(parentTasks.body[0].input_check.code, 'PASS');
    assert.equal(parentTasks.body[0].input_check.profileId, 'structure-optimization');
    const rawOnly = await checkInputs.execute({ projectRoot: nestedRoot, dirs: ['8-_NH2OH'] }, {});
    assert.equal(rawOnly.results[0].input_check.code, 'NOT_REQUESTED');
    assert.deepEqual(rawOnly.results[0].input_check.checkedFiles, ['POSCAR', 'POTCAR', 'INCAR', 'KPOINTS']);
    assert.match(checkInputs.output.render({}, rawOnly)[0].text, /\[已解析·未套规则\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('incremental scan route emits breadth-first scan events', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const stream = await callStreamRoute(match, `/plugins/dsh-vaspflow/scan-events?root_path=${encodeURIComponent(SAMPLE_ROOT)}`);
  assert.equal(stream.status, 200);
  assert.match(stream.body, /event: scan-start/);
  assert.match(stream.body, /event: directory-scanned/);
  assert.match(stream.body, /event: scan-complete/);
});

test('convergence route returns chart data', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  // First scan to register the task id.
  const scanUrl = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`;
  const scan = await callRoute(match, scanUrl, 'POST');
  const taskId = scan.body.tasks[0].id;
  const conv = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/convergence`);
  assert.equal(conv.status, 200);
  assert.equal(conv.body.ion_steps.length, 3);
  assert.equal(conv.body.energies.length, 3);
  assert.equal(conv.body.max_forces.length, 3);
});

test('structure-scene route returns scene JSON', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const scanUrl = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`;
  const scan = await callRoute(match, scanUrl, 'POST');
  const taskId = scan.body.tasks[0].id;
  const scene = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/structure-scene?file=CONTCAR`);
  assert.equal(scene.status, 200);
  assert.equal(scene.body.version, 1);
  assert.ok(Array.isArray(scene.body.cell.vectors));
  assert.ok(Array.isArray(scene.body.atoms));
  assert.equal(scene.body.summary.bond_algorithm, 'minimum-distance');
});

test('files and file-content routes', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const scanUrl = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`;
  const scan = await callRoute(match, scanUrl, 'POST');
  const taskId = scan.body.tasks[0].id;
  const files = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/files`);
  assert.equal(files.status, 200);
  assert.ok(files.body.files.some((f) => f.name === 'INCAR'));
  const content = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/file-content?name=INCAR`);
  assert.equal(content.status, 200);
  assert.ok(content.body.content.includes('SYSTEM'));
  assert.equal(content.body.truncated, false);
  assert.equal(content.body.offset, 0);
  assert.equal(content.body.totalSize, content.body.size);
});

test('discovered structure files preview through VASPFlow even outside a complete task', async () => {
  const sourceDir = join(SAMPLE_ROOT, 'structure-only');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'candidate.vasp'), SAMPLE_POSCAR);
  mkdirSync(join(sourceDir, 'nested'), { recursive: true });
  writeFileSync(join(sourceDir, 'nested', 'nested.vasp'), SAMPLE_POSCAR);
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const opened = await callRoute(match, `/plugins/dsh-vaspflow/task/open-by-path?root_path=${encodeURIComponent(SAMPLE_ROOT)}&rel_path=structure-only`, 'POST');
  assert.equal(opened.status, 200);
  const structures = await callRoute(match, `/plugins/dsh-vaspflow/task/${opened.body.id}/structure-files`);
  assert.ok(structures.body.files.includes('candidate.vasp'));
  assert.ok(!structures.body.files.includes('nested.vasp'));
  const scene = await callRoute(match, `/plugins/dsh-vaspflow/task/${opened.body.id}/structure-scene?file=candidate.vasp`);
  assert.equal(scene.status, 200);
  assert.ok(scene.body.atoms.length > 0);
  const preview = await callRoute(match, `/plugins/dsh-vaspflow/task/${opened.body.id}/file-content?name=candidate.vasp&offset=0`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.content, SAMPLE_POSCAR);
});

test('file-content route reads a large file in bounded chunks', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  writeFileSync(join(SAMPLE_TASK, 'large.log'), 'A'.repeat(700_000));
  const scan = await callRoute(match, `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`, 'POST');
  const taskId = scan.body.tasks[0].id;
  const content = await callRoute(match, `/plugins/dsh-vaspflow/task/${taskId}/file-content?name=large.log&offset=0&length=1024`);
  assert.equal(content.status, 200);
  assert.equal(content.body.offset, 0);
  assert.equal(content.body.length, 1024);
  assert.equal(content.body.hasAfter, true);
  assert.equal(content.body.content.length, 1024);
});

test('preset-scoped vasp_scan returns the same data as the scan route', async () => {
  const { ctx, match, registered, services } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  services.get('vaspflowTools').register(ctx);
  const tool = registered.find((t) => t.name === 'vasp_scan');
  const out = await tool.execute({ rootPath: SAMPLE_ROOT });
  assert.equal(out.tasks.length, 1);
  assert.equal(typeof out.project_id, 'number');
  // Same task fields as route output.
  const scanUrl = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(SAMPLE_ROOT)}`;
  const routeOut = await callRoute(match, scanUrl, 'POST');
  assert.equal(out.tasks[0].label, routeOut.body.tasks[0].label);
});

test('VASP preset bridge registers the host service only in its own scope', () => {
  const { ctx, registered, services } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });

  const presetCtx = {
    tools: ctx.tools,
    vaspflowTools: services.get('vaspflowTools'),
  };
  vaspPresetTools.apply(presetCtx);

  assert.equal(registered.length, 10);
  for (const tool of registered) {
    assert.equal(Object.hasOwn(tool.parameters ?? {}, 'taskId'), false, `${tool.name} must not expose taskId`);
  }
});

test('path-based convergence and structure tools work without a task id or prior scan', async () => {
  const { ctx, services, registered } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  services.get('vaspflowTools').register(ctx);
  const convergence = registered.find((tool) => tool.name === 'vasp_convergence');
  const structure = registered.find((tool) => tool.name === 'vasp_structure_scene');
  const convergenceResult = await convergence.execute({ rootPath: SAMPLE_ROOT, relPaths: ['1-NO3-Cu111'] }, {});
  const structureResult = await structure.execute({ rootPath: SAMPLE_ROOT, structures: [{ relPath: '1-NO3-Cu111' }] }, {});
  assert.equal(convergenceResult.error, '');
  assert.equal(convergenceResult.results[0].rel_path, '1-NO3-Cu111');
  assert.ok(convergenceResult.results[0].ion_steps.length > 0);
  assert.equal(structureResult.error, '');
  assert.equal(structureResult.results[0].rel_path, '1-NO3-Cu111');
  assert.ok(structureResult.results[0].atoms.length > 0);
});

test('structure tool reads NEB images and standalone files without local task inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-neb-scene-'));
  const outside = mkdtempSync(join(tmpdir(), 'vfp-outside-scene-'));
  try {
    const image = join(root, 'neb', '02');
    mkdirSync(image, { recursive: true });
    mkdirSync(join(root, 'sources'));
    for (const name of ['INCAR', 'KPOINTS', 'POTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(root, 'neb', name));
    for (const name of ['POSCAR', 'CONTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(image, name));
    copyFileSync(join(SAMPLE_TASK, 'POSCAR'), join(root, 'sources', 'sample.vasp'));
    copyFileSync(join(SAMPLE_TASK, 'POSCAR'), join(outside, 'POSCAR'));
    const { ctx, services, registered } = makeFakeCtx();
    apply(ctx, {});
    services.get('vaspflowTools').register(ctx);
    const structure = registered.find((tool) => tool.name === 'vasp_structure_scene');
    const result = await structure.execute({ rootPath: root, structures: [
      { relPath: 'neb/02', file: 'POSCAR' }, { relPath: 'neb/02' },
      { relPath: 'sources', file: 'sample.vasp' }, { relPath: 'neb/02', file: 'missing.vasp' },
      { relPath: relative(root, outside), file: 'POSCAR' }, { relPath: 'neb/02', file: relative(image, join(outside, 'POSCAR')) },
    ] }, {});
    assert.equal(result.error, '');
    for (const row of result.results.slice(0, 3)) {
      assert.equal(row.error, '');
      assert.ok(row.atoms.length > 0);
    }
    assert.match(result.results[3].error, /未找到结构文件/);
    assert.match(result.results[4].error, /结构目录必须位于项目根目录内/);
    assert.match(result.results[5].error, /结构文件必须位于项目根目录内/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('structure tool accepts 20 references and rejects 21', async () => {
  const { ctx, services, registered } = makeFakeCtx();
  apply(ctx, {});
  services.get('vaspflowTools').register(ctx);
  const tool = registered.find((tool) => tool.name === 'vasp_structure_scene');
  const structures = Array.from({ length: 20 }, () => ({ relPath: '1-NO3-Cu111', file: 'POSCAR' }));
  const result = await tool.execute({ rootPath: SAMPLE_ROOT, structures }, {});
  assert.equal(result.error, '');
  assert.equal(result.results.length, 20);
  assert.ok(result.results.every((row) => !row.error && row.atoms.length > 0));
  const overflow = await tool.execute({ rootPath: SAMPLE_ROOT, structures: [...structures, structures[0]] }, {});
  assert.match(overflow.error, /1–20/);
  assert.equal(overflow.results.length, 0);
});

test('convergence and structure tools return separate cross-task result panes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-multi-scene-'));
  try {
    for (const rel of ['A', 'B']) {
      const dir = join(root, rel);
      mkdirSync(dir);
      for (const name of ['POSCAR', 'CONTCAR', 'INCAR', 'KPOINTS', 'POTCAR', 'OSZICAR', 'OUTCAR']) copyFileSync(join(SAMPLE_TASK, name), join(dir, name));
    }
    const { ctx, services, registered } = makeFakeCtx();
    apply(ctx, {});
    services.get('vaspflowTools').register(ctx);
    const convergence = registered.find((tool) => tool.name === 'vasp_convergence');
    const structure = registered.find((tool) => tool.name === 'vasp_structure_scene');
    const curves = await convergence.execute({ rootPath: root, relPaths: ['A', 'B'] }, {});
    const scenes = await structure.execute({ rootPath: root, structures: [{ relPath: 'A', file: 'CONTCAR' }, { relPath: 'B', file: 'POSCAR' }] }, {});
    assert.deepEqual(curves.results.map((row) => row.rel_path), ['A', 'B']);
    assert.ok(curves.results.every((row) => row.ion_steps.length === 3));
    assert.ok(curves.results.every((row) => row.source_path?.startsWith(root)));
    assert.deepEqual(scenes.results.map((row) => `${row.rel_path}/${row.file}`), ['A/CONTCAR', 'B/POSCAR']);
    assert.ok(scenes.results.every((row) => row.atoms.length > 0));
    assert.equal(structure.output.presentationMeta({}, scenes).results.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
