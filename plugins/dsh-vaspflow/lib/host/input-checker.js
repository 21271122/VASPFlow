/**
 * dsh-vaspflow host: VASP input checker — pure-JS port of check_all_inputs.py.
 *
 * Checks a built VASP task directory for:
 * - POSCAR-POTCAR species match (EQUAL length and order)
 * - Selective dynamics flags (3-column rows without flags are reported as
 *   FLAG_MISSING, never silently counted as fixed)
 * - key INCAR parameters
 * - KPOINTS grid
 *
 * Each directory is checked independently: an exception in one directory is
 * reported inline and does NOT abort the remaining checks.
 *
 * @module dsh-vaspflow/host/input-checker
 */
import fs from 'node:fs';
import { resolve } from 'node:path';
import {
  parsePoscarHeader,
  potcarElements,
  checkPoscarPotcar,
} from './input-builder.js';

const INCAR_KEY_PARAMS = [
  'SYSTEM', 'ENCUT', 'ALGO', 'IBRION', 'NSW', 'ISIF',
  'EDIFF', 'EDIFFG', 'POTIM', 'ISPIN', 'IVDW', 'ISMEAR', 'SIGMA',
  'NELM', 'NFREE', 'LREAL', 'LWAVE', 'LCHARG', 'NUPDOWN', 'LORBIT',
];

/** POSCAR-POTCAR species match for one directory. */
function checkPoscarPotcarDir(d) {
  const poscar = resolve(d, 'POSCAR');
  const potcar = resolve(d, 'POTCAR');
  if (!fs.existsSync(poscar)) return 'POSCAR_MISSING';
  if (!fs.existsSync(potcar)) return 'POTCAR_MISSING';

  let raw;
  try {
    raw = fs.readFileSync(poscar, 'utf-8');
  } catch (error) {
    return 'POSCAR_UNREADABLE';
  }
  const parsed = parsePoscarHeader(raw.split(/\r?\n/));
  if (parsed.error) return 'POSCAR_PARSE_ERROR';
  if (parsed.counts.reduce((a, b) => a + b, 0) === 0) return 'POSCAR_PARSE_ERROR';
  const potElems = potcarElementsSync(potcar, parsed.elements.length);
  if (potElems === null) return 'POTCAR_UNREADABLE';
  if (potElems.length === 0) return 'POTCAR_NO_TITEL';
  return checkPoscarPotcar(parsed.elements, potElems);
}

function potcarElementsSync(p, expected) {
  // potcarElements is async (readline); for the checker a synchronous cached
  // read via the same cache is preferred. Reuse by awaiting is fine too, but
  // keep the checker synchronous: read with a plain readFileSync cap.
  let st;
  try {
    st = fs.statSync(p);
  } catch (error) {
    return null;
  }
  const titel = /^\s*TITEL\s*=\s*(\S+)\s+(\S+)/;
  const elems = [];
  try {
    const text = fs.readFileSync(p, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const m = titel.exec(line);
      if (m) {
        elems.push(m[2].split('_')[0]);
        if (expected !== null && elems.length >= expected) break;
      }
    }
  } catch (error) {
    return null;
  }
  return elems;
}

/** Selective dynamics + F/T flags for one directory. */
function checkSdDir(d) {
  const poscar = resolve(d, 'POSCAR');
  if (!fs.existsSync(poscar)) return 'POSCAR_MISSING';

  let lines;
  try {
    lines = fs.readFileSync(poscar, 'utf-8').split(/\r?\n/);
  } catch (error) {
    return 'POSCAR_UNREADABLE';
  }

  const sdCount = lines.filter((l) => l.trim() === 'Selective dynamics').length;
  const parsed = parsePoscarHeader(lines);
  if (parsed.error) return 'POSCAR_PARSE_ERROR(' + parsed.error + ')';
  const expected = parsed.counts.reduce((a, b) => a + b, 0);

  let fCnt = 0;
  let tCnt = 0;
  let noFlag = 0;
  let total = 0;
  for (let i = parsed.coordStart; i < lines.length; i += 1) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 6) {
      total += 1;
      if (parts[3] === 'F') fCnt += 1;
      else if (parts[3] === 'T') tCnt += 1;
    } else if (parts.length === 3) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        total += 1;
        noFlag += 1;
      }
    }
  }

  const issues = [];
  if (sdCount === 0) issues.push('NO_SD');
  else if (sdCount > 1) issues.push('SD_DUP(x' + sdCount + ')');
  if (total > expected) issues.push('TRAILING_LINES(' + (total - expected) + ')'); // informational: extra coordinate rows past the species counts
  else if (total < expected) issues.push('COUNT_MISMATCH(' + total + ' vs ' + expected + ')');
  if (sdCount > 0 && noFlag > 0) issues.push('FLAG_MISSING(' + noFlag + ')');

  const status = issues.length === 0 ? 'OK' : issues.join(', ');
  const noFlagPart = noFlag > 0 ? (',' + noFlag + 'noflag') : '';
  return 'SDx' + sdCount + ' ' + total + 'at(' + fCnt + 'F,' + tCnt + 'T' + noFlagPart + ') [' + status + ']';
}

