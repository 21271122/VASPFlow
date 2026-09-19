/**
 * dsh-vaspflow host integration smoke test: exercises the HTTP route
 * handlers and agent tool payloads against a real sample directory without a
 * full Cordis runtime. Uses a minimal fake ctx/webServer to drive `apply`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import * as vaspPresetTools from '../../preset/vasp/tools/vaspflow-tools.mjs';

/** Minimal fake Cordis context + webServer that captures registered routes. */
function makeFakeCtx() {
  const routes = new Map(); // path -> route
  const exact = new Map();
  const prefixes = new Map();
  const registered = [];
  const services = new Map();
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
    on() {},
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
  return { ctx, routes, match, registered, services };
}

/** Drive a route handler with a request and return the parsed JSON body. */
async function callRoute(matchFn, url, method = 'GET') {
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
  await route.handler({ url, method }, res);
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
after(() => rmSync(SAMPLE_ROOT, { recursive: true, force: true }));

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
    'vasp_convergence', 'vasp_discover_inputs', 'vasp_inspect_task',
    'vasp_scan', 'vasp_structure_scene',
  ].sort());
});

test('ping returns ok', async () => {
  const { ctx, match } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  const result = await callRoute(match, '/plugins/dsh-vaspflow/ping');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
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

    const tasks = await callRoute(match, `/plugins/dsh-vaspflow/tasks/${scanNested.body.project_id}`);
    assert.equal(tasks.body[0].input_check.code, 'PASS');
    assert.equal(tasks.body[0].input_check.profileId, 'structure-optimization');
    const parentTasks = await callRoute(match, `/plugins/dsh-vaspflow/tasks/${scanParent.body.project_id}`);
    assert.equal(parentTasks.body[0].input_check.code, 'PASS');
    assert.equal(parentTasks.body[0].input_check.profileId, 'structure-optimization');
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

  assert.equal(registered.length, 7);
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
  const args = { rootPath: SAMPLE_ROOT, relPath: '1-NO3-Cu111' };
  const convergenceResult = await convergence.execute(args, {});
  const structureResult = await structure.execute(args, {});
  assert.equal(convergenceResult.error, '');
  assert.equal(convergenceResult.rel_path, args.relPath);
  assert.ok(convergenceResult.ion_steps.length > 0);
  assert.equal(structureResult.error, '');
  assert.equal(structureResult.rel_path, args.relPath);
  assert.ok(structureResult.atoms.length > 0);
});
