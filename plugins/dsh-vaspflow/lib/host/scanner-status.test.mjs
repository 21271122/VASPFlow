/**
 * B1 task-state regression fixtures.  These intentionally use tiny synthetic
 * VASP files: the scanner only owns file-system facts and must not need VASP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearScanCache, scanProject, scanSingleDir } from './scanner.js';

function fixture() {
  return mkdtempSync(join(tmpdir(), 'vfp-b1-'));
}

function inputs(dir, incar = 'SYSTEM = test\nNSW = 0\n') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'POSCAR'), 'test\n1\n1 0 0\n0 1 0\n0 0 1\nH\n1\nDirect\n0 0 0\n');
  writeFileSync(join(dir, 'INCAR'), incar);
  writeFileSync(join(dir, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
  writeFileSync(join(dir, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
}

function finishedOutcar(extra = '') {
  return `${extra}\nGeneral timing and accounting\n`;
}

test('B1 discovers strict four-input tasks and leaves incomplete directories ordinary', async () => {
  const root = fixture();
  try {
    inputs(join(root, 'input-only'));
    mkdirSync(join(root, 'not-a-task'));
    writeFileSync(join(root, 'not-a-task', 'POSCAR'), 'structure only');
    const scan = await scanProject(root);
    assert.equal(scan.tasks.length, 1);
    assert.equal(scan.tasks[0].status_record.code, 'NO_OUTPUT_EVIDENCE');
    assert.equal(scan.tasks[0].status, 'unknown', 'legacy status stays compatible');
    assert.equal(scan.tasks[0].input_check.code, 'NOT_REQUESTED');
    assert.ok(scan.directories.some((d) => d.rel_path.endsWith('not-a-task')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 classifies static, relaxation, frequency and AIMD with their own completion rules', () => {
  const root = fixture();
  try {
    const staticDir = join(root, 'static');
    inputs(staticDir);
    writeFileSync(join(staticDir, 'OUTCAR'), finishedOutcar('aborting loop because EDIFF is reached'));
    assert.equal(scanSingleDir(staticDir, root).status_record.code, 'TASK_COMPLETED');

    const relaxDir = join(root, 'relax');
    inputs(relaxDir, 'IBRION = 2\nNSW = 20\n');
    writeFileSync(join(relaxDir, 'OUTCAR'), finishedOutcar());
    assert.equal(scanSingleDir(relaxDir, root).status_record.code, 'UNKNOWN');
    writeFileSync(join(relaxDir, 'OUTCAR'), finishedOutcar('reached required accuracy'));
    assert.equal(scanSingleDir(relaxDir, root).status_record.code, 'TASK_COMPLETED');

    const freqDir = join(root, 'freq');
    inputs(freqDir, 'IBRION = 5\nNSW = 1\n');
    writeFileSync(join(freqDir, 'OUTCAR'), finishedOutcar('Finite differences progress:\n Total:              24/ 24\n 1 f  =  3.2 THz'));
    assert.equal(scanSingleDir(freqDir, root).status_record.code, 'TASK_COMPLETED');

    const mdDir = join(root, 'md');
    inputs(mdDir, 'IBRION = 0\nNSW = 2\n');
    writeFileSync(join(mdDir, 'OSZICAR'), '  1 F= -1\n  2 F= -2\n');
    writeFileSync(join(mdDir, 'OUTCAR'), finishedOutcar());
    assert.equal(scanSingleDir(mdDir, root).status_record.code, 'TASK_COMPLETED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 detects deterministic errors, while a completed static task stays completed', () => {
  const root = fixture();
  try {
    const broken = join(root, 'broken');
    inputs(broken);
    writeFileSync(join(broken, 'OUTCAR'), 'BRMIX: very serious problems\n');
    const error = scanSingleDir(broken, root);
    assert.equal(error.status_record.code, 'ERROR_DETECTED');
    assert.equal(error.status_record.evidence[0].ruleId, 'BRMIX');

    writeFileSync(join(broken, 'OUTCAR'), finishedOutcar('BRMIX: very serious problems'));
    const conflicting = scanSingleDir(broken, root);
    assert.equal(conflicting.status_record.code, 'TASK_COMPLETED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 marks a DSYEV vibration-matrix failure as an error despite the VASP timing footer', () => {
  const root = fixture();
  try {
    const dir = join(root, 'freq-dsyev');
    inputs(dir, 'IBRION = 5\nNSW = 1\n');
    writeFileSync(join(dir, 'OUTCAR'), finishedOutcar('Error while diagonalisation DSYEV INFO= -5'));
    const task = scanSingleDir(dir, root);
    assert.equal(task.status_record.code, 'ERROR_DETECTED');
    assert.equal(task.status_record.evidence.find((item) => item.ruleId === 'VIBRATIONAL_DSYEV_FAILURE')?.severity, 'error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 classifies unfinished output as running from one static scan', () => {
  const root = fixture();
  try {
    const dir = join(root, 'live');
    inputs(dir);
    writeFileSync(join(dir, 'OUTCAR'), 'electronic step\n');
    assert.equal(scanSingleDir(dir, root).status_record.code, 'RUNNING');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P1 gives completion precedence to non-fatal ZBRENT and reports it as a warning', () => {
  const root = fixture();
  try {
    const dir = join(root, 'relax-zbrent');
    inputs(dir, 'IBRION = 2\nNSW = 20\n');
    writeFileSync(join(dir, 'OUTCAR'), finishedOutcar("ZBRENT: can't locate minimum, use default step\nreached required accuracy"));
    const task = scanSingleDir(dir, root);
    assert.equal(task.status_record.code, 'TASK_COMPLETED');
    assert.ok(task.status_record.evidence.some((item) => item.ruleId === 'ZBRENT_FALLBACK' && item.severity === 'warning'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P1 recognizes an explicitly fatal ZBRENT line as an error', () => {
  const root = fixture();
  try {
    const dir = join(root, 'relax-zbrent-fatal');
    inputs(dir, 'IBRION = 2\nNSW = 20\n');
    writeFileSync(join(dir, 'OUTCAR'), 'ZBRENT: fatal error while bracketing minimum\n');
    assert.equal(scanSingleDir(dir, root).status_record.code, 'ERROR_DETECTED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P1 marks a normally ended relaxation that exhausts NSW as unconverged error', () => {
  const root = fixture();
  try {
    const dir = join(root, 'relax-exhausted');
    inputs(dir, 'IBRION = 2\nNSW = 300\n');
    // Do not count records: a partially retained/restarted OSZICAR may only
    // expose some ionic-step lines, while its final printed step is NSW.
    writeFileSync(join(dir, 'OSZICAR'), '  117 F= -1\n  300 F= -2\n');
    writeFileSync(join(dir, 'OUTCAR'), finishedOutcar());
    const task = scanSingleDir(dir, root);
    assert.equal(task.status_record.code, 'ERROR_DETECTED');
    assert.match(task.status_record.reason, /未收敛/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P2 keeps undeclared static calculations as STATIC_SCF and exposes only output intentions', () => {
  const root = fixture();
  try {
    const dir = join(root, 'static-lorbit');
    inputs(dir, 'NSW = 0\nLORBIT = 11\nNEDOS = 2001\n');
    writeFileSync(join(dir, 'OUTCAR'), finishedOutcar());
    const task = scanSingleDir(dir, root);
    assert.equal(task.task_type.code, 'STATIC_SCF');
    assert.ok(task.task_type.availableOutputIntents.includes('投影态密度 / 轨道分辨输出'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P3 emits breadth-first discovered placeholders before a child is scanned', async () => {
  const root = fixture();
  try {
    inputs(join(root, 'A', 'B'));
    const events = [];
    await scanProject(root, { onEvent: (event) => events.push(event) });
    const discovered = events.findIndex((event) => event.type === 'directory-discovered' && event.directory.rel_path.endsWith('A'));
    const scanned = events.findIndex((event) => event.type === 'directory-scanned' && event.directory.rel_path.endsWith('A'));
    const taskScanned = events.findIndex((event) => event.type === 'directory-scanned' && event.directory.rel_path.endsWith('A\\B'));
    assert.ok(discovered >= 0);
    assert.ok(discovered < scanned);
    assert.ok(scanned < taskScanned);
    assert.equal(events[taskScanned].task.status_record.code, 'NO_OUTPUT_EVIDENCE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1-P4 invalidates a cached task when a relevant output file changes', () => {
  const root = fixture();
  try {
    clearScanCache();
    const dir = join(root, 'cached-relax');
    inputs(dir, 'IBRION = 2\nNSW = 2\n');
    writeFileSync(join(dir, 'OUTCAR'), 'electronic step\n');
    assert.equal(scanSingleDir(dir, root).status_record.code, 'RUNNING');
    writeFileSync(join(dir, 'OSZICAR'), '  1 F= -1\n  2 F= -2\n');
    writeFileSync(join(dir, 'OUTCAR'), finishedOutcar());
    assert.equal(scanSingleDir(dir, root).status_record.code, 'ERROR_DETECTED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 recognizes NEB as a composite task and applies a NEB-specific completion check', () => {
  const root = fixture();
  try {
    const neb = join(root, 'neb');
    mkdirSync(neb);
    writeFileSync(join(neb, 'INCAR'), 'IMAGES = 1\nIBRION = 3\nNSW = 20\n');
    writeFileSync(join(neb, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
    writeFileSync(join(neb, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
    for (const name of ['00', '01', '02']) {
      mkdirSync(join(neb, name));
      writeFileSync(join(neb, name, 'POSCAR'), 'image');
      writeFileSync(join(neb, name, 'OUTCAR'), finishedOutcar('reached required accuracy'));
    }
    writeFileSync(join(neb, 'neb.dat'), ' 1  0.5  0.02\nNEB: reached required accuracy\n');
    const task = scanSingleDir(neb, root);
    assert.equal(task.task_type.code, 'NEB');
    assert.equal(task.status_record.code, 'TASK_COMPLETED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
