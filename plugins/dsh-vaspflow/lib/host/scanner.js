/**
 * Project discovery and deterministic B1 task-state classification.
 *
 * The scanner reports observable file-system facts. It deliberately does not
 * decide whether a calculation is scientifically suitable or submitable.
 */
import { promises as fsp, openSync, readSync, statSync, opendirSync, closeSync, readFileSync } from 'node:fs';
import { basename, join, normpath, relpath, resolve, sep } from './paths.js';

export const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '__pycache__', '.vscode', 'dist', '.vite', '.venv', 'venv',
]);

const STANDARD_INPUTS = ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR'];
const OUTPUT_NAMES = new Set(['OUTCAR', 'OSZICAR', 'vasprun.xml']);
const ERROR_SIGNATURES = [
  ['EDDDAV', /EDDDAV/i, 'electronic'],
  ['BRMIX', /BRMIX/i, 'electronic'],
  ['ZBRENT_FATAL', /ZBRENT:[^\n]*(?:fatal|abort(?:ed|ing)?|error|failed)/i, 'ionic'],
  // A frequency calculation can still print the normal VASP timing footer
  // after DSYEV reports invalid eigenpairs. The vibrational result is not
  // usable, so this explicit terminal error takes precedence over that footer.
  ['VIBRATIONAL_DSYEV_FAILURE', /(?:Intel MKL ERROR:\s*Parameter\s+\d+\s+was incorrect on entry to DSYEV\.|Error while diagonalisation DSYEV\s+INFO=\s*-?\d+)/i, 'vibrational', true],
  ['SUBSPACE_NOT_HERMITIAN', /Sub-Space-Matrix is not hermitian/i, 'electronic'],
  ['SEGMENTATION_FAULT', /Segmentation fault/i, 'process'],
  ['FORRTL_SEVERE', /forrtl:\s*severe/i, 'process'],
  ['SLURM_OUT_OF_MEMORY', /OUT_OF_MEMORY|oom-kill/i, 'scheduler'],
  ['SLURM_TIME_LIMIT', /DUE TO TIME LIMIT/i, 'scheduler'],
  ['SLURM_CANCELLED', /\bCANCELLED\b/i, 'scheduler'],
];

const WARNING_SIGNATURES = [
  ['ZBRENT_FALLBACK', /ZBRENT:\s*can't locate minimum, use default step/i, 'ionic'],
];

/**
 * Parsed task records are safe to reuse only when every relevant file remains
 * unchanged. This is deliberately an in-process I/O cache, not state memory:
 * no previous observation participates in the status decision.
 */
const taskCache = new Map();

export function clearScanCache() {
  taskCache.clear();
}

export function toFloat(value) {
  return Number(value.replace(/D/g, 'E').replace(/d/g, 'e'));
}

export function stripIncarComment(line) {
  for (const marker of ['#', '!']) {
    const index = line.indexOf(marker);
    if (index >= 0) line = line.slice(0, index);
  }
  return line.trim();
}

export function quickParseIncar(incarPath) {
  const summary = {};
  let system = 'unknown';
  try {
    for (const rawLine of readText(incarPath).split(/\r?\n/)) {
      for (const segment of rawLine.split(';')) {
        const line = stripIncarComment(segment);
        const index = line.indexOf('=');
        if (index < 0) continue;
        const key = line.slice(0, index).trim().toUpperCase();
        const value = line.slice(index + 1).trim();
        if (!key) continue;
        summary[key] = value;
        if (key === 'SYSTEM' && value) system = value;
      }
    }
  } catch {
    // An unreadable INCAR remains an inspectable, unknown task.
  }
  return { system, summary };
}

const OSZICAR_SUMMARY_PATTERN = /^\s*(\d+)\s+F=\s*([\d.\-+EDed]+)/;

export function quickParseOszicarSummary(oszicarPath) {
  let nIon = 0;
  let finalEnergy = null;
  try {
    for (const line of readText(oszicarPath).split(/\r?\n/)) {
      const match = OSZICAR_SUMMARY_PATTERN.exec(line);
      if (!match) continue;
      // OSZICAR can be truncated or contain output from a restarted run.  The
      // printed ionic-step number, rather than the number of lines we happen
      // to read, is the only useful value for comparing against NSW.
      nIon = Math.max(nIon, Number(match[1]));
      finalEnergy = toFloat(match[2]);
    }
  } catch {
    // best effort only
  }
  return { nIon, finalEnergy };
}

/** Compatibility helper retained for existing consumers and tests. */
export function quickParseOutcarTail(outcarPath, tailLines = 200) {
  const tailText = readTail(outcarPath, tailLines);
  return {
    isFinished: hasNormalEnd(tailText, outcarPath),
    isConverged: /reached required accuracy/i.test(tailText),
    // `aborting loop because EDIFF is reached` is positive, not an error.
    errorMsg: findErrorEvidence([{ path: outcarPath, text: tailText }])[0]?.message ?? '',
  };
}

function vectorLength(vector) {
  return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}

function vectorAngle(left, right) {
  const leftLength = vectorLength(left);
  const rightLength = vectorLength(right);
  if (leftLength === 0 || rightLength === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (leftLength * rightLength)));
  return Math.acos(cosine) * 180 / Math.PI;
}

