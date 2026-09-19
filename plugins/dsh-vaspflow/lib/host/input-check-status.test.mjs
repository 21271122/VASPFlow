import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInputCheck, checkOneDir } from './input-checker.js';

function row(overrides = {}) {
  return {
    poscarPotcar: 'OK',
    sd: 'SDx1 1at(0F,1T) [OK]',
    incar: { IBRION: '2', NSW: '20' },
    kpoints: 'Gamma 3x3x1',
    error: '',
    ...overrides,
  };
}

test('B1 input check keeps all five independent outcomes available', () => {
  assert.equal(buildInputCheck(row(), '').code, 'NOT_REQUESTED');
  assert.equal(buildInputCheck(row(), 'not-a-profile').code, 'NOT_CHECKED');
  assert.equal(buildInputCheck(row(), 'structure-optimization').code, 'PASS');
  assert.equal(buildInputCheck(row({ sd: 'SDx0 1at(0F,0T) [NO_SD]' }), 'basic-inputs').code, 'PASS');
  assert.equal(buildInputCheck(row({ poscarPotcar: 'POTCAR_MISSING' }), 'basic-inputs').code, 'FAIL');
});

test('input check accepts S/s Selective dynamics and ignores a following velocity block', () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-sd-'));
  try {
    writeFileSync(join(root, 'POSCAR'), [
      'test', '1', '1 0 0', '0 1 0', '0 0 1', 'H', '1', 's', 'Direct',
      '0 0 0 T T T', '', '0.00000000E+00 0.00000000E+00 0.00000000E+00',
    ].join('\n'));
    writeFileSync(join(root, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
    writeFileSync(join(root, 'INCAR'), 'IBRION = 2\nNSW = 20\n');
    writeFileSync(join(root, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
    const checked = checkOneDir(root);
    assert.match(checked.sd, /SDx1 1at\(0F,1T\) \[OK\]/);
    assert.equal(buildInputCheck(checked, 'structure-optimization').code, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NEB input check reads IMAGES from INCAR before checking image POSCARs', () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-neb-images-'));
  try {
    for (const image of ['00', '01', '02']) {
      mkdirSync(join(root, image));
      writeFileSync(join(root, image, 'POSCAR'), 'image');
    }
    writeFileSync(join(root, 'POTCAR'), 'TITEL = PAW_PBE H 1.0\n');
    writeFileSync(join(root, 'INCAR'), 'IMAGES = 1\nIBRION = 3\nNSW = 20\n');
    writeFileSync(join(root, 'KPOINTS'), 'Gamma\n0\nGamma\n1 1 1\n0 0 0\n');
    const checked = checkOneDir(root);
    assert.equal(checked.incar.IMAGES, '1');
    assert.equal(buildInputCheck(checked, 'neb').code, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B1 NEB input profile checks image POSCARs instead of requiring parent POSCAR', () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-neb-input-'));
  try {
    for (const image of ['00', '01', '02']) {
      mkdirSync(join(root, image));
      writeFileSync(join(root, image, 'POSCAR'), 'image');
    }
    const result = buildInputCheck(row({
      resolved: root,
      poscarPotcar: 'POSCAR_MISSING',
      incar: { IMAGES: '1' },
    }), 'neb');
    assert.equal(result.code, 'PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
