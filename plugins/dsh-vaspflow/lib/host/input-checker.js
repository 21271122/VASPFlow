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
  parseCoords,
  potcarElements,
  checkPoscarPotcar,
} from './input-builder.js';

const INCAR_KEY_PARAMS = [
  'SYSTEM', 'ENCUT', 'ALGO', 'IBRION', 'NSW', 'ISIF',
  'EDIFF', 'EDIFFG', 'POTIM', 'ISPIN', 'IVDW', 'ISMEAR', 'SIGMA',
  'NELM', 'NFREE', 'LREAL', 'LWAVE', 'LCHARG', 'NUPDOWN', 'LORBIT', 'IMAGES',
];

export const INPUT_CHECK_PROFILES = {
  'basic-inputs': { version: '1', label: '基础 VASP 输入' },
  'static-scf': { version: '1', label: '静态 SCF 输入' },
  'structure-optimization': { version: '1', label: '结构优化输入' },
  'frequency-zpe': { version: '1', label: '频率 / ZPE 输入' },
  aimd: { version: '1', label: 'AIMD 输入' },
  neb: { version: '1', label: 'NEB 共享输入' },
};

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

  const parsed = parsePoscarHeader(lines);
  if (parsed.error) return 'POSCAR_PARSE_ERROR(' + parsed.error + ')';
  const expected = parsed.counts.reduce((a, b) => a + b, 0);
  // Stop after the declared number of ion positions. A valid POSCAR/CONTCAR
  // may then contain optional velocity or predictor-corrector sections whose
  // numeric rows must never be mistaken for extra atoms.
  const { coords, error } = parseCoords(lines, parsed.coordStart, expected);
  const fCnt = coords.filter((coord) => coord.flags?.[0] === 'F').length;
  const tCnt = coords.filter((coord) => coord.flags?.[0] === 'T').length;
  const noFlag = coords.filter((coord) => coord.flags === null).length;

  const issues = [];
  const hasSd = parsed.sdIdx >= 0;
  if (!hasSd) issues.push('NO_SD');
  if (error) issues.push('COUNT_MISMATCH(' + coords.length + ' vs ' + expected + ')');
  if (hasSd && noFlag > 0) issues.push('FLAG_MISSING(' + noFlag + ')');

  const status = issues.length === 0 ? 'OK' : issues.join(', ');
  const noFlagPart = noFlag > 0 ? (',' + noFlag + 'noflag') : '';
  return 'SDx' + (hasSd ? 1 : 0) + ' ' + coords.length + 'at(' + fCnt + 'F,' + tCnt + 'T' + noFlagPart + ') [' + status + ']';
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

function describePoscarPotcar(value) {
  const mismatch = /^MISMATCH\(顺序\): POSCAR=(\[[^]*?\]) vs POTCAR=(\[[^]*\])$/.exec(String(value));
  if (mismatch) {
    try {
      return `POSCAR 与 POTCAR 的元素顺序不一致（POSCAR：${JSON.parse(mismatch[1]).join(' → ')}；POTCAR：${JSON.parse(mismatch[2]).join(' → ')}）`;
    } catch {
      // Fall through to a concise machine-status fallback.
    }
  }
  const labels = {
    POSCAR_MISSING: '未找到 POSCAR',
    POTCAR_MISSING: '未找到 POTCAR',
    POSCAR_UNREADABLE: '无法读取 POSCAR',
    POTCAR_UNREADABLE: '无法读取 POTCAR',
    POSCAR_PARSE_ERROR: '无法解析 POSCAR 的元素与原子数',
    POTCAR_NO_TITEL: 'POTCAR 中未找到 TITEL 元素信息',
  };
  return labels[value] ?? `POSCAR/POTCAR 检查未通过：${value}`;
}

function describeSdFailure(value) {
  const missing = /FLAG_MISSING\((\d+)\)/.exec(String(value));
  if (missing) return `已启用 Selective dynamics，但有 ${missing[1]} 个原子的 F/T 标记不完整`;
  if (/COUNT_MISMATCH/.test(String(value))) return 'POSCAR 中声明的原子数与实际坐标行数不一致';
  return '无法解析 POSCAR 的 Selective dynamics 坐标标记';
}

function describeIncar(value) {
  const labels = { INCAR_MISSING: '未找到 INCAR', INCAR_UNREADABLE: '无法读取 INCAR' };
  return labels[value] ?? `INCAR 检查未通过：${value}`;
}