export function quickParseContcarLattice(contcarPath) {
  try {
    const lines = readText(contcarPath).split(/\r?\n/);
    const scale = toFloat(lines[1].trim().split(/\s+/)[0]);
    const vectors = [];
    for (let index = 2; index < 5; index += 1) {
      vectors.push(lines[index].trim().split(/\s+/).slice(0, 3).map(toFloat).map((value) => value * scale));
    }
    const lengths = vectors.map(vectorLength);
    return lengths.concat([
      vectorAngle(vectors[1], vectors[2]), vectorAngle(vectors[0], vectors[2]), vectorAngle(vectors[0], vectors[1]),
    ]);
  } catch {
    return null;
  }
}

/** Scan one strict single-task directory or one NEB composite parent. */
export function scanSingleDir(dirpath, rootPath, filenames) {
  const names = filenames ?? readDirNames(dirpath);
  const isStandardTask = STANDARD_INPUTS.every((name) => names.has(name));
  const cached = isStandardTask ? taskCache.get(cachePath(dirpath)) : undefined;
  const localOutputs = isStandardTask ? collectOutputs(dirpath, names, null) : [];
  const baseSignature = isStandardTask ? scanSignature(dirpath, STANDARD_INPUTS, localOutputs) : '';
  if (isStandardTask && cached?.baseSignature === baseSignature) {
    const outputs = cached.neb ? collectOutputs(dirpath, names, cached.neb) : localOutputs;
    const signature = scanSignature(dirpath, STANDARD_INPUTS, outputs);
    // The parsed observation is reusable, but `rel_path` belongs to the
    // current project root. The same physical task can be scanned from a
    // parent project and then from a nested project in one DSH process.
    if (signature === cached.signature) return withFreshObservation(cached.task, relpath(dirpath, rootPath));
  }

  const neb = inspectNebLayout(dirpath, names);
  if (!isStandardTask && !neb) return null;

  const rel = relpath(dirpath, rootPath);
  const { system, summary: incarSummary } = quickParseIncar(join(dirpath, 'INCAR'));
  const taskType = detectTaskType(dirpath, incarSummary, neb);
  const outputs = neb ? collectOutputs(dirpath, names, neb) : localOutputs;
  const outputText = outputs.map((output) => ({ ...output, text: readTail(output.absolutePath) }));
  const statusRecord = classifyTask({ dirpath, names, incarSummary, taskType, neb, outputs: outputText });

  let nIon = 0;
  let finalEnergy = null;
  if (names.has('OSZICAR')) ({ nIon, finalEnergy } = quickParseOszicarSummary(join(dirpath, 'OSZICAR')));
  const latticeConsts = names.has('CONTCAR') ? quickParseContcarLattice(join(dirpath, 'CONTCAR')) : null;

  const task = {
    rel_path: rel,
    label: basename(dirpath) || rel,
    system,
    // Legacy field stays available while 0.3 clients migrate.
    status: legacyStatus(statusRecord.code),
    is_converged: statusRecord.code === 'TASK_COMPLETED' && ['RELAXATION', 'NEB'].includes(taskType.code),
    n_ion_steps: nIon,
    final_energy: finalEnergy,
    final_max_force: null,
    magmom_total: null,
    lattice_consts: latticeConsts,
    incar_summary: incarSummary,
    error_message: statusRecord.code === 'ERROR_DETECTED' ? statusRecord.reason : '',
    is_vasp_task: true,
    directory_type: 'VASP_TASK_DIRECTORY',
    task_type: taskType,
    status_record: statusRecord,
    input_check: notRequestedInputCheck(),
    output_files: outputs.map(({ absolutePath, ...output }) => output),
  };
  taskCache.set(cachePath(dirpath), {
    baseSignature,
    signature: scanSignature(dirpath, STANDARD_INPUTS, outputs),
    neb,
    task,
  });
  return task;
}

