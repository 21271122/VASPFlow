/**
 * dsh-vaspflow host integration smoke test: exercises the HTTP route
 * handlers and agent tool payloads against a real sample directory without a
 * full Cordis runtime. Uses a minimal fake ctx/webServer to drive `apply`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const SAMPLE_ROOT = 'D:\\Projects\\VASPFlow\\preset-construction\\build\\sample-vasp';

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
    'vasp_build_inputs', 'vasp_check_inputs', 'vasp_convergence',
    'vasp_incar_validate', 'vasp_outcar_parse',
    'vasp_read_file', 'vasp_scan', 'vasp_scan_templates', 'vasp_src_inspect',
    'vasp_structure_scene', 'vasp_task_files',
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
    'error_message', 'final_energy', 'final_max_force', 'id', 'incar_summary',
    'is_converged', 'is_vasp_task', 'label', 'lattice_consts', 'magmom_total',
    'n_ion_steps', 'rel_path', 'status', 'system',
  ].sort());
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

  assert.equal(registered.length, 11);
  assert.ok(registered.some((tool) => tool.name === 'vasp_incar_validate'));
  assert.ok(registered.some((tool) => tool.name === 'vasp_outcar_parse'));
});

test('migrated deterministic tools keep their INCAR and OUTCAR behaviour', async () => {
  const { ctx, services, registered } = makeFakeCtx();
  apply(ctx, { defaultScanRoot: '' });
  services.get('vaspflowTools').register(ctx);

  const validate = registered.find((tool) => tool.name === 'vasp_incar_validate');
  const parse = registered.find((tool) => tool.name === 'vasp_outcar_parse');
  const incar = await validate.execute({ incarText: 'IBRION = 2\nNSW = 30\nEDIFF = 1E-5\nEDIFFG = -0.02\nENCUT = 400\n', jobType: 'relax' });
  const outcar = await parse.execute({ outcarText: 'free  energy   (TOTEN) =      -12.345678 eV\nreached required accuracy\n' });

  assert.equal(incar.ok, true);
  assert.equal(outcar.converged, true);
  assert.equal(outcar.energy, -12.345678);
});
