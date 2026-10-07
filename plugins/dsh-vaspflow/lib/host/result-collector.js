import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { scanProject } from './scanner.js';
import { parseIonicEnergyPoints, parseMaxForces } from './parser.js';

const METRICS = {
  RELAXATION: ['last_ionic_free_energy', 'last_max_force', 'ionic_steps'],
  FREQUENCY_ZPE: ['frequencies', 'zpe', 'vibrational_entropy', 'vibrational_free_energy'],
};
const UNITS = { last_ionic_free_energy: 'eV', last_max_force: 'eV/Å', ionic_steps: '步', frequencies: 'cm^-1', zpe: 'eV', vibrational_entropy: 'eV/K', vibrational_free_energy: 'eV' };
const KB = 8.617333262145e-5;
const CM_TO_EV = 1.239841984e-4;

function safeRel(root, input) {
  const raw = String(input ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
  const absolute = resolve(root, raw);
  const rel = relative(root, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null;
  return rel.replace(/\\/g, '/') || '.';
}

function formulaOf(dir) {
  try {
    const file = existsSync(join(dir, 'CONTCAR')) ? 'CONTCAR' : 'POSCAR';
    const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/);
    const elements = lines[5].trim().split(/\s+/);
    const counts = lines[6].trim().split(/\s+/).map(Number);
    if (elements.length !== counts.length || !elements.every((s) => /^[A-Z][a-z]?$/.test(s)) || !counts.every((n) => Number.isInteger(n) && n > 0)) return { composition: '', atomCount: null };
    return { composition: elements.map((s, i) => `${s}${counts[i] === 1 ? '' : counts[i]}`).join(''), atomCount: counts.reduce((a, b) => a + b, 0) };
  } catch { return { composition: '', atomCount: null }; }
}

function metric(value, unit, sourcePath, sourceField, status = 'ok', note = '') {
  return { value, unit, status, sourcePath, sourceField, note };
}

async function relaxationValues(dir, rel, metrics) {
  const values = {};
  const oszicar = join(dir, 'OSZICAR');
  const outcar = join(dir, 'OUTCAR');
  const points = existsSync(oszicar) ? await parseIonicEnergyPoints(oszicar) : [];
  const last = points.at(-1);
  if (metrics.includes('last_ionic_free_energy')) values.last_ionic_free_energy = metric(Number.isFinite(last?.energy) ? last.energy : null, 'eV', `${rel}/OSZICAR`, 'last ionic step F=', last && Number.isFinite(last.energy) ? 'ok' : 'missing', last ? '' : 'OSZICAR 中没有离子步 F=');
  if (metrics.includes('ionic_steps')) values.ionic_steps = metric(points.length || null, '步', `${rel}/OSZICAR`, 'ionic F= records', points.length ? 'ok' : 'missing', points.length ? '' : '没有离子步记录');
  if (metrics.includes('last_max_force')) {
    const forces = existsSync(outcar) ? await parseMaxForces(outcar) : [];
    const aligned = points.length > 0 && forces.length === points.length && Number.isFinite(forces.at(-1));
    values.last_max_force = metric(aligned ? forces.at(-1) : null, 'eV/Å', `${rel}/OUTCAR`, 'FORCES: max atom, RMS / TOTAL-FORCE', aligned ? 'ok' : 'missing', aligned ? '' : `末步力无法与离子步对齐（能量 ${points.length} 步，力 ${forces.length} 步）`);
  }
  return values;
}

async function parseFrequencyModes(path) {
  const modes = [];
  if (!existsSync(path)) return modes;
  for await (const line of createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })) {
    const match = /^\s*(\d+)\s+f\s*(\/i)?\s*=.*?([\d.+\-EeDd]+)\s*cm\s*(?:-1|\^-1)/i.exec(line);
    if (!match) continue;
    const frequency = Number(match[3].replace(/[Dd]/g, 'E'));
    if (!Number.isFinite(frequency)) continue;
    modes.push({ index: Number(match[1]), frequencyCm1: match[2] ? -Math.abs(frequency) : frequency, kind: match[2] ? 'imaginary' : 'real' });
  }
  return modes;
}