/**
 * Scan breadth-first. `onEvent` receives only completed task states; a
 * discovered directory is intentionally a loading placeholder, never a grey
 * "unknown" task.
 */
export async function scanProject(rootPath, { onEvent, signal, concurrency = 4 } = {}) {
  const tasks = [];
  const directories = [];
  const failedDirectories = [];
  const visited = new Set();
  let level = [rootPath];
  while (level.length > 0) {
    if (signal?.aborted) break;
    const nextLevel = [];
    const results = await mapWithConcurrency(level, concurrency, async (dirpath) => {
      const key = cachePath(dirpath);
      if (visited.has(key) || shouldSkipDir(dirpath)) return null;
      visited.add(key);
      try {
        const entries = await fsp.readdir(dirpath, { withFileTypes: true });
        const filenames = new Set();
        const childDirs = [];
        for (const entry of entries) {
          if (entry.isFile()) filenames.add(entry.name);
          else if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name.toLowerCase())) childDirs.push(join(dirpath, entry.name));
        }
        childDirs.sort((left, right) => left.localeCompare(right));
        return { dirpath, filenames, childDirs };
      } catch (error) {
        return { dirpath, error };
      }
    });

    for (const result of results) {
      if (!result || signal?.aborted) continue;
      const rel = relpath(result.dirpath, rootPath);
      if (result.error) {
        const failed = { ...directoryRecord(result.dirpath, rootPath), reason: String(result.error) };
        failedDirectories.push(failed);
        onEvent?.({ type: 'directory-failed', directory: failed, reason: failed.reason });
        continue;
      }
      for (const childDir of result.childDirs) {
        const child = directoryRecord(childDir, rootPath);
        onEvent?.({ type: 'directory-discovered', directory: child });
        nextLevel.push(childDir);
      }
      const task = scanSingleDir(result.dirpath, rootPath, result.filenames);
      const directory = directoryRecord(result.dirpath, rootPath);
      if (rel !== '.') directories.push(directory);
      if (task) tasks.push(task);
      onEvent?.({ type: 'directory-scanned', directory, task });
    }
    level = nextLevel;
  }
  onEvent?.({ type: 'scan-complete', tasks, directories, failedDirectories, cancelled: Boolean(signal?.aborted) });
  return { tasks, directories, failedDirectories };
}

