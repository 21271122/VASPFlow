/**
 * dsh-vaspflow host: VASP structure-source inspector (B1).
 *
 * Scans a directory tree for structure files (*.vasp, POSCAR, CONTCAR) and
 * reports per-file header facts (species, counts, SD flags, coordinate count,
 * trailing junk lines) plus a cross-file consistency report. Intended to run
 * BEFORE building (vasp_build_inputs): catches SD/model inconsistencies in
 * the sources before they are copied into N task directories (P3/P4 class).
 *
 * @module dsh-vaspflow/host/src-inspect
 */
import fs from 'node:fs';
import { resolve, relative } from 'node:path';
import { parsePoscarHeader, parseCoords } from './input-builder.js';

/** Inspect one structure file. Returns a plain record, never throws. */
export function srcInspectOne(p) {
  const res = {
    path: p,
    relPath: relative(process.cwd(), p),
    elements: [],
    counts: [],
    nAtoms: 0,
    coordType: 'Direct',
    hasSd: false,
    fFlags: 0,
    tFlags: 0,
    nCoord: 0,
    trailingLines: 0,
    error: '',
  };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const parsed = parsePoscarHeader(lines);
    if (parsed.error) { res.error = parsed.error; return res; }
    res.elements = parsed.elements;
    res.counts = parsed.counts;
    res.nAtoms = parsed.counts.reduce((a, b) => a + b, 0);
    res.coordType = parsed.coordType;
    res.hasSd = parsed.sdIdx >= 0;
    const { coords } = parseCoords(lines, parsed.coordStart, res.nAtoms);
    res.nCoord = coords.length;
    // trailing: extra rows after the species-count coordinates that still look
    // like coordinate lines (e.g. the 0 0 0 padding emitted by xsd2pos.py)
    let trailing = 0;
    for (let i = parsed.coordStart + coords.length; i < lines.length; i += 1) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 3 && Number.isFinite(Number(parts[0])) && Number.isFinite(Number(parts[1])) && Number.isFinite(Number(parts[2]))) {
        trailing += 1;
      }
    }
    res.trailingLines = trailing;
    for (const c of coords) {
      if (c.flags) {
        if (c.flags[0] === 'F') res.fFlags += 1;
        else if (c.flags[0] === 'T') res.tFlags += 1;
      }
    }
  } catch (error) {
    res.error = '读取失败: ' + String(error);
  }
  return res;
}

/** Scan a root directory for structure files and return per-file + consistency. */
export function srcInspect(rootPath, maxDepth = 10) {
  const files = [];
  const targets = new Set(['POSCAR', 'CONTCAR']);
  const stack = [{ dir: resolve(rootPath), depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const en of entries) {
      const full = resolve(dir, en.name);
      if (en.isDirectory()) {
        if (['node_modules', '.git'].includes(en.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (en.isFile()) {
        if (targets.has(en.name) || /\.vasp$/i.test(en.name)) files.push(full);
      }
    }
  }
  const scanned = files.map(srcInspectOne);

  // cross-file consistency: group by species + SD pattern + coordinate type
  const groups = new Map();
  for (const s of scanned) {
    const key = JSON.stringify(s.elements) + ' | ' + s.coordType + ' | '
      + s.fFlags + 'F,' + s.tFlags + 'T' + (s.hasSd ? ' | SD' : ' | no-SD');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s.path);
  }
  const groupList = [...groups.entries()].map(([pattern, paths]) => ({ pattern, count: paths.length, files: paths }));
  const uniform = groupList.length <= 1;
  return {
    files: scanned,
    count: scanned.length,
    consistency: {
      uniform,
      groups: groupList,
      note: uniform
        ? '源文件模式一致（' + scanned.length + ' 个文件）'
        : '源文件模式不一致：' + groupList.map((g) => g.count + ' 个为「' + g.pattern + '」').join('；'),
    },
  };
}