function describeKpoints(value) {
  const labels = { KPOINTS_MISSING: '未找到 KPOINTS', KPOINTS_UNREADABLE: '无法读取 KPOINTS' };
  return labels[value] ?? `KPOINTS 检查未通过：${value}`;
}

/**
 * Convert raw mechanical checks into B1's independent input-check dimension.
 * A profile is intentionally required: without a user-selected workflow the
 * scanner must not imply that the directory is ready to submit.
 */
export function buildInputCheck(row, profileId) {
  if (!profileId) {
    return {
      code: 'NOT_REQUESTED', label: '未指定检查规则', profileId: '', profileVersion: '',
      checkedFiles: [], uncheckedItems: ['未指定模板或任务类型检查规则'], evidence: [], observedAt: new Date().toISOString(),
    };
  }
  const profile = INPUT_CHECK_PROFILES[profileId];
  if (!profile) {
    return {
      code: 'NOT_CHECKED', label: '尚未检查', profileId, profileVersion: '',
      checkedFiles: [], uncheckedItems: ['未知的检查规则 ID'], evidence: [], observedAt: new Date().toISOString(),
    };
  }
  const checkedFiles = ['POSCAR', 'POTCAR', 'INCAR', 'KPOINTS'];
  const evidence = [];
  const failures = [];
  const warnings = [];
  // NEB keeps shared INCAR/KPOINTS/POTCAR in the parent and POSCAR in image
  // subdirectories, so its parent must not fail the single-task POSCAR rule.
  if (row.poscarPotcar !== 'OK' && !(profileId === 'neb' && row.poscarPotcar === 'POSCAR_MISSING')) failures.push(describePoscarPotcar(row.poscarPotcar));
  if (typeof row.incar !== 'object' || !row.incar) failures.push(describeIncar(row.incar));
  if (String(row.kpoints).includes('MISSING') || String(row.kpoints).includes('UNREADABLE')) failures.push(describeKpoints(row.kpoints));
  if (/PARSE_ERROR|COUNT_MISMATCH|FLAG_MISSING/.test(String(row.sd))) failures.push(describeSdFailure(row.sd));
  if (row.error) failures.push(row.error);

  const incar = typeof row.incar === 'object' && row.incar ? row.incar : {};
  const number = (key) => Number.parseInt(String(incar[key] ?? ''), 10);
  const ibrion = number('IBRION');
  const nsw = number('NSW');
  if (profileId === 'static-scf' && Number.isFinite(nsw) && nsw !== 0) failures.push(`静态 SCF 规则要求 NSW=0，当前为 ${nsw}`);
  if (profileId === 'structure-optimization' && !([1, 2, 3].includes(ibrion) && nsw > 0)) failures.push('结构优化规则要求 IBRION=1/2/3 且 NSW>0');
  if (profileId === 'frequency-zpe' && ![5, 6, 7, 8].includes(ibrion)) failures.push('频率 / ZPE 规则要求 IBRION=5/6/7/8');
  if (profileId === 'aimd' && !(ibrion === 0 && nsw > 0)) failures.push('AIMD 规则要求 IBRION=0 且 NSW>0');
  if (profileId === 'neb') {
    if (!(number('IMAGES') > 0)) failures.push('NEB 规则要求 IMAGES 为正整数');
    else {
      const missingImages = nebImageInputsMissing(row.resolved, number('IMAGES'));
      if (missingImages.length > 0) failures.push(`NEB image 目录或 POSCAR 缺失：${missingImages.join('、')}`);
    }
  }
  for (const message of failures) evidence.push({ ruleId: 'INPUT_FAIL', file: '', severity: 'error', message });
  for (const message of warnings) evidence.push({ ruleId: 'INPUT_WARN', file: 'POSCAR', severity: 'warning', message });
  return {
    code: failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    label: failures.length > 0 ? '未通过指定规则检查' : warnings.length > 0 ? '发现需注意项' : '通过指定规则检查',
    profileId,
    profileVersion: profile.version,
    checkedFiles,
    uncheckedItems: ['提交脚本、资源设置与科学合理性'],
    evidence,
    observedAt: new Date().toISOString(),
  };
}

function nebImageInputsMissing(root, images) {
  const missing = [];
  for (let index = 0; index < images + 2; index += 1) {
    const image = String(index).padStart(2, '0');
    if (!fs.existsSync(resolve(root, image, 'POSCAR'))) missing.push(image);
  }
  return missing;
}