function expectedModes(dir) {
  try {
    const lines = readFileSync(join(dir, 'POSCAR'), 'utf8').split(/\r?\n/);
    const counts = lines[6].trim().split(/\s+/).map(Number);
    if (!counts.every((n) => Number.isInteger(n) && n > 0)) return null;
    const count = counts.reduce((a, b) => a + b, 0);
    const selective = /^s/i.test(lines[7]?.trim() ?? '');
    if (!selective) return count * 3;
    const start = 9;
    const atomLines = lines.slice(start, start + count);
    if (atomLines.length !== count) return null;
    let free = 0;
    for (const line of atomLines) {
      const flags = line.trim().split(/\s+/).slice(3, 6);
      if (flags.length !== 3 || !flags.every((s) => /^[TF]$/i.test(s))) return null;
      free += flags.filter((s) => /^T$/i.test(s)).length;
    }
    return free;
  } catch { return null; }
}

async function frequencyValues(dir, rel, metrics, temperatureK, completed) {
  const path = join(dir, 'OUTCAR');
  const modes = await parseFrequencyModes(path);
  const expected = expectedModes(dir);
  const imaginary = modes.some((mode) => mode.kind === 'imaginary');
  const reliable = completed && expected !== null && modes.length === expected && !imaginary;
  const reason = !modes.length ? 'OUTCAR 未发现频率模式' : imaginary ? '含虚频，未计算派生热力学量' : expected === null ? '无法核对自由度' : modes.length !== expected ? `模式数 ${modes.length} 与自由度 ${expected} 不符` : !completed ? '频率任务未确认完成' : '';
  const values = {};
  const source = `${rel}/OUTCAR`;
  if (metrics.includes('frequencies')) values.frequencies = metric(modes.length ? modes : null, 'cm^-1', source, 'f=/f/i=', modes.length ? 'ok' : 'missing', modes.length ? '' : reason);
  const quanta = modes.filter((mode) => mode.kind === 'real').map((mode) => mode.frequencyCm1 * CM_TO_EV);
  const zpe = quanta.reduce((sum, energy) => sum + energy / 2, 0);
  if (metrics.includes('zpe')) values.zpe = metric(reliable ? zpe : null, 'eV', source, '0.5 Σ hν', reliable ? 'ok' : 'invalid', reason);
  if (metrics.includes('vibrational_entropy') || metrics.includes('vibrational_free_energy')) {
    let entropy = 0;
    let freeEnergy = 0;
    if (reliable) for (const energy of quanta) {
      const x = energy / (KB * temperatureK);
      const expNeg = Math.exp(-x);
      entropy += KB * (x * expNeg / (1 - expNeg) - Math.log1p(-expNeg));
      freeEnergy += energy / 2 + KB * temperatureK * Math.log1p(-expNeg);
    }
    if (metrics.includes('vibrational_entropy')) values.vibrational_entropy = metric(reliable ? entropy : null, 'eV/K', source, `S_vib(${temperatureK} K)`, reliable ? 'ok' : 'invalid', reason);
    if (metrics.includes('vibrational_free_energy')) values.vibrational_free_energy = metric(reliable ? freeEnergy : null, 'eV', source, `F_vib(${temperatureK} K)`, reliable ? 'ok' : 'invalid', reason);
  }
  return values;
}

