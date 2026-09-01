/**
 * dsh-vaspflow host: VASP input-file builder — pure-JS port of the
 * vasp-structure-opt skill scripts (batch_build_dirs.py / check_all_inputs.py).
 *
 * Design decisions (user-confirmed):
 * - Selective-dynamics flags are NEVER inferred from element order. Each task
 *   must give freeAtoms (rest = F F F) or fixedAtoms (rest = T T T); neither
 *   -> task error, no SD rewrite, nothing silent.
 * - The submit script MUST be provided explicitly via submitSrc. There is no
 *   auto-detection: if it is missing, the caller (agent) must ask the user.
 *   Same for template: locating templates is a user decision; the agent may
 *   list candidates but must not pick one silently.
 * - POTCAR element parsing is pseudopotential-family agnostic (PAW_PBE /
 *   PAW_GGA / US / OEPC ...) via the TITEL line; species match requires EQUAL
 *   length and order.
 * - Coordinate type (Direct/Cartesian) of the source POSCAR is preserved;
 *   scale/lattice lines are kept verbatim.
 * - POTCAR reads are cached by (realpath, size, mtime) and stop after the
 *   expected element count (never read a giant POTCAR past its headers).
 *
 * @module dsh-vaspflow/host/input-builder
 */
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { resolve, basename } from 'node:path';

const SCALE_HINT_LINES = 5;

// ── POSCAR header/coordinate parsing ───────────────────────────────────────

export function isElemToken(t) {
  return typeof t === 'string' && t.length <= 2 && /^[A-Z][a-z]?$/.test(t);
}

export function isFlag(t) {
  return t === 'T' || t === 'F';
}

/**
 * Parse POSCAR header. Scanning starts after the 5 header lines (title +
 * scale + 3 lattice vectors) and requires an element-name line before any
 * counts line, so an integer scale factor (line 1) is never mistaken for
 * counts. coordType defaults to 'Direct' when the line is omitted.
 */
export function parsePoscarHeader(lines) {
  let elements = null;
  let counts = null;
  let countsIdx = -1;
  let sdIdx = -1;
  let coordType = 'Direct';
  let coordStart = -1;

  for (let i = SCALE_HINT_LINES; i < Math.min(lines.length, 14); i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (elements === null && tokens.length > 0 && tokens.every(isElemToken)) {
      elements = tokens;
      continue;
    }
    if (elements !== null && counts === null && tokens.length > 0 && tokens.every((t) => /^-?\d+$/.test(t))) {
      const nums = tokens.map(Number);
      if (nums.reduce((a, b) => a + b, 0) > 0) {
        counts = nums;
        countsIdx = i;
        continue;
      }
    }
    if (elements !== null && counts !== null) {
      const lower = line.toLowerCase();
      if (lower === 'selective dynamics') {
        sdIdx = i;
        continue;
      }
      if (lower === 'direct' || lower === 'cartesian') {
        coordType = lower === 'direct' ? 'Direct' : 'Cartesian';
        coordStart = i + 1;
        break;
      }
      coordStart = i;
      break;
    }
  }

  if (elements === null) return { error: 'POSCAR 头部解析失败：未找到元素名行' };
  if (counts === null) return { error: 'POSCAR 头部解析失败：未找到元素计数行' };
  if (coordStart < 0) coordStart = countsIdx + 1;
  return { elements, counts, countsIdx, sdIdx, coordType, coordStart, error: null };
}

/** Collect coordinate rows (3 or 6 columns) starting at coordStart. */
export function parseCoords(lines, coordStart, nTotal) {
  const coords = [];
  for (let i = coordStart; i < lines.length && coords.length < nTotal; i += 1) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    const tokens = stripped.split(/\s+/);
    if (tokens.length < 3) continue;
    if (!Number.isFinite(Number(tokens[0])) || !Number.isFinite(Number(tokens[1])) || !Number.isFinite(Number(tokens[2]))) {
      continue;
    }
    if (tokens.length >= 6 && isFlag(tokens[3]) && isFlag(tokens[4]) && isFlag(tokens[5])) {
      coords.push({ xyz: tokens.slice(0, 3), flags: tokens.slice(3, 6) });
    } else {
      coords.push({ xyz: tokens.slice(0, 3), flags: null });
    }
  }
  if (coords.length < nTotal) {
    return { coords, error: '坐标解析失败：读取 ' + coords.length + '，预期 ' + nTotal };
  }
  return { coords, error: null };
}