/** Key INCAR parameters for one directory. */
function checkIncarDir(d) {
  const incar = resolve(d, 'INCAR');
  if (!fs.existsSync(incar)) return 'INCAR_MISSING';
  let text;
  try {
    text = fs.readFileSync(incar, 'utf-8');
  } catch (error) {
    return 'INCAR_UNREADABLE';
  }
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    for (const k of INCAR_KEY_PARAMS) {
      if (new RegExp('^\\s*' + k + '\\s*=').test(line)) {
        const val = line.split('=').slice(1).join('=').trim().split(';')[0].trim().split(/\s+/)[0];
        found[k] = val;
      }
    }
  }
  return found;
}

/** KPOINTS grid summary for one directory. */
function checkKpointsDir(d) {
  const kpt = resolve(d, 'KPOINTS');
  if (!fs.existsSync(kpt)) return 'KPOINTS_MISSING';
  let text;
  try {
    text = fs.readFileSync(kpt, 'utf-8');
  } catch (error) {
    return 'KPOINTS_UNREADABLE';
  }
  const lines = text.split(/\r?\n/);
  let grid = '?';
  for (let i = 3; i < lines.length; i += 1) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      grid = parts[0] + 'x' + parts[1] + 'x' + parts[2];
      break;
    }
  }
  return text.indexOf('Gamma') >= 0 ? 'Gamma ' + grid : grid;
}

/** Check one directory. Returns a row object (never throws). */
export function checkOneDir(d) {
  const resolved = resolve(d);
  // Species parsed once, used for batch (cross-directory) consistency (P4).
  let species = [];
  try {
    const poscar = resolve(d, 'POSCAR');
    if (fs.existsSync(poscar)) {
      const parsed = parsePoscarHeader(fs.readFileSync(poscar, 'utf-8').split(/\r?\n/));
      if (!parsed.error) species = parsed.elements;
    }
  } catch (error) { /* best effort */ }
  // error is always a string ('' when OK): the host output validator enforces
  // { type: 'string' }, and null would break every normal invocation.
  try {
    return {
      dir: d,
      resolved,
      species,
      poscarPotcar: checkPoscarPotcarDir(d),
      sd: checkSdDir(d),
      incar: checkIncarDir(d),
      kpoints: checkKpointsDir(d),
      warnings: [],
      error: '',
    };
  } catch (error) {
    return {
      dir: d,
      resolved,
      species,
      poscarPotcar: '?',
      sd: '?',
      incar: '?',
      kpoints: '?',
      warnings: [],
      error: 'CHECK_CRASH: ' + String(error),
    };
  }
}

/** Group checked directories by a cross-directory pattern (P4). */
function buildConsistency(rows) {
  const groups = new Map();
  for (const r of rows) {
    const incarKey = typeof r.incar === 'object' && r.incar
      ? Object.entries(r.incar).filter(([k]) => k !== 'SYSTEM').map(([k, v]) => k + '=' + v).sort().join(';')
      : 'no-incar';
    const pattern = r.poscarPotcar + ' | ' + r.sd + ' | ' + r.kpoints + ' | ' + JSON.stringify(r.species) + ' | ' + incarKey;
    if (!groups.has(pattern)) groups.set(pattern, []);
    groups.get(pattern).push(r.resolved);
  }
  const groupList = [...groups.entries()].map(([pattern, dirs]) => ({ pattern, count: dirs.length, dirs }));
  const uniform = groupList.length <= 1;
  return {
    uniform,
    groups: groupList,
    note: uniform
      ? '批次模式一致（' + rows.length + ' 个目录）；比对维度：POTCAR-POSCAR / SD / K 点 / 物种 / 关键 INCAR（不含 SYSTEM）'
      : '批次模式不一致：' + groupList.map((g) => g.count + ' 个为「' + g.pattern + '」').join('；') + '（需人工确认）',
  };
}

/**
 * Check a list of directories (relative dirs resolve against projectRoot when
 * given, else against the process cwd). Returns { results, consistency } with
 * per-dir isolation.
 */
export function checkInputs(dirs, opts = {}) {
  const projectRoot = opts.projectRoot ?? null;
  const toAbs = (d) => (projectRoot ? resolve(projectRoot, d) : resolve(d));
  const results = [];
  for (const d of dirs) {
    const abs = toAbs(d);
    if (!fs.existsSync(abs)) {
      results.push({
        dir: d,
        resolved: abs,
        species: [],
        poscarPotcar: 'DIR_NOT_FOUND',
        sd: '-',
        incar: '-',
        kpoints: '-',
        warnings: [],
        error: '',
      });
      continue;
    }
    results.push(checkOneDir(abs));
  }
  const consistency = buildConsistency(results.filter((r) => r.poscarPotcar !== 'DIR_NOT_FOUND'));
  return { results, consistency };
}