export async function collectResults(args) {
  const root = resolve(String(args.rootPath ?? ''));
  const empty = (error) => ({ query: args, summary: { discovered: 0, included: 0, excluded: 0, complete: 0, partial: 0 }, rows: [], excluded: [], error });
  if (!existsSync(root)) return empty(`目录不存在：${root}`);
  const subtrees = args.scope?.subtrees ?? [];
  const paths = args.scope?.taskPaths ?? [];
  if (!Array.isArray(subtrees) || !Array.isArray(paths) || !subtrees.length && !paths.length) return empty('请指定父目录或精确任务路径');
  if (subtrees.length + paths.length > 200) return empty('选择器不能超过 200 个');
  if (!METRICS[args.calculationType]) return empty('不支持的计算类别');
  const metrics = [...new Set(args.metrics ?? [])];
  if (!metrics.length || metrics.some((name) => !METRICS[args.calculationType].includes(name))) return empty('请求指标与计算类别不匹配');
  const temperatureK = args.conditions?.temperatureK;
  if (metrics.some((name) => name === 'vibrational_entropy' || name === 'vibrational_free_energy') && !(Number.isFinite(temperatureK) && temperatureK > 0)) return empty('振动熵或振动自由能需要正数温度 K');
  const cleanSubtrees = subtrees.map((item) => ({ relPath: safeRel(root, item.relPath), maxDepth: item.maxDepth }));
  const cleanPaths = paths.map((path) => safeRel(root, path));
  if (cleanSubtrees.some((item) => item.relPath === null || !Number.isInteger(item.maxDepth) || item.maxDepth < 0 || item.maxDepth > 20) || cleanPaths.includes(null)) return empty('路径越出项目目录，或 maxDepth 不在 0–20 范围');
  const scan = await scanProject(root);
  const byPath = new Map(scan.tasks.map((task) => [task.rel_path.replace(/\\/g, '/').toLowerCase(), task]));
  const chosen = new Map();
  const excluded = [];
  for (const path of cleanPaths) {
    const task = byPath.get(path.toLowerCase());
    if (!task) { excluded.push({ relPath: path, reason: '未找到 VASP 任务' }); continue; }
    const key = task.rel_path.replace(/\\/g, '/').toLowerCase();
    const entry = chosen.get(key) ?? { task, matchedBy: [] };
    entry.matchedBy.push(`task:${path}`);
    chosen.set(key, entry);
  }
  for (const subtree of cleanSubtrees) {
    const prefix = subtree.relPath === '.' ? '' : `${subtree.relPath.toLowerCase()}/`;
    const scopeDir = resolve(root, subtree.relPath);
    if (!existsSync(scopeDir)) { excluded.push({ relPath: subtree.relPath, reason: '父目录不存在' }); continue; }
    for (const task of scan.tasks) {
      const path = task.rel_path.replace(/\\/g, '/').toLowerCase();
      if (path !== subtree.relPath.toLowerCase() && !path.startsWith(prefix)) continue;
      const depth = path === subtree.relPath.toLowerCase() ? 0 : path.slice(prefix.length).split('/').length;
      if (depth > subtree.maxDepth) continue;
      const entry = chosen.get(path) ?? { task, matchedBy: [] };
      entry.matchedBy.push(`subtree:${subtree.relPath}@${subtree.maxDepth}`);
      chosen.set(path, entry);
    }
  }
  if (chosen.size > 200) return empty(`范围命中 ${chosen.size} 个任务，超过 200 个；请缩小范围`);
  const rows = [];
  for (const { task, matchedBy } of chosen.values()) {
    if (task.task_type?.code !== args.calculationType) { excluded.push({ relPath: task.rel_path, reason: `计算类别为 ${task.task_type?.code ?? '未知'}，不属于 ${args.calculationType}` }); continue; }
    const dir = resolve(root, task.rel_path);
    const values = args.calculationType === 'RELAXATION' ? await relaxationValues(dir, task.rel_path, metrics) : await frequencyValues(dir, task.rel_path, metrics, temperatureK, task.status_record?.code === 'TASK_COMPLETED');
    rows.push({ relPath: task.rel_path, calculationType: args.calculationType, matchedBy, calculationStatus: task.status_record?.code ?? 'UNKNOWN', ...formulaOf(dir), values });
  }
  rows.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true }));
  const complete = rows.filter((row) => Object.values(row.values).every((item) => item.status === 'ok')).length;
  return { query: args, summary: { discovered: chosen.size, included: rows.length, excluded: excluded.length, complete, partial: rows.length - complete }, rows, excluded, error: '' };
}