/** Decide F/T per atom from EXPLICIT input only. Returns {flags, error}. */
export function planFlags(nTotal, freeAtoms, fixedAtoms) {
  const free = new Set(freeAtoms ?? []);
  const fixed = new Set(fixedAtoms ?? []);
  if (free.size === 0 && fixed.size === 0) {
    return { flags: null, error: '必须显式指定 freeAtoms（其余 F F F）或 fixedAtoms（其余 T T T），不按元素序推断' };
  }
  const conflict = [...free].filter((x) => fixed.has(x));
  if (conflict.length > 0) {
    return { flags: null, error: 'freeAtoms 与 fixedAtoms 重叠：' + conflict.sort((a, b) => a - b).join(',') };
  }
  for (const idx of [...free, ...fixed]) {
    if (idx < 1 || idx > nTotal) {
      return { flags: null, error: '原子序号越界：' + idx + '（任务共 ' + nTotal + ' 个原子，1-indexed）' };
    }
  }
  const flags = [];
  if (free.size > 0) {
    for (let i = 0; i < nTotal; i += 1) flags.push('F   F   F');
    for (const idx of free) flags[idx - 1] = 'T   T   T';
  } else {
    for (let i = 0; i < nTotal; i += 1) flags.push('T   T   T');
    for (const idx of fixed) flags[idx - 1] = 'F   F   F';
  }
  return { flags, error: null };
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (error) {
    return null;
  }
}

/**
 * In-memory: parse source POSCAR and produce SD-annotated text.
 * Returns { text, meta, error }.
 */
export function buildPoscarWithSd(srcPath, freeAtoms, fixedAtoms, opts = {}) {
  const raw = readTextSafe(srcPath);
  if (raw === null) return { text: null, meta: null, error: '无法读取 POSCAR：' + srcPath };
  const lines = raw.split(/\r?\n/);
  const parsed = parsePoscarHeader(lines);
  if (parsed.error) return { text: null, meta: null, error: parsed.error };

  const nTotal = parsed.counts.reduce((a, b) => a + b, 0);
  const { coords, error: coordError } = parseCoords(lines, parsed.coordStart, nTotal);
  if (coordError) return { text: null, meta: null, error: coordError };
  const head = lines.slice(0, parsed.countsIdx + 1).join('\n') + '\n';

  // sdPolicy=keep: reuse the source SD flags verbatim, never rewrite.
  const sdKeep = opts.sdKeep === true;
  if (sdKeep) {
    if (parsed.sdIdx < 0) {
      // source has no Selective dynamics at all: copy verbatim, never invent one
      return {
        text: raw,
        meta: {
          elements: parsed.elements, counts: parsed.counts, nAtoms: nTotal,
          coordType: parsed.coordType, tFlags: 0, fFlags: 0,
          changedFlags: [], changedCount: 0, hasSd: false,
        },
        error: null,
      };
    }
    const srcFlags = coords.map((c) => (c.flags ? c.flags.join('   ') : null));
    if (srcFlags.some((f) => f === null)) {
      return { text: null, meta: null, error: 'sdPolicy=keep 但源坐标缺少 SD 旗标（无法保持）；请显式指定 freeAtoms/fixedAtoms，或先给源文件补旗标' };
    }
    const body = ['Selective dynamics', parsed.coordType];
    coords.forEach((c, i) => {
      body.push('  ' + c.xyz.join('  ') + '   ' + srcFlags[i]);
    });
    body.push('');
    const text = head + body.join('\n') + '\n';
    const tFlags = srcFlags.filter((f) => f === 'T   T   T').length;
    const fFlags = srcFlags.filter((f) => f === 'F   F   F').length;
    return {
      text,
      meta: {
        elements: parsed.elements, counts: parsed.counts, nAtoms: nTotal,
        coordType: parsed.coordType, tFlags, fFlags,
        changedFlags: [], changedCount: 0, hasSd: true,
      },
      error: null,
    };
  }

  // default (sdPolicy=override): explicit freeAtoms/fixedAtoms required
  const { flags, error: flagError } = planFlags(nTotal, freeAtoms, fixedAtoms);
  if (flagError) return { text: null, meta: null, error: flagError };

  const body = ['Selective dynamics', parsed.coordType];
  coords.forEach((c, i) => {
    body.push('  ' + c.xyz.join('  ') + '   ' + flags[i]);
  });
  body.push('');
  const text = head + body.join('\n') + '\n';

  // diff vs source flags: report every atom whose F/T was changed by the rule
  // (P3: the operation must be visible, not silent).
  const changedFlags = [];
  coords.forEach((c, i) => {
    if (c.flags) {
      const from = c.flags.join('   ');
      const to = flags[i];
      if (from !== to) changedFlags.push({ index: i + 1, from, to });
    }
  });
  const meta = {
    elements: parsed.elements,
    counts: parsed.counts,
    nAtoms: nTotal,
    coordType: parsed.coordType,
    tFlags: flags.filter((f) => f === 'T   T   T').length,
    fFlags: flags.filter((f) => f === 'F   F   F').length,
    changedFlags,
    changedCount: changedFlags.length,
    hasSd: true,
  };
  return { text, meta, error: null };
}

