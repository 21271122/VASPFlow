/**
 * dsh-vaspflow host: end-to-end tool-output contract tests.
 *
 * Every registered tool's execute() result is validated against its compiled
 * output schema with the SAME validator the DSH registry uses
 * (validateJsonSchemaValue). This guards two past contract breaks:
 *  - vasp_check_inputs returned error:null under a { type: 'string' } schema,
 *    so any normal invocation was rejected by the host validator;
 *  - vasp_build_inputs must use the plugin-owned preview mode instead of
 *    accepting a model-supplied dryRun switch.
 *
 * Run: node --test lib/host/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { apply } from '../index.js';

// Register every tool with a minimal ctx (the same shape apply() expects).
const registered = [];
const services = new Map();
const ctx = {
  tools: { register: (t) => registered.push(t) },
  logger: { info() {}, warn() {}, error() {} },
  on() {},
  effect() { return () => {}; },
  get() { return undefined; },
  provide(key, value) {
    services.set(key, value);
    return () => services.delete(key);
  },
};
apply(ctx, {});
assert.deepEqual(registered, [], 'host startup must not register VASP tools globally');
services.get('vaspflowTools').register(ctx);

const builder = registered.find((t) => t.name === 'vasp_build_inputs');
const checker = registered.find((t) => t.name === 'vasp_check_inputs');
const collector = registered.find((t) => t.name === 'vasp_collect_results');
assert.ok(builder, 'vasp_build_inputs registered');
assert.ok(checker, 'vasp_check_inputs registered');
assert.ok(collector, 'vasp_collect_results registered');

function assertValidOutputs(tool, result) {
  const violations = validateJsonSchemaValue(tool.output.schema, result, 'value');
  assert.deepEqual(violations, [], 'output must pass the host validator: ' + JSON.stringify(violations));
}

function tool(name) {
  const found = registered.find((candidate) => candidate.name === name);
  assert.ok(found, `${name} registered`);
  return found;
}

const POSCAR = [
  'surface',
  '1.0',
  '  10.0 0.0 0.0',
  '  0.0 10.0 0.0',
  '  0.0 0.0 20.0',
  'Cu N O',
  '36 1 3',
  'Direct',
].concat(...Array.from({ length: 36 }, (_, i) => ['  ' + (i % 9) + '.0  ' + Math.floor(i / 9) + '.0  ' + (i * 0.1).toFixed(4)])).concat([
  '  0.500000  0.500000  0.420000',
  '  0.480000  0.500000  0.430000',
  '  0.520000  0.500000  0.430000',
  '  0.500000  0.450000  0.430000',
]).join('\n') + '\n';
const POTCAR = 'TITEL = PAW_GGA Cu 11.000000\n data a\nTITEL = PAW_GGA N 7.000000\n data b\nTITEL = PAW_GGA O 6.000000\n data c\n';
const INCAR = 'SYSTEM = surface\nENCUT = 400\nIBRION = 2\nNSW = 100\nEDIFF = 1E-5\nEDIFFG = -0.02\nISIF = 2\n';
const KPOINTS = 'k-points\n0\nGamma\n4 4 1\n0 0 0\n';
const SUBMIT = '#!/bin/bash\n#SBATCH --job-name=relax\nsrun vasp_std\n';

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-os-'));
  // good task directory
  mkdirSync(join(dir, 'good'));
  writeFileSync(join(dir, 'good/POSCAR'), POSCAR);
  writeFileSync(join(dir, 'good/POTCAR'), POTCAR);
  writeFileSync(join(dir, 'good/INCAR'), INCAR);
  writeFileSync(join(dir, 'good/KPOINTS'), KPOINTS);
  // broken POTCAR directory
  mkdirSync(join(dir, 'bad'));
  writeFileSync(join(dir, 'bad/POSCAR'), POSCAR);
  writeFileSync(join(dir, 'bad/POTCAR'), '');
  // build inputs sources
  mkdirSync(join(dir, 'tpl'));
  writeFileSync(join(dir, 'tpl/INCAR'), INCAR);
  writeFileSync(join(dir, 'tpl/KPOINTS'), KPOINTS);
  writeFileSync(join(dir, 'tpl/POTCAR'), POTCAR);
  writeFileSync(join(dir, 'tpl/submit.slurm'), SUBMIT);
  mkdirSync(join(dir, 'struc'));
  writeFileSync(join(dir, 'struc/surface.vasp'), POSCAR);
  return dir;
}

test('collect results combines subtree depth and exact paths without inventing missing data', async () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'group'));
    mkdirSync(join(dir, 'group/one'));
    for (const file of ['POSCAR', 'POTCAR', 'INCAR', 'KPOINTS']) writeFileSync(join(dir, 'group/one', file), file === 'POSCAR' ? POSCAR : file === 'POTCAR' ? POTCAR : file === 'INCAR' ? INCAR : KPOINTS);
    writeFileSync(join(dir, 'group/one/OSZICAR'), ' 1 F= -.100000E+01 E0= -.900000E+00\n 2 F= -.110000E+01 E0= -.100000E+01\n');
    const args = { rootPath: dir, scope: { subtrees: [{ relPath: 'group', maxDepth: 1 }], taskPaths: ['group/one', 'good'] }, calculationType: 'RELAXATION', metrics: ['last_ionic_free_energy', 'last_max_force', 'ionic_steps'] };
    const result = await collector.execute(args, {});
    assertValidOutputs(collector, result);
    assert.equal(result.error, '');
    assert.equal(result.rows.length, 2);
    const row = result.rows.find((item) => item.relPath.replace(/\\/g, '/') === 'group/one');
    assert.equal(row.matchedBy.length, 2);
    assert.equal(row.values.last_ionic_free_energy.value, -1.1);
    assert.equal(row.values.ionic_steps.value, 2);
    assert.equal(row.values.last_max_force.value, null);
    assert.equal(row.values.last_max_force.status, 'missing');
    const exact = await collector.execute({ ...args, scope: { taskPaths: ['group'] } }, {});
    assert.equal(exact.rows.length, 0, 'exact path does not include descendants');
    const shallow = await collector.execute({ ...args, scope: { subtrees: [{ relPath: 'group', maxDepth: 0 }] } }, {});
    assert.equal(shallow.rows.length, 0, 'depth zero does not include children');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collect frequency modes retains imaginary mode and refuses a ZPE value', async () => {
  const dir = makeFixture();
  try {
    writeFileSync(join(dir, 'good/INCAR'), 'IBRION = 5\nNSW = 1\nNFREE = 2\n');
    writeFileSync(join(dir, 'good/OUTCAR'), '  1 f  =  20.900983 THz 131.324750 2PiTHz 697.181730 cm-1 86.439549 meV\n  2 f/i=  1.000000 THz 6.283185 2PiTHz 33.356410 cm-1 4.135668 meV\n');
    const result = await collector.execute({ rootPath: dir, scope: { taskPaths: ['good'] }, calculationType: 'FREQUENCY_ZPE', metrics: ['frequencies', 'zpe', 'vibrational_entropy'], conditions: { temperatureK: 298.15 } }, {});
    assertValidOutputs(collector, result);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].values.frequencies.value.length, 2);
    assert.equal(result.rows[0].values.frequencies.value[1].kind, 'imaginary');
    assert.equal(result.rows[0].values.zpe.value, null);
    assert.equal(result.rows[0].values.vibrational_entropy.status, 'invalid');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function renderedText(toolDefinition, args, value) {
  return toolDefinition.output.render(args, value).map((block) => block.text ?? '').join('\n');
}

test('model-visible tool renders keep the requested result details', () => {
  const inspect = tool('vasp_inspect_tasks');
  const inspectRow = {
    rel_path: 'calc',
    status: { code: 'ERROR_DETECTED', label: '检测到错误', reason: 'slurm.out 匹配 ZBRENT_FATAL', evidence: [{ file: 'slurm.out', message: '匹配错误签名 ZBRENT_FATAL' }] },
    task_type: { code: 'RELAXATION', label: '结构优化 / 晶胞优化' },
    input_check: { code: 'PASS', label: '通过指定规则检查', evidence: [] },
    output_files: [{ path: 'OUTCAR', size: 1200 }],
    files: [{ name: 'INCAR', size: 80 }, { name: 'POSCAR', size: 400 }],
    dirs: [{ name: 'restart' }],
    recommended_actions: [],
    error: '',
  };
  const inspectText = renderedText(inspect, {}, { results: [inspectRow], error: '' });
  assert.match(inspectText, /文件.*INCAR/);
  assert.match(inspectText, /先前输入规则检查记录/);
  assert.match(inspectText, /ZBRENT_FATAL/);

  const scanText = renderedText(tool('vasp_scan'), {}, {
    project_id: 1,
    tasks: [{ rel_path: 'calc', status: 'error', status_record: { label: '检测到错误' }, task_type: { label: '结构优化' } }],
    directories: [{ rel_path: 'calc', label: 'calc' }],
    error: '',
  });
  assert.match(scanText, /calc \| 检测到错误 \| 结构优化/);

  const convergenceText = renderedText(tool('vasp_convergence'), {}, {
    results: [{ rel_path: 'calc', ion_steps: [1, 2], energies: [-1, -2], max_forces: [0.4, 0.1], error: '' }], error: '',
  });
  assert.match(convergenceText, /能量/);
  assert.match(convergenceText, /-2/);

  const structureText = renderedText(tool('vasp_structure_scene'), {}, {
    results: [{ rel_path: 'calc', file: 'CONTCAR', summary: { formula: 'CuN', atom_count: 2 }, atoms: [{ element: 'Cu' }], bonds: [], bond_families: [], cell: {}, version: 1, warnings: [], error: '' }], error: '',
  });
  assert.match(structureText, /CONTCAR/);
  assert.match(structureText, /CuN/);

  const buildText = renderedText(tool('vasp_build_inputs'), {}, {
    results: [{ status: 'warn', dir: 'calc', sd: '1F, 1T', potcar: 'OK', sources: { POSCAR: 'src/POSCAR' }, sdNotes: [], warnings: ['未提供 submitSrc'], errors: [] }],
    okCount: 0, warnCount: 1, errorCount: 0, dryRun: true, planId: 'preview-1', count: 1, wroteCount: 0, written: false, error: '',
  });
  assert.match(buildText, /来源: POSCAR←src\/POSCAR/);
  assert.match(buildText, /未提供 submitSrc/);
  assert.match(buildText, /当前模式：用户预览确认/);
  assert.match(buildText, /等待用户在任务树确认/);
  assert.doesNotMatch(buildText, /建议回复/);

  const directText = renderedText(tool('vasp_build_inputs'), {}, {
    results: [{ dir: 'calc', wrote: true, warnings: [], errors: [] }],
    okCount: 1, warnCount: 0, errorCount: 0, dryRun: false, count: 1, wroteCount: 1, written: true, error: '',
  });
  assert.match(directText, /当前模式：交给 AI 直接构建/);
  assert.match(directText, /已写入 1\/1 个任务/);
  assert.doesNotMatch(directText, /确认构建/);

  const partialText = renderedText(tool('vasp_build_inputs'), {}, {
    results: [{ dir: 'calc', wrote: true, warnings: [], errors: [] }, { dir: 'failed', wrote: false, warnings: [], errors: ['源文件缺失'] }],
    okCount: 1, warnCount: 0, errorCount: 1, dryRun: false, count: 2, wroteCount: 1, written: true, error: '',
  });
  assert.match(partialText, /已写入 1\/2 个任务/);
  assert.doesNotMatch(partialText, /建议回复/);

  const buildArgs = {
    projectRoot: 'E:\\project',
    linkPotcar: true,
    tasks: [
      { dir: 'task-001', poscarSrc: 'structures/POSCAR', freeAtoms: [1, 2] },
      { dir: 'task-002', template: 'templates/relax' },
    ],
  };
  const buildCall = tool('vasp_build_inputs').presentCall(buildArgs);
  assert.equal(buildCall.card, 'generic');
  assert.equal(buildCall.kind, 'edit');
  assert.match(buildCall.content[0].text, /2 个任务/);
  assert.match(buildCall.content[0].text, /目标：构建 2 个任务/);
  assert.deepEqual(buildCall.locations.slice(0, 2), [{ path: 'task-001' }, { path: 'structures/POSCAR' }]);
  const buildResultView = tool('vasp_build_inputs').presentResult(buildArgs, {
    results: [{ dir: 'task-001', sd: '2T', potcar: 'OK', warnings: [], errors: [] }],
    okCount: 1, warnCount: 0, errorCount: 0, dryRun: true, count: 1, wroteCount: 0, error: '',
  });
  assert.match(buildResultView.title, /预览完成/);
  assert.match(buildResultView.content[0].text, /构建计划完成，未写入任何文件/);
  assert.match(buildResultView.content[0].text, /task-001/);
  const buildMeta = tool('vasp_build_inputs').output.presentationMeta(buildArgs, {
    results: [{ dir: 'task-001', sd: '2T', potcar: 'OK', sources: { POSCAR: 'src/POSCAR' }, warnings: [], errors: [] }],
    okCount: 1, warnCount: 0, errorCount: 0, dryRun: true, count: 1, wroteCount: 0, written: false, error: '',
  });
  const hostStyleResultView = tool('vasp_build_inputs').presentResult(buildArgs, {
    content: [{ type: 'text', text: 'canonical output' }], isError: false, meta: buildMeta,
  });
  assert.match(hostStyleResultView.content[0].text, /来源: POSCAR←src\/POSCAR/);

  const checkText = renderedText(tool('vasp_check_inputs'), {}, {
    results: [{ dir: 'calc', resolved: 'C:\\calc', poscarPotcar: 'OK', sd: 'SDx1', incar: { NSW: '100' }, kpoints: '2x2x1', warnings: [], input_check: { code: 'PASS', label: '通过指定规则检查', profileId: 'structure-optimization', evidence: [{ message: '规则通过' }] }, error: '' }],
    linked_count: 1, unlinked_dirs: [], error: '',
  });
  assert.match(checkText, /输入检查: 通过指定规则检查/);
  assert.match(checkText, /规则通过/);

  const discoverText = renderedText(tool('vasp_discover_inputs'), {}, {
    sources: { count: 1, consistency: { note: '源文件模式一致' }, files: [{ path: 'POSCAR', nAtoms: 2 }] },
    templates: [{ relPath: 'template', files: ['INCAR'], params: {}, complete: false }],
    error: '',
  });
  assert.match(discoverText, /POSCAR/);
  assert.match(discoverText, /template/);
});

test('all vasp_* tools honor the shared top-level error contract', async () => {
  const dir = makeFixture();
  try {
    const calc = join(dir, 'calc');
    mkdirSync(calc);
    writeFileSync(join(calc, 'POSCAR'), POSCAR);
    writeFileSync(join(calc, 'INCAR'), INCAR);
    writeFileSync(join(calc, 'KPOINTS'), KPOINTS);
    writeFileSync(join(calc, 'POTCAR'), POTCAR);
    writeFileSync(join(calc, 'CONTCAR'), POSCAR);
    writeFileSync(join(calc, 'OSZICAR'), '   1 F= -.100000E+02 E0= -.100000E+02 d E =0\n');
    writeFileSync(join(calc, 'OUTCAR'), ' free  energy   (TOTEN) =      -10.000000 eV\nreached required accuracy\nGeneral timing and accounting\n');

    const scan = tool('vasp_scan');
    const scanResult = await scan.execute({ rootPath: dir }, {});
    assertValidOutputs(scan, scanResult);
    assert.equal(scanResult.error, '');
    const successCases = [
      ['vasp_convergence', { rootPath: dir, relPaths: ['calc'] }],
      ['vasp_structure_scene', { rootPath: dir, structures: [{ relPath: 'calc' }] }],
      ['vasp_inspect_tasks', { rootPath: dir, relPaths: ['calc'] }],
      ['vasp_inspect_tasks', { rootPath: dir, relPaths: ['calc', 'good'] }],
      ['vasp_build_inputs', { projectRoot: dir, tasks: [{ dir: 'built', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm' }], dryRun: true }],
      ['vasp_check_inputs', { projectRoot: dir, dirs: ['good'] }],
      ['vasp_discover_inputs', { rootPath: dir }],
    ];
    for (const [name, args] of successCases) {
      const definition = tool(name);
      const result = await definition.execute(args, {});
      assertValidOutputs(definition, result);
      assert.equal(result.error, '', `${name} must use an empty error string on success`);
    }

    const failureCases = [
      ['vasp_scan', { rootPath: join(dir, 'missing') }],
      ['vasp_inspect_tasks', { rootPath: join(dir, 'missing'), relPaths: ['calc'] }],
      ['vasp_convergence', { rootPath: join(dir, 'missing'), relPaths: ['calc'] }],
      ['vasp_structure_scene', { rootPath: join(dir, 'missing'), structures: [{ relPath: 'calc' }] }],
      ['vasp_discover_inputs', { rootPath: join(dir, 'missing') }],
    ];
    for (const [name, args] of failureCases) {
      const definition = tool(name);
      const result = await definition.execute(args, {});
      assertValidOutputs(definition, result);
      assert.equal(typeof result.error, 'string');
      assert.notEqual(result.error, '', `${name} must explain its failed call`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_inspect_tasks reads status and file lists for several tasks without preview options', async () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'good2'));
    for (const [name, content] of [['POSCAR', POSCAR], ['POTCAR', POTCAR], ['INCAR', INCAR], ['KPOINTS', KPOINTS]]) {
      writeFileSync(join(dir, 'good2', name), content);
    }
    const batch = tool('vasp_inspect_tasks');
    assert.deepEqual(Object.keys(batch.parameters.properties).sort(), ['relPaths', 'rootPath']);
    const result = await batch.execute({ rootPath: dir, relPaths: ['good', 'good2', 'missing'] }, {});
    assertValidOutputs(batch, result);
    assert.equal(result.error, '');
    assert.deepEqual(result.results.map((row) => row.rel_path), ['good', 'good2', 'missing']);
    assert.ok(result.results[0].files.some((file) => file.name === 'INCAR'));
    assert.equal(result.results[0].preview, undefined);
    assert.ok(result.results[1].status?.code);
    assert.match(result.results[2].error, /不是已识别的 VASP 任务/);
    assert.match(renderedText(batch, {}, result), /good2/);
    assert.equal(batch.output.presentationMeta({}, result).results.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_check_inputs output passes the host validator (good/bad/not-found)', async () => {
  const dir = makeFixture();
  try {
    const result = await checker.execute({ dirs: ['good', 'bad', 'missing'].map((d) => join(dir, d)) }, {});
    assertValidOutputs(checker, result);
    assert.equal(result.project_root, process.cwd());
    assert.equal(checker.output.presentationMeta({}, result).projectRoot, process.cwd());
    assert.equal(result.results.length, 3);
    assert.equal(result.results[0].poscarPotcar, 'OK');
    assert.equal(result.results[0].error, '');            // error is always a string
    assert.equal(result.results[1].poscarPotcar, 'POTCAR_NO_TITEL');
    assert.equal(result.results[2].poscarPotcar, 'DIR_NOT_FOUND');
    assert.equal(result.results[2].error, '');
    assert.ok(result.results.every((r) => typeof r.resolved === 'string' && r.resolved.length > 0));
    assert.ok(result.results.every((r) => Array.isArray(r.warnings)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_build_inputs defaults to a preview without writing', async () => {
  const dir = makeFixture();
  try {
    const tasks = [{ dir: 'out1', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm', freeAtoms: [37, 38, 39, 40] }];
    let concluded = 0;
    const result = await builder.execute({ projectRoot: dir, tasks }, { concludeTurn() { concluded += 1; } });
    assertValidOutputs(builder, result);
    assert.equal(result.dryRun, true);
    assert.equal(result.written, false);
    assert.equal(result.count, 1);
    assert.equal(result.wroteCount, 0);
    assert.ok(result.planId);
    assert.equal(concluded, 1, 'a successful preview ends the model turn');
    assert.ok(!existsSync(join(dir, 'out1')), 'preview must not create the task directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_say and vasp_done validate and conclude without echoing speech', async () => {
  const say = tool('vasp_say');
  const done = tool('vasp_done');
  let concluded = 0;
  const exec = { concludeTurn() { concluded += 1; } };
  assert.deepEqual(await say.execute({ kind: 'answer', text: '  已确认。  ' }, exec), { delivered: true });
  assert.deepEqual(await done.execute({}, exec), { done: true });
  assert.equal(concluded, 2);
  await assert.rejects(() => say.execute({ kind: 'answer', text: '  ' }, exec));
  await assert.rejects(() => say.execute({ kind: 'question', text: '确认吗？' }, exec));
  await assert.rejects(() => say.execute({ kind: 'unknown', text: 'hello' }, exec));
  assert.equal(concluded, 2);
  assertValidOutputs(say, { delivered: true });
  assertValidOutputs(done, { done: true });
  assert.doesNotMatch(renderedText(say, {}, { delivered: true }), /已确认/);
});

test('vasp_build_inputs does not expose or honor a model-supplied dryRun switch', async () => {
  const dir = makeFixture();
  try {
    const tasks = [{ dir: 'out2', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm', freeAtoms: [37, 38, 39, 40] }];
    assert.equal(Object.hasOwn(builder.parameters, 'dryRun'), false);
    const result = await builder.execute({ projectRoot: dir, tasks, dryRun: false }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.dryRun, true);
    assert.equal(result.written, false);
    assert.equal(result.wroteCount, 0);
    assert.ok(!existsSync(join(dir, 'out2')), 'dry-run must not create the task directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('incar overrides are semicolon-aware (keep sibling tags, add missing)', async () => {
  const { applyIncarOverrides } = await import('./input-builder.js');
  // 分号行：只替换 EDIFF，同行的 EDIFFG 保留
  const out1 = applyIncarOverrides('SYSTEM = t\nENCUT = 400\nEDIFF = 1E-5; EDIFFG = -0.02\n', { EDIFF: '1E-6' });
  assert.ok(out1.includes('EDIFF = 1E-6; EDIFFG = -0.02'), 'sibling tag must survive: ' + out1);
  // 缺失 tag 追加（存在 tag 替换）
  const out2 = applyIncarOverrides('ENCUT = 400\n', { ALGO: 'Normal', ENCUT: '500' });
  assert.ok(out2.includes('ENCUT = 500'), 'existing tag replaced');
  assert.ok(out2.includes('ALGO = Normal'), 'missing tag appended');
  // ! 注释 + 分号
  const out3 = applyIncarOverrides('EDIFF = 1E-5 ! 收敛精度; EDIFFG = -0.02\n', { EDIFF: '1E-7' });
  assert.ok(out3.includes('EDIFF = 1E-7; EDIFFG = -0.02'), 'comment line override keeps sibling: ' + out3);
});

test('vasp_build_inputs template does not mutate frozen task objects (P6)', async () => {
  const dir = makeFixture();
  try {
    const frozen = Object.freeze({ dir: 'outF', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm', freeAtoms: [37, 38, 39, 40] });
    const result = await builder.execute({ projectRoot: dir, tasks: [frozen], dryRun: true }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.results[0].status, 'ok', 'frozen task must build without TypeError: ' + JSON.stringify(result.results[0].errors));
    assert.ok(result.results[0].sources.INCAR, 'template auto-fill must work on frozen input');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sources mapping resolves each file to a different directory', async () => {
  const dir = makeFixture(); // has tpl/{INCAR,KPOINTS,POTCAR,submit.slurm}
  try {
    mkdirSync(join(dir, 'altB'));
    writeFileSync(join(dir, 'altB/KPOINTS'), 'k-alt\n0\nGamma\n2 2 1\n0 0 0\n');
    const tasks = [{
      dir: 'outMix',
      poscarSrc: 'struc/surface.vasp',
      sources: { incar: 'tpl/INCAR', kpoints: 'altB/KPOINTS', potcar: 'tpl/POTCAR', submit: 'tpl/submit.slurm' },
      freeAtoms: [37, 38, 39, 40],
    }];
    const result = await builder.execute({ projectRoot: dir, tasks, dryRun: true }, {});
    assert.equal(result.results[0].status, 'ok', JSON.stringify(result.results[0].errors));
    assert.ok(result.results[0].sources.KPOINTS.includes('altB'), 'KPOINTS must come from altB: ' + JSON.stringify(result.results[0].sources));
    assert.ok(result.results[0].sources.INCAR.includes('tpl'), 'INCAR must come from tpl');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sdNotes surface flag rewrites against the source file (P3)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-sd-'));
  try {
    // source: atom 55 = F, 56 = T (as reported in the NO_scan batch)
    const poscar = 's\n1.0\n  10 0 0\n  0 10 0\n  0 0 20\nBi N O\n54 1 1\nDirect\n'
      + '  0.1 0.1 0.1   F   F   F\n'.repeat(54)
      + '  0.5 0.5 0.5   F   F   F\n'
      + '  0.6 0.5 0.5   T   T   T\n';
    writeFileSync(join(dir, 's.vasp'), poscar);
    mkdirSync(join(dir, 'tpl'));
    writeFileSync(join(dir, 'tpl/INCAR'), 'SYSTEM = t\nENCUT = 400\n');
    writeFileSync(join(dir, 'tpl/KPOINTS'), 'k\n0\nGamma\n3 3 1\n0 0 0\n');
    writeFileSync(join(dir, 'tpl/POTCAR'), 'TITEL = PAW_PBE Bi 15.0\n x\nTITEL = PAW_PBE N 7.0\n x\nTITEL = PAW_PBE O 6.0\n x\n');
    writeFileSync(join(dir, 'tpl/submit.sh'), '#!/bin/bash\n');
    // freeAtoms [55,56] flips atom 55 F->T (atom 56 stays T)
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh', freeAtoms: [55, 56] }], dryRun: true }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.results[0].status, 'ok');
    assert.ok(Array.isArray(result.results[0].sdNotes) && result.results[0].sdNotes.length > 0, 'flag rewrite must be surfaced: ' + JSON.stringify(result.results[0].sdNotes));
    assert.ok(result.results[0].sdNotes[0].includes('原子55'), 'must name atom 55');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_check_inputs resolves relative dirs via projectRoot (P1) + DIR_NOT_FOUND', async () => {
  const dir = makeFixture(); // good/bad inside
  try {
    const result = await checker.execute({ dirs: ['good', 'nope'], projectRoot: dir }, {});
    assertValidOutputs(checker, result);
    assert.equal(result.results[0].poscarPotcar, 'OK');
    assert.ok(result.results[0].resolved.startsWith(dir), 'resolved absolute under projectRoot');
    assert.equal(result.results[1].poscarPotcar, 'DIR_NOT_FOUND');
    assert.equal(result.results[1].error, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check ignores an optional POSCAR velocity block after ion positions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-tr-'));
  try {
    mkdirSync(join(dir, 'd'));
    const poscar = POSCAR + '\nCartesian\n' + Array.from({ length: 40 }, () => '  0.000000E+00  0.000000E+00  0.000000E+00').join('\n') + '\n';
    writeFileSync(join(dir, 'd/POSCAR'), poscar);
    writeFileSync(join(dir, 'd/POTCAR'), POTCAR);
    const result = await checker.execute({ dirs: ['d'], projectRoot: dir }, {});
    assert.ok(!result.results[0].sd.includes('TRAILING_LINES'), 'velocity rows must not be treated as atoms: ' + result.results[0].sd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check consistency groups differing SD patterns across dirs (P4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-cons-'));
  try {
    const poscarA = POSCAR; // from fixture: 36F/4T after build? source is no-SD; use built-style files
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a/POSCAR'), poscarWithoutFlagsToSd(36, 4));
    writeFileSync(join(dir, 'a/POTCAR'), POTCAR);
    writeFileSync(join(dir, 'a/INCAR'), INCAR);
    writeFileSync(join(dir, 'a/KPOINTS'), KPOINTS);
    mkdirSync(join(dir, 'b'));
    writeFileSync(join(dir, 'b/POSCAR'), poscarWithoutFlagsToSd(35, 5)); // different SD pattern
    writeFileSync(join(dir, 'b/POTCAR'), POTCAR);
    writeFileSync(join(dir, 'b/INCAR'), INCAR);
    writeFileSync(join(dir, 'b/KPOINTS'), KPOINTS);
    const result = await checker.execute({ dirs: ['a', 'b'], projectRoot: dir }, {});
    assertValidOutputs(checker, result);
    assert.equal(result.consistency.uniform, false, 'two SD patterns must be split: ' + JSON.stringify(result.consistency));
    assert.equal(result.consistency.groups.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function poscarWithoutFlagsToSd(fCnt, tCnt) {
  const lines = ['s', '1.0', '  10 0 0', '  0 10 0', '  0 0 20', 'Cu N O', '36 1 3', 'Selective dynamics', 'Direct'];
  for (let i = 0; i < fCnt; i += 1) lines.push('  0.1 0.1 0.1   F   F   F');
  for (let i = 0; i < tCnt; i += 1) lines.push('  0.2 0.2 0.2   T   T   T');
  return lines.join('\n') + '\n';
}

test('vasp_discover_inputs reports structure sources and their consistency', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-ins-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/1.vasp'), POSCAR);
    writeFileSync(join(dir, 'src/2.vasp'), POSCAR + '  0.000000E+00  0.000000E+00  0.000000E+00\n');
    const tool = registered.find((t) => t.name === 'vasp_discover_inputs');
    assert.ok(tool);
    const result = await tool.execute({ rootPath: dir }, {});
    assertValidOutputs(tool, result);
    assert.equal(result.sources.count, 2);
    assert.equal(result.sources.files[0].elements.join(''), 'CuNO');
    assert.equal(result.sources.files[1].trailingLines, 1);
    assert.equal(result.sources.consistency.uniform, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_discover_inputs lists candidate templates with files and parameters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-tpl-'));
  try {
    mkdirSync(join(dir, 't1'));
    writeFileSync(join(dir, 't1/INCAR'), 'SYSTEM = t1\nIBRION = 2\nNSW = 100\nENCUT = 400\nEDIFF = 1E-5; EDIFFG = -0.02\n');
    writeFileSync(join(dir, 't1/KPOINTS'), KPOINTS);
    writeFileSync(join(dir, 't1/POTCAR'), POTCAR);
    writeFileSync(join(dir, 't1/submit.slurm'), '#!/bin/bash\n');
    mkdirSync(join(dir, 't2'));
    writeFileSync(join(dir, 't2/INCAR'), 'SYSTEM = t2\nIBRION = 2\n');
    const tool = registered.find((t) => t.name === 'vasp_discover_inputs');
    assert.ok(tool);
    const result = await tool.execute({ rootPath: dir }, {});
    assertValidOutputs(tool, result);
    assert.equal(result.templates.length, 2);
    const t1 = result.templates.find((t) => t.relPath === 't1');
    assert.equal(t1.complete, true);
    assert.equal(t1.submit, 'submit.slurm');
    assert.equal(t1.params.EDIFFG, '-0.02');
    assert.equal(t1.files.length, 4);
    const t2 = result.templates.find((t) => t.relPath === 't2');
    assert.equal(t2.complete, false);
    assert.deepEqual(t2.missing, ['KPOINTS', 'POTCAR', '提交脚本（可选）']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sdPolicy=keep reuses source flags verbatim (no rewrite)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-kp-'));
  try {
    // source already carries 54F + 1T(N) + 1T(O) style flags
    const poscar = 's\n1.0\n  10 0 0\n  0 10 0\n  0 0 20\nBi N O\n54 1 1\nSelective dynamics\nDirect\n'
      + '  0.1 0.1 0.1   F   F   F\n'.repeat(54)
      + '  0.5 0.5 0.5   F   F   F\n'   // atom 55 F
      + '  0.6 0.5 0.5   T   T   T\n';  // atom 56 T
    writeFileSync(join(dir, 's.vasp'), poscar);
    mkdirSync(join(dir, 'tpl'));
    writeFileSync(join(dir, 'tpl/INCAR'), 'SYSTEM = t\nENCUT = 400\n');
    writeFileSync(join(dir, 'tpl/KPOINTS'), 'k\n0\nGamma\n3 3 1\n0 0 0\n');
    writeFileSync(join(dir, 'tpl/POTCAR'), 'TITEL = PAW_PBE Bi 15.0\n x\nTITEL = PAW_PBE N 7.0\n x\nTITEL = PAW_PBE O 6.0\n x\n');
    writeFileSync(join(dir, 'tpl/submit.sh'), '#!/bin/bash\n');
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh', sdPolicy: 'keep' }], dryRun: true }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.results[0].status, 'ok', JSON.stringify(result.results[0].errors));
    assert.equal(result.results[0].sdNotes.length, 0, 'keep must rewrite nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sdPolicy=keep with no source SD: copies verbatim + warning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-kp2-'));
  try {
    const poscar = 's\n1.0\n  10 0 0\n  0 10 0\n  0 0 20\nCu N O\n36 1 3\nDirect\n'
      + '  0.1 0.1 0.1\n'.repeat(40);
    writeFileSync(join(dir, 's.vasp'), poscar);
    mkdirSync(join(dir, 'tpl'));
    writeFileSync(join(dir, 'tpl/INCAR'), 'SYSTEM = t\nENCUT = 400\n');
    writeFileSync(join(dir, 'tpl/KPOINTS'), 'k\n0\nGamma\n3 3 1\n0 0 0\n');
    writeFileSync(join(dir, 'tpl/POTCAR'), 'TITEL = PAW_PBE Cu 11.0\n x\nTITEL = PAW_PBE N 7.0\n x\nTITEL = PAW_PBE O 6.0\n x\n');
    writeFileSync(join(dir, 'tpl/submit.sh'), '#!/bin/bash\n');
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh', sdPolicy: 'keep' }], dryRun: true }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.results[0].status, 'warn');
    assert.ok(result.results[0].warnings.some((w) => w.includes('全部放开')), 'must warn about open SD: ' + JSON.stringify(result.results[0].warnings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sdPolicy=keep with source coordinates missing flags: task errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-kp3-'));
  try {
    // 36 with flags + 4 WITHOUT flags -> cannot "keep" consistently
    const poscar = 's\n1.0\n  10 0 0\n  0 10 0\n  0 0 20\nCu N O\n36 1 3\nSelective dynamics\nDirect\n'
      + '  0.1 0.1 0.1   F   F   F\n'.repeat(36)
      + '  0.5 0.5 0.5\n  0.6 0.5 0.5\n  0.7 0.5 0.5\n  0.8 0.5 0.5\n';
    writeFileSync(join(dir, 's.vasp'), poscar);
    mkdirSync(join(dir, 'tpl'));
    writeFileSync(join(dir, 'tpl/INCAR'), 'SYSTEM = t\nENCUT = 400\n');
    writeFileSync(join(dir, 'tpl/KPOINTS'), 'k\n0\nGamma\n3 3 1\n0 0 0\n');
    writeFileSync(join(dir, 'tpl/POTCAR'), 'TITEL = PAW_PBE Cu 11.0\n x\nTITEL = PAW_PBE N 7.0\n x\nTITEL = PAW_PBE O 6.0\n x\n');
    writeFileSync(join(dir, 'tpl/submit.sh'), '#!/bin/bash\n');
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh', sdPolicy: 'keep' }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'error');
    assert.ok(result.results[0].errors.some((e) => e.includes('sdPolicy=keep')), JSON.stringify(result.results[0].errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sdFixture(dir, withSd) {
  mkdirSync(join(dir, 'tpl'));
  writeFileSync(join(dir, 'tpl/INCAR'), 'SYSTEM = t\nENCUT = 400\n');
  writeFileSync(join(dir, 'tpl/KPOINTS'), 'k\n0\nGamma\n3 3 1\n0 0 0\n');
  writeFileSync(join(dir, 'tpl/POTCAR'), 'TITEL = PAW_PBE Bi 15.0\n x\nTITEL = PAW_PBE N 7.0\n x\nTITEL = PAW_PBE O 6.0\n x\n');
  writeFileSync(join(dir, 'tpl/submit.sh'), '#!/bin/bash\n');
  const sd = withSd
    ? 'Selective dynamics\nDirect\n' + '  0.1 0.1 0.1   F   F   F\n'.repeat(54) + '  0.5 0.5 0.5   F   F   F\n  0.6 0.5 0.5   T   T   T\n'
    : 'Direct\n' + '  0.1 0.1 0.1\n'.repeat(40);
  writeFileSync(join(dir, 's.vasp'), 's\n1.0\n  10 0 0\n  0 10 0\n  0 0 20\nBi N O\n54 1 1\n' + sd);
}

test('sdPolicy defaults to keep: source SD preserved, no rewrite, no sdNotes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-dk-'));
  try {
    sdFixture(dir, true); // source carries 54F/1F/1T
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh' }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'ok', JSON.stringify(result.results[0].errors));
    assert.equal(result.results[0].sdNotes.length, 0, 'default keep rewrites nothing');
    assert.ok(result.results[0].sd.includes('55F, 1T'), result.results[0].sd); // 54 Bi F + N F + O T
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staged build: missing poscar/submit are warnings, not errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-stg-'));
  try {
    sdFixture(dir, false); // no SD (source copied verbatim under keep)
    // no submitSrc, no poscarSrc -> copy INCAR/KPOINTS/POTCAR only
    const result = await builder.execute({ projectRoot: dir, tasks: [{ dir: 'o1', template: 'tpl' }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'warn');
    assert.equal(result.results[0].errors.length, 0, JSON.stringify(result.results[0].errors));
    assert.ok(result.results[0].warnings.some((w) => w.includes('poscarSrc')), JSON.stringify(result.results[0].warnings));
    assert.ok(result.results[0].warnings.some((w) => w.includes('submitSrc')), JSON.stringify(result.results[0].warnings));
    assert.equal(result.results[0].potcar, 'N/A');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('projectRoot/rootPath default to session workspace when omitted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-ws-'));
  try {
    sdFixture(dir, true);
    const exec = { agent: { session: { header: { cwd: dir } } } };
    const result = await builder.execute({ tasks: [{ dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh' }], dryRun: true }, exec);
    assert.equal(result.results[0].status, 'ok', 'workspace must be picked from exec: ' + JSON.stringify(result.results[0].errors));
    // check tool too (dynamic import: ESM test file has no require)
    const fsx = await import('node:fs');
    mkdirSync(join(dir, 'good'));
    writeFileSync(join(dir, 'good/POSCAR'), fsx.readFileSync(join(dir, 's.vasp'), 'utf-8'));
    writeFileSync(join(dir, 'good/POTCAR'), fsx.readFileSync(join(dir, 'tpl/POTCAR'), 'utf-8'));
    writeFileSync(join(dir, 'good/INCAR'), fsx.readFileSync(join(dir, 'tpl/INCAR'), 'utf-8'));
    writeFileSync(join(dir, 'good/KPOINTS'), fsx.readFileSync(join(dir, 'tpl/KPOINTS'), 'utf-8'));
    const c = await checker.execute({ dirs: ['good'] }, exec);
    assert.equal(c.results[0].poscarPotcar, 'OK', 'check must resolve via workspace');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extraFiles: explicit src copy with custom dest name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-xf-'));
  try {
    sdFixture(dir, true);
    writeFileSync(join(dir, 'WAVECAR-src'), 'wave data\n');
    const result = await builder.execute({ projectRoot: dir, tasks: [{
      dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh',
      extraFiles: [{ src: 'WAVECAR-src', dest: 'WAVECAR' }],
    }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'ok', JSON.stringify(result.results[0].errors));
    assert.ok(result.results[0].sources.WAVECAR, 'WAVECAR must be staged: ' + JSON.stringify(result.results[0].sources));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extraFiles: fromTemplate copies when present, warns when absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-xf2-'));
  try {
    sdFixture(dir, true);
    writeFileSync(join(dir, 'tpl/DOSCAR'), 'dos\n');
    const result = await builder.execute({ projectRoot: dir, tasks: [{
      dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh',
      extraFiles: [{ fromTemplate: 'DOSCAR' }, { fromTemplate: 'EIGENVAL' }],
    }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'warn');
    assert.equal(result.results[0].errors.length, 0);
    assert.ok(result.results[0].sources.DOSCAR, 'DOSCAR from template must be staged');
    assert.ok(result.results[0].warnings.some((w) => w.includes('EIGENVAL')), JSON.stringify(result.results[0].warnings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extraFiles: missing explicit src is an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-xf3-'));
  try {
    sdFixture(dir, true);
    const result = await builder.execute({ projectRoot: dir, tasks: [{
      dir: 'o1', poscarSrc: 's.vasp', template: 'tpl', submitSrc: 'tpl/submit.sh',
      extraFiles: [{ src: 'nope/WAVECAR', dest: 'WAVECAR' }],
    }], dryRun: true }, {});
    assert.equal(result.results[0].status, 'error');
    assert.ok(result.results[0].errors.some((e) => e.includes('额外输入文件')), JSON.stringify(result.results[0].errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
