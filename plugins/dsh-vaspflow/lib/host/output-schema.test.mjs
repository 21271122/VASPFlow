/**
 * dsh-vaspflow host: end-to-end tool-output contract tests.
 *
 * Every registered tool's execute() result is validated against its compiled
 * output schema with the SAME validator the DSH registry uses
 * (validateJsonSchemaValue). This guards two past contract breaks:
 *  - vasp_check_inputs returned error:null under a { type: 'string' } schema,
 *    so any normal invocation was rejected by the host validator;
 *  - vasp_build_inputs defaulted into dry-run (args.dryRun !== false) while
 *    the tool description claimed "default false", silently building nothing.
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
const ctx = {
  tools: { register: (t) => registered.push(t) },
  logger: { info() {}, warn() {}, error() {} },
  on() {},
  effect() { return () => {}; },
  get() { return undefined; },
};
apply(ctx, {});

const builder = registered.find((t) => t.name === 'vasp_build_inputs');
const checker = registered.find((t) => t.name === 'vasp_check_inputs');
assert.ok(builder, 'vasp_build_inputs registered');
assert.ok(checker, 'vasp_check_inputs registered');

function assertValidOutputs(tool, result) {
  const violations = validateJsonSchemaValue(tool.output.schema, result, 'value');
  assert.deepEqual(violations, [], 'output must pass the host validator: ' + JSON.stringify(violations));
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

test('vasp_check_inputs output passes the host validator (good/bad/not-found)', async () => {
  const dir = makeFixture();
  try {
    const result = await checker.execute({ dirs: ['good', 'bad', 'missing'].map((d) => join(dir, d)) }, {});
    assertValidOutputs(checker, result);
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

test('vasp_build_inputs without dryRun writes for real (default false)', async () => {
  const dir = makeFixture();
  try {
    const tasks = [{ dir: 'out1', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm', freeAtoms: [37, 38, 39, 40] }];
    const result = await builder.execute({ projectRoot: dir, tasks }, {});
    assertValidOutputs(builder, result);
    assert.equal(result.dryRun, false);                   // default is a REAL build
    assert.equal(result.written, true);
    assert.equal(result.count, 1);
    assert.equal(result.wroteCount, 1);
    assert.ok(existsSync(join(dir, 'out1/POSCAR')), 'out1/POSCAR must exist after a real build');
    const poscar = await import('node:fs').then((fs) => fs.readFileSync(join(dir, 'out1/POSCAR'), 'utf-8'));
    assert.ok(poscar.includes('Selective dynamics'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_build_inputs with dryRun=true writes nothing (written=false)', async () => {
  const dir = makeFixture();
  try {
    const tasks = [{ dir: 'out2', poscarSrc: 'struc/surface.vasp', template: 'tpl', submitSrc: 'tpl/submit.slurm', freeAtoms: [37, 38, 39, 40] }];
    const result = await builder.execute({ projectRoot: dir, tasks, dryRun: true }, {});
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

test('check reports TRAILING_LINES for extra coordinate rows (P5)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-tr-'));
  try {
    mkdirSync(join(dir, 'd'));
    const poscar = POSCAR + '  0.000000E+00  0.000000E+00  0.000000E+00\n';
    writeFileSync(join(dir, 'd/POSCAR'), poscar);
    writeFileSync(join(dir, 'd/POTCAR'), POTCAR);
    const result = await checker.execute({ dirs: ['d'], projectRoot: dir }, {});
    assert.ok(result.results[0].sd.includes('TRAILING_LINES'), 'trailing rows must be reported: ' + result.results[0].sd);
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

test('vasp_src_inspect reports species/SD/junk + consistency (B1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-ins-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/1.vasp'), POSCAR);
    writeFileSync(join(dir, 'src/2.vasp'), POSCAR + '  0.000000E+00  0.000000E+00  0.000000E+00\n');
    const tool = registered.find((t) => t.name === 'vasp_src_inspect');
    assert.ok(tool);
    const result = await tool.execute({ rootPath: dir }, {});
    assertValidOutputs(tool, result);
    assert.equal(result.count, 2);
    assert.equal(result.files[0].elements.join(''), 'CuNO');
    assert.equal(result.files[1].trailingLines, 1);
    assert.equal(result.consistency.uniform, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vasp_scan_templates lists template dirs with files and params (B5)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-tpl-'));
  try {
    mkdirSync(join(dir, 't1'));
    writeFileSync(join(dir, 't1/INCAR'), 'SYSTEM = t1\nIBRION = 2\nNSW = 100\nENCUT = 400\nEDIFF = 1E-5; EDIFFG = -0.02\n');
    writeFileSync(join(dir, 't1/KPOINTS'), KPOINTS);
    writeFileSync(join(dir, 't1/POTCAR'), POTCAR);
    writeFileSync(join(dir, 't1/submit.slurm'), '#!/bin/bash\n');
    mkdirSync(join(dir, 't2'));
    writeFileSync(join(dir, 't2/INCAR'), 'SYSTEM = t2\nIBRION = 2\n');
    const tool = registered.find((t) => t.name === 'vasp_scan_templates');
    assert.ok(tool);
    const result = await tool.execute({ rootPath: dir }, {});
    assertValidOutputs(tool, result);
    assert.equal(result.count, 2);
    const t1 = result.templates.find((t) => t.relPath === 't1');
    assert.equal(t1.complete, true);
    assert.equal(t1.submit, 'submit.slurm');
    assert.equal(t1.params.EDIFFG, '-0.02');
    assert.equal(t1.files.length, 4);
    const t2 = result.templates.find((t) => t.relPath === 't2');
    assert.equal(t2.complete, false);
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