function directoryRecord(dirpath, rootPath) {
  return { rel_path: relpath(dirpath, rootPath), label: basename(dirpath), directory_type: 'ORDINARY_DIRECTORY' };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

function cachePath(dirpath) {
  return resolve(dirpath).toLowerCase();
}

function scanSignature(dirpath, inputNames, outputs) {
  const entries = [];
  for (const name of inputNames) entries.push(fileSignature(join(dirpath, name), name));
  for (const output of outputs) entries.push(`${output.path}:${output.size}:${output.mtimeMs}`);
  return entries.sort().join('|');
}

function fileSignature(path, label) {
  try {
    const stat = statSync(path);
    return `${label}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${label}:missing`;
  }
}

function withFreshObservation(task, relPath = task.rel_path) {
  const observedAt = new Date().toISOString();
  return {
    ...task,
    rel_path: relPath,
    status_record: { ...task.status_record, observedAt },
    input_check: { ...task.input_check, observedAt },
  };
}

/** Stable path-keyed detail payload used by the Agent. It performs no writes. */
export function inspectTaskStatus(dirpath, rootPath) {
  const task = scanSingleDir(dirpath, rootPath);
  if (!task) return null;
  return {
    root_path: rootPath,
    rel_path: task.rel_path,
    task_type: task.task_type,
    status: task.status_record,
    input_check: task.input_check,
    output_files: task.output_files,
    recommended_actions: recommendedActions(task.status_record.code, task.task_type.code),
  };
}

export function notRequestedInputCheck() {
  return {
    code: 'NOT_REQUESTED',
    label: '未指定检查规则',
    profileId: '',
    profileVersion: '',
    checkedFiles: [],
    uncheckedItems: ['未指定模板或任务类型检查规则'],
    evidence: [],
    observedAt: new Date().toISOString(),
  };
}

function inspectNebLayout(dirpath, names) {
  if (!names.has('INCAR') || !names.has('KPOINTS') || !names.has('POTCAR')) return null;
  const { summary } = quickParseIncar(join(dirpath, 'INCAR'));
  const images = positiveInteger(summary.IMAGES);
  if (!images) return null;
  const imageDirs = readChildDirs(dirpath).filter((name) => /^\d+$/.test(name)).sort();
  const expected = Array.from({ length: images + 2 }, (_, index) => String(index).padStart(2, '0'));
  const missing = expected.filter((name) => !imageDirs.includes(name) || !hasFile(join(dirpath, name, 'POSCAR')));
  return { images, imageDirs, expected, missing };
}

function detectTaskType(dirpath, incar, neb) {
  if (neb) return { code: 'NEB', label: 'NEB / CI-NEB', requiredOutputs: ['neb.dat 或 NEB 收敛证据'] };
  const ibrion = positiveOrZeroInteger(incar.IBRION);
  const nsw = positiveOrZeroInteger(incar.NSW);
  if ([5, 6, 7, 8].includes(ibrion)) return { code: 'FREQUENCY_ZPE', label: '频率 / ZPE', requiredOutputs: ['OUTCAR 频率区块'] };
  if (ibrion === 0 && nsw > 0) return { code: 'AIMD', label: 'AIMD', requiredOutputs: ['OSZICAR 轨迹步'] };
  if ([1, 2, 3].includes(ibrion) && nsw > 0) return { code: 'RELAXATION', label: '结构优化 / 晶胞优化', requiredOutputs: ['OUTCAR 离子收敛标记'] };
  const availableOutputIntents = [];
  if (isBandKpoints(join(dirpath, 'KPOINTS')) || valueMatches(incar.ICHARG, /^11\b/)) availableOutputIntents.push('能带相关输出');
  if (valueMatches(incar.LELF, /^(T|\.TRUE\.)/i)) availableOutputIntents.push('ELF 输出');
  if (incar.LORBIT !== undefined || incar.NEDOS !== undefined) availableOutputIntents.push('投影态密度 / 轨道分辨输出');
  if (valueMatches(incar.LCHARG, /^(T|\.TRUE\.)/i)) availableOutputIntents.push('电荷密度输出');
  if (valueMatches(incar.LWAVE, /^(T|\.TRUE\.)/i)) availableOutputIntents.push('波函数输出');
  return { code: 'STATIC_SCF', label: '静态单点 / SCF', requiredOutputs: [], availableOutputIntents };
}

function classifyTask({ dirpath, names, incarSummary, taskType, neb, outputs }) {
  const observedAt = new Date().toISOString();
  if (outputs.length === 0) return status('NO_OUTPUT_EVIDENCE', '未发现计算输出', '未找到 OUTCAR、vasprun.xml、OSZICAR 或有效 Slurm 输出日志', [], observedAt);
  const errors = findErrorEvidence(outputs);
  const warnings = findWarningEvidence(outputs);
  const normalEnds = outputs.filter((output) => hasNormalEnd(output.text, output.path));
  const completion = completionEvidence({ dirpath, names, incarSummary, taskType, neb, outputs, normalEnds });
  if (completion.complete) return status('TASK_COMPLETED', '任务完成', completion.reason, [...completion.evidence, ...warnings], observedAt);
  const decisiveError = errors.find((item) => item.decisive === true);
  if (decisiveError) return status('ERROR_DETECTED', '检测到错误', decisiveError.message, [...errors, ...warnings], observedAt);
  if (errors.length > 0 && normalEnds.length > 0) {
    return status('UNKNOWN', '待检查', '同时发现正常结束与致命错误证据，无法确认是否属于同一次计算', [...normalEnds.map(normalEndEvidence), ...errors, ...warnings], observedAt);
  }
  if (errors.length > 0) return status('ERROR_DETECTED', '检测到错误', errors[0].message, [...errors, ...warnings], observedAt);
  if (completion.failed) return status('ERROR_DETECTED', '检测到错误', completion.reason, [...completion.evidence, ...warnings], observedAt);
  if (normalEnds.length === 0) {
    return status('RUNNING', '正在运行', '已发现计算输出，尚未达到完成目标，也未见终止或致命错误证据', [...outputFileEvidence(outputs), ...warnings], observedAt);
  }
  return status('UNKNOWN', '待检查', completion.reason, [...completion.evidence, ...warnings], observedAt);
}

function completionEvidence({ dirpath, names, incarSummary, taskType, neb, outputs, normalEnds }) {
  if (taskType.code === 'NEB') return nebCompletion(neb, outputs);
  if (normalEnds.length === 0) return { complete: false, reason: '未见正常结束标记', evidence: [] };
  const normalEvidence = normalEnds.map(normalEndEvidence);
  if (taskType.code === 'RELAXATION') {
    const proof = outputs.find((output) => /reached required accuracy/i.test(output.text));
    return proof
      ? { complete: true, reason: '结构优化已出现离子收敛标记', evidence: [...normalEvidence, evidence('RELAXATION_ACCURACY', proof, '已出现 reached required accuracy')] }
      : relaxationFailure(dirpath, incarSummary, outputs, normalEvidence);
  }
  if (taskType.code === 'FREQUENCY_ZPE') {
    const proof = outputs.find((output) => hasCompleteFrequencyEvidence(output.text));
    return proof
      ? { complete: true, reason: '有限差分位移已完成，且频率模式区块可解析', evidence: [...normalEvidence, evidence('FREQUENCY_BLOCK', proof, '已发现完成的有限差分进度和频率模式')] }
      : { complete: false, reason: '已正常结束，但未找到完成的有限差分进度与可识别频率模式', evidence: normalEvidence };
  }
  if (taskType.code === 'AIMD') {
    const nsw = positiveOrZeroInteger(incarSummary.NSW);
    const oszicar = outputs.find((output) => output.path === 'OSZICAR');
    const { nIon } = oszicar ? quickParseOszicarSummary(join(dirpath, oszicar.path)) : { nIon: 0 };
    return nIon >= nsw && nsw > 0
      ? { complete: true, reason: `AIMD 已完成 ${nIon}/${nsw} 个目标轨迹步`, evidence: [...normalEvidence, evidence('AIMD_STEPS', oszicar, `OSZICAR 中有 ${nIon}/${nsw} 个离子步`)] }
      : { complete: false, reason: `已正常结束，但 AIMD 轨迹步不足（${nIon}/${nsw || '?'}）`, evidence: normalEvidence };
  }
  return { complete: true, reason: `${taskType.label}已正常结束，确定性完成判据通过`, evidence: normalEvidence };
}

function relaxationFailure(dirpath, incarSummary, outputs, normalEvidence) {
  const nsw = positiveOrZeroInteger(incarSummary.NSW);
  const oszicar = outputs.find((output) => output.path === 'OSZICAR');
  const { nIon } = oszicar ? quickParseOszicarSummary(join(dirpath, oszicar.path)) : { nIon: 0 };
  if (nsw > 0 && nIon >= nsw) {
    return {
      complete: false,
      failed: true,
      reason: `结构优化已达到 NSW=${nsw}，但未达到离子收敛条件（未收敛）`,
      evidence: [...normalEvidence, evidence('RELAXATION_NSW_EXHAUSTED', oszicar, `OSZICAR 中已有 ${nIon}/${nsw} 个离子步，未见 reached required accuracy`)],
    };
  }
  return { complete: false, reason: '已正常结束，但未找到结构优化的离子收敛标记', evidence: normalEvidence };
}

function hasCompleteFrequencyEvidence(text) {
  const progress = [...text.matchAll(/Finite differences progress:[\s\S]{0,500}?Total:\s*(\d+)\s*\/\s*(\d+)/gi)].at(-1);
  if (!progress || Number(progress[1]) !== Number(progress[2]) || Number(progress[2]) === 0) return false;
  return /(?:^|\n)\s*\d+\s+f\s*(?:\/i)?\s*=/im.test(text);
}

function nebCompletion(neb, outputs) {
  if (neb.missing.length > 0) return { complete: false, reason: `NEB image 目录或 POSCAR 不完整：${neb.missing.join('、')}`, evidence: [] };
  const imageOutcars = neb.expected.map((image) => outputs.find((output) => output.path === `${image}/OUTCAR`));
  if (imageOutcars.some((output) => !output || !hasNormalEnd(output.text, output.path))) {
    return { complete: false, reason: 'NEB 尚未获得全部 image 的正常结束证据', evidence: outputFileEvidence(outputs) };
  }
  const proof = outputs.find((output) => output.path === 'neb.dat' && /(?:NEB:.*(?:reached required accuracy|converged)|\bforce\b)/i.test(output.text))
    ?? outputs.find((output) => /NEB:.*(?:reached required accuracy|converged|force)/i.test(output.text));
  if (!proof) return { complete: false, reason: 'NEB image 已结束，但未找到 NEB 链力 / 收敛证据', evidence: imageOutcars.map(normalEndEvidence) };
  return {
    complete: true,
    reason: '全部 NEB image 已结束，且已找到 NEB 专项链力 / 收敛证据',
    evidence: [...imageOutcars.map(normalEndEvidence), evidence('NEB_CHAIN_CONVERGENCE', proof, 'NEB 专项链力 / 收敛证据')],
  };
}

function collectOutputs(dirpath, names, neb) {
  const files = [];
  for (const name of names) if (OUTPUT_NAMES.has(name) || isSlurmOutput(name)) addOutput(files, dirpath, name, name);
  if (neb) {
    for (const image of neb.imageDirs) {
      const imagePath = join(dirpath, image);
      for (const name of readDirNames(imagePath)) if (OUTPUT_NAMES.has(name) || isSlurmOutput(name)) addOutput(files, imagePath, name, `${image}/${name}`);
    }
    if (names.has('neb.dat')) addOutput(files, dirpath, 'neb.dat', 'neb.dat');
  }
  return files;
}

function addOutput(files, dirpath, name, path) {
  try {
    const absolutePath = join(dirpath, name);
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return;
    files.push({ path, absolutePath, size: stat.size, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs });
  } catch {
    // A file can disappear mid-scan; remaining evidence is still valid.
  }
}

function findErrorEvidence(outputs) {
  const found = [];
  for (const output of outputs) {
    for (const [ruleId, pattern, category, decisive = false] of ERROR_SIGNATURES) {
      const match = pattern.exec(output.text);
      if (!match) continue;
      const message = ruleId === 'VIBRATIONAL_DSYEV_FAILURE'
        ? `${output.path} 中的振动矩阵对角化失败（DSYEV）`
        : `${output.path} 匹配错误签名 ${ruleId}`;
      found.push({ ruleId, category, severity: 'error', decisive, file: output.path, message, excerpt: excerptAt(output.text, match.index) });
    }
  }
  return found;
}

function findWarningEvidence(outputs) {
  const found = [];
  for (const output of outputs) {
    for (const [ruleId, pattern, category] of WARNING_SIGNATURES) {
      const match = pattern.exec(output.text);
      if (!match) continue;
      found.push({ ruleId, category, severity: 'warning', file: output.path, message: `${output.path} 出现 ${ruleId} 警告`, excerpt: excerptAt(output.text, match.index) });
    }
  }
  return found;
}

function hasNormalEnd(text, path) {
  return path.endsWith('vasprun.xml') ? /<\/modeling>\s*$/i.test(text) : /General timing and accounting/i.test(text);
}

function normalEndEvidence(output) {
  return evidence('NORMAL_END', output, `${output.path} 中发现正常结束标记`);
}

function evidence(ruleId, output, message) {
  if (!output) return { ruleId, file: '', severity: 'info', message, excerpt: '' };
  return { ruleId, file: output.path, severity: 'info', message, excerpt: '' };
}

function outputFileEvidence(outputs) {
  return outputs.slice(0, 4).map((output) => evidence('OUTPUT_FILE', output, `${output.path}，最后修改于 ${output.modifiedAt}`));
}

function status(code, label, reason, evidenceList, observedAt) {
  return { code, label, reason, evidence: evidenceList, observedAt };
}

function legacyStatus(code) {
  if (code === 'TASK_COMPLETED') return 'finished';
  if (code === 'ERROR_DETECTED') return 'error';
  return 'unknown';
}

function recommendedActions(code, taskType) {
  if (code === 'NO_OUTPUT_EVIDENCE') return ['确认该目录是否已提交计算，或运行指定输入规则检查'];
  if (code === 'RUNNING') return ['等待下一次扫描确认进度；不要依据当前状态重复提交'];
  if (code === 'ERROR_DETECTED') return ['打开证据文件核对错误签名，再决定是否修改输入或续算'];
  if (code === 'UNKNOWN') return ['查看状态证据与最后更新时间；必要时检查调度器或补充任务类型规则'];
  return taskType === 'FREQUENCY_ZPE' ? ['检查虚频等质量警告；完成不代表结构必然稳定'] : ['按研究工作流复核输入与结果质量'];
}

function isSlurmOutput(name) {
  return name.toLowerCase().includes('slurm') && !/\.(?:sh|bash|sbatch)$/i.test(name);
}

function isBandKpoints(path) {
  try {
    return /line[- ]?mode/i.test(readText(path));
  } catch {
    return false;
  }
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function positiveOrZeroInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function valueMatches(value, pattern) {
  return pattern.test(String(value ?? '').trim());
}

function shouldSkipDir(dirpath) {
  return normpath(dirpath).split(sep).some((part) => SKIP_DIR_NAMES.has(part.toLowerCase()));
}

function readDirNames(dirpath) {
  try {
    const names = new Set();
    const dir = opendirSync(dirpath);
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) if (entry.isFile()) names.add(entry.name);
    } finally {
      dir.closeSync();
    }
    return names;
  } catch {
    return new Set();
  }
}

function readChildDirs(dirpath) {
  try {
    const names = [];
    const dir = opendirSync(dirpath);
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) if (entry.isDirectory()) names.push(entry.name);
    } finally {
      dir.closeSync();
    }
    return names;
  } catch {
    return [];
  }
}

function readTail(path, tailLines = 500) {
  try {
    const fileSize = statSync(path).size;
    const size = Math.min(fileSize, 65536);
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, Math.max(0, fileSize - size));
      return buffer.toString('utf-8').split('\n').slice(-tailLines).join('\n');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

function readText(path) {
  return readFileSync(path, 'utf-8');
}

function hasFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function excerptAt(text, index) {
  const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1);
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 240);
}