// ── POTCAR parsing (family-agnostic, cached, header-first) ─────────────────

const potcarCache = new Map();

/** Extract element symbols from POTCAR TITEL lines. Returns null on unreadable. */
export async function potcarElements(p, expected = null) {
  let st;
  try {
    st = fs.statSync(p);
  } catch (error) {
    return null;
  }
  const key = resolve(p) + '|' + st.size + '|' + st.mtimeNs;
  if (potcarCache.has(key)) return potcarCache.get(key);

  const elems = [];
  const titel = /^\s*TITEL\s*=\s*(\S+)\s+(\S+)/;
  try {
    const rl = readline.createInterface({
      input: createReadStream(p, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const m = titel.exec(line);
      if (m) {
        elems.push(m[2].split('_')[0]);
        if (expected !== null && elems.length >= expected) break;
      }
    }
  } catch (error) {
    return null;
  }
  potcarCache.set(key, elems);
  return elems;
}

/** VASP requires POTCAR species order == POSCAR species order, EQUAL length. */
export function checkPoscarPotcar(posElems, potElems) {
  if (!posElems || posElems.length === 0 || !potElems || potElems.length === 0) {
    return 'PARSE_ERROR';
  }
  if (posElems.length !== potElems.length) {
    return 'MISMATCH(长度): POSCAR=' + JSON.stringify(posElems) + ' 共' + posElems.length + '种 vs POTCAR=' + JSON.stringify(potElems) + ' 共' + potElems.length + '种';
  }
  if (JSON.stringify(posElems) === JSON.stringify(potElems)) return 'OK';
  return 'MISMATCH(顺序): POSCAR=' + JSON.stringify(posElems) + ' vs POTCAR=' + JSON.stringify(potElems);
}

// ── INCAR overrides ─────────────────────────────────────────────────────────

/** Escape a regex metacharacter outside of $ and braces (INCAR tags never
 * contain them); avoids the $ { sequence entirely. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^()|[\]\\]/g, '\\$&');
}

/**
 * INCAR tag regexp, semicolon-aware. VASP allows multiple tag = value per
 * line separated by ';' (e.g. "EDIFF = 1E-5; EDIFFG = -0.02"); '#' and '!'
 * both start a trailing comment.
 */
const INCAR_TAG_RE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*(?:[#!].*)?$/;

/** Collect every declared tag (semicolon-aware). */
function collectIncarTags(text) {
  const tags = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    for (const segment of rawLine.split(';')) {
      const m = INCAR_TAG_RE.exec(segment);
      if (m) tags.add(m[1]);
    }
  }
  return tags;
}

/**
 * Replace existing tags; ADD missing ones. Semicolon-aware: only the segment
 * owning the tag is replaced, sibling tags on the same line stay intact.
 */
export function applyIncarOverrides(incarText, overrides) {
  const entries = Object.entries(overrides ?? {});
  if (entries.length === 0) return incarText;
  const lines = incarText.split(/\r?\n/).map((line) => {
    const segments = line.split(';');
    let touched = false;
    for (let i = 0; i < segments.length; i += 1) {
      for (const [key, val] of entries) {
        const pattern = new RegExp('^\\s*' + escapeRegExp(key) + '\\s*=\\s*[^\\r\\n]*');
        if (pattern.test(segments[i])) {
          segments[i] = segments[i].replace(pattern, () => key + ' = ' + val);
          touched = true;
        }
      }
    }
    return touched ? segments.join(';') : line;
  });
  let out = lines.join('\n');
  // ADD missing tags (absent anywhere, including inside ';' segments)
  const existing = collectIncarTags(out);
  for (const [key, val] of entries) {
    if (!existing.has(key)) out += '\n' + key + ' = ' + val + '\n';
  }
  return out;
}

// ── per-task build ──────────────────────────────────────────────────────────

function lowerCamel(fname) {
  return fname[0].toLowerCase() + fname.slice(1).toLowerCase();
}

function poscarElementsFromFileText(p) {
  const raw = readTextSafe(p);
  if (raw === null) return null;
  const parsed = parsePoscarHeader(raw.split(/\r?\n/));
  if (parsed.error) return null;
  return parsed.elements;
}

/**
 * Build one task. Returns { sources, sd, potcar, errors, warnings, wrote }.
 */
export async function buildOneTask(task, projectRoot, opts) {
  const t = { ...task }; // operate on a copy: never mutate the caller's object (host args may be a frozen snapshot)

  // sources mapping { poscar, incar, kpoints, potcar, submit }: per-file source
  // choice, fully independent of any template directory. Priority:
  // explicit *_Src > sources > template default.
  const SRC_ALIAS = { poscar: 'poscarSrc', incar: 'incarSrc', kpoints: 'kpointsSrc', potcar: 'potcarSrc', submit: 'submitSrc' };
  const mapping = task.sources ?? {};
  for (const [short, full] of Object.entries(SRC_ALIAS)) {
    if (!t[full] && mapping[short]) t[full] = mapping[short];
  }

  const errors = [];
  const warnings = [];
  const sources = {};
  const dirPath = resolve(projectRoot, t.dir ?? '');

  if (!t.dir) errors.push('缺少必需字段: dir');

  // template: user-provided; auto-fills INCAR/KPOINTS/POTCAR only.
  const template = t.template ? resolve(projectRoot, t.template) : null;
  if (template && !fs.existsSync(template)) {
    errors.push('模板目录不存在: ' + template);
  }

  const copies = new Map(); // dest name -> source path

  const poscarSrc = t.poscarSrc ? resolve(projectRoot, t.poscarSrc) : null;
  if (!poscarSrc) {
    // staged build: POSCAR not prepared yet — copy the rest, skip SD/POTCAR checks
    warnings.push('未提供 poscarSrc - 跳过 POSCAR/SD/POTCAR 校验（分段构建，可后续补充）');
  } else if (!fs.existsSync(poscarSrc)) {
    errors.push('POSCAR 源文件不存在: ' + poscarSrc);
  } else {
    copies.set('POSCAR', poscarSrc);
  }

  // INCAR / KPOINTS / POTCAR: explicit *Src > template auto-fill
  if (template && fs.existsSync(template)) {
    for (const fname of ['INCAR', 'KPOINTS', 'POTCAR']) {
      const key = lowerCamel(fname) + 'Src';
      if (!t[key]) {
        const cand = resolve(template, fname);
        if (fs.existsSync(cand)) t[key] = cand;
      }
    }
  }
  for (const fname of ['INCAR', 'KPOINTS', 'POTCAR']) {
    const key = lowerCamel(fname) + 'Src';
    const src = t[key] ? resolve(projectRoot, t[key]) : null;
    if (src && fs.existsSync(src)) {
      copies.set(fname, src);
    } else if (t[key]) {
      errors.push(fname + ' 源不存在: ' + src);
    } else {
      // staged build: this file not prepared yet
      warnings.push('未提供 ' + fname + ' - 分段构建，可后续补充');
    }
  }

  // submit script: explicit only, no auto-detection (the caller/agent asks the
  // user when it is missing). Missing is allowed for staged builds.
  const submitSrc = t.submitSrc ? resolve(projectRoot, t.submitSrc) : null;
  if (submitSrc) {
    if (fs.existsSync(submitSrc)) {
      copies.set(basename(submitSrc), submitSrc);
    } else {
      errors.push('提交脚本源不存在: ' + submitSrc);
    }
  } else {
    warnings.push('未提供 submitSrc - 提交脚本稍后补充（不自动探测；用户提供或由 agent 主动询问）');
  }

  // nothing at all to build?
  if (copies.size === 0) {
    errors.push('任务未提供任何输入文件来源（poscarSrc/incarSrc/kpointsSrc/potcarSrc/submitSrc/sources 均缺）');
  }

  // in-memory SD plan (works for dry-run AND real run)
  let sdMeta = null;
  let sdError = null;
  let newText = null;
  const poscarPath = copies.get('POSCAR');
  if (poscarPath) {
    // sdPolicy defaults to 'keep' (reuse source SD as-is); explicit freeAtoms/
    // fixedAtoms always force the explicit rule; 'override' without explicit
    // rules is an error (never guess from element order).
    const hasExplicitSd = (t.freeAtoms && t.freeAtoms.length > 0) || (t.fixedAtoms && t.fixedAtoms.length > 0);
    const sdKeep = !hasExplicitSd && t.sdPolicy !== 'override';
    const built = buildPoscarWithSd(poscarPath, t.freeAtoms, t.fixedAtoms, { sdKeep });
    newText = built.text;
    sdMeta = built.meta;
    sdError = built.error;
    if (sdError) errors.push('Selective dynamics: ' + sdError);
    if (!sdError && sdKeep && sdMeta && !sdMeta.hasSd) {
      warnings.push('sdPolicy=keep：源文件无 SD 旗标，产物未加 Selective dynamics（VASP 将全部放开）');
    }
  }

  // POTCAR-POSCAR match
  let potcarResult = 'N/A';
  const potcarPath = copies.get('POTCAR');
  if (poscarPath && potcarPath) {
    const posElems = sdMeta ? sdMeta.elements : poscarElementsFromFileText(poscarPath);
    const potElems = await potcarElements(potcarPath, posElems ? posElems.length : null);
    if (potElems === null) {
      errors.push('无法读取 POTCAR: ' + potcarPath);
    } else {
      const result = checkPoscarPotcar(posElems, potElems);
      potcarResult = result;
      if (result !== 'OK') errors.push('POTCAR 不匹配: ' + result);
    }
  }

  let wrote = false;
  if (!opts.dryRun && errors.length === 0) {
    fs.mkdirSync(dirPath, { recursive: true });
    for (const [dest, src] of copies) {
      if (dest === 'POSCAR') {
        fs.writeFileSync(resolve(dirPath, 'POSCAR'), newText, 'utf-8');
      } else if (dest === 'POTCAR' && opts.linkPotcar) {
        const link = resolve(dirPath, 'POTCAR');
        if (fs.existsSync(link)) fs.unlinkSync(link);
        fs.linkSync(src, link);
      } else {
        fs.copyFileSync(src, resolve(dirPath, dest));
      }
    }
    const incarPath = resolve(dirPath, 'INCAR');
    if (copies.has('INCAR') && t.incarOverrides) {
      const incar = fs.readFileSync(incarPath, 'utf-8');
      fs.writeFileSync(incarPath, applyIncarOverrides(incar, t.incarOverrides), 'utf-8');
    }
    wrote = true;
  }

  const sourcesObj = {};
  for (const [dest, src] of copies) sourcesObj[dest] = src;

  // P3: surface every flag rewrite against the source file.
  const sdNotes = [];
  if (sdMeta && sdMeta.changedCount > 0) {
    const sample = sdMeta.changedFlags.slice(0, 5)
      .map((c) => '原子' + c.index + ' ' + c.from + '→' + c.to).join('、');
    sdNotes.push('NOTE: ' + sdMeta.changedCount + ' 个原子旗标被改写（' + sample
      + (sdMeta.changedCount > 5 ? ' 等' : '') + '；源文件为 ' + sdMeta.coordType + '）');
  }
  return {
    sources: sourcesObj,
    sd: sdMeta ? (sdMeta.fFlags + 'F, ' + sdMeta.tFlags + 'T (' + sdMeta.coordType + ', ' + sdMeta.nAtoms + ' atoms)') : (sdError || 'n/a'),
    sdNotes,
    potcar: potcarResult,
    errors,
    warnings,
    wrote,
  };
}

/**
 * Build VASP input files for a batch of tasks.
 * Returns { results, okCount, warnCount, errorCount, dryRun, count,
 * wroteCount, written }.
 */
export async function buildInputs(projectRoot, tasks, opts = {}) {
  const results = [];
  for (const task of tasks) {
    let r;
    try {
      r = await buildOneTask(task, projectRoot, opts);
    } catch (error) {
      r = { sources: {}, sd: 'n/a', potcar: 'N/A', errors: ['工具执行异常: ' + String(error)], warnings: [], wrote: false };
    }
    const status = r.errors.length > 0 ? 'error' : (r.warnings.length > 0 ? 'warn' : 'ok');
    results.push({ dir: task.dir, status, sources: r.sources, sd: r.sd, sdNotes: r.sdNotes ?? [], potcar: r.potcar, errors: r.errors, warnings: r.warnings, wrote: r.wrote });
  }
  const okCount = results.filter((r) => r.status === 'ok').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const dryRun = !!opts.dryRun;
  const wroteCount = results.filter((r) => r.wrote).length;
  return {
    results,
    okCount,
    warnCount,
    errorCount,
    dryRun,
    count: results.length,
    wroteCount,
    written: !dryRun && wroteCount > 0,
  };
}
