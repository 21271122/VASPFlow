/**
 * dsh-vaspflow host plugin — full data service.
 *
 * HTTP routes under /plugins/dsh-vaspflow/* (port plan §4.3):
 *   POST /plugins/dsh-vaspflow/scan?root_path=            → {project_id, tasks, directories}
 *   GET  /plugins/dsh-vaspflow/tasks/{id}                 → task list of a project
 *   POST /plugins/dsh-vaspflow/task/open-by-path?root_path=&rel_path=
 *   GET  /plugins/dsh-vaspflow/task/{id}/convergence
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure?file=
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure-scene?file=&include_connectivity=&bond_algorithm=
 *   GET  /plugins/dsh-vaspflow/task/{id}/files
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure-files
 *   GET  /plugins/dsh-vaspflow/task/{id}/file-content?name=
 *   POST /plugins/dsh-vaspflow/task/{id}/input-check?profile_id=
 *   GET  /plugins/dsh-vaspflow/ping                       → {ok:true}
 *
 * The VASP Agent preset registers the model-facing `vasp_*` tools through
 * the shared `vaspflowTools` service. The host itself never exposes them to
 * every Agent.
 *
 * Routes register lazily once the Web server service binds, mirroring
 * dsh-token-panel.
 *
 * @module dsh-vaspflow
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { scanProject, scanSingleDir } from './host/scanner.js';
import { parseConvergence, parseConvergenceSummary } from './host/parser.js';
import { getStructure, getStructureScene } from './host/structure.js';
import {
  listFilesAndDirs,
  listStructureFiles,
  readTextPreview,
  resolveTaskFile,
  taskDir,
} from './host/task-files.js';
import { TaskStore } from './host/task-store.js';
import { buildInputs } from './host/input-builder.js';
import { checkInputs, checkOneDir, buildInputCheck, INPUT_CHECK_PROFILES } from './host/input-checker.js';
import { srcInspect } from './host/src-inspect.js';
import { scanTemplates } from './host/scan-templates.js';
import { fileURLToPath } from 'node:url';
import { join as joinPath, basename, dirname, resolve as resolvePath, relative as relativePath, isAbsolute, sep } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const name = 'dsh-vaspflow';
export const inject = [];

export const Config = z.object({
  defaultScanRoot: z.string().default(''),
  dryRun: z.boolean().default(true),
});

const WEB_SERVER_KEYS = ['webServer', 'httpServer'];
// This file is present only in the checked-out source tree. package.json's
// explicit "files" list excludes it from the npm tarball, so public installs
// never report themselves as development builds.
const developmentMode = existsSync(joinPath(dirname(fileURLToPath(import.meta.url)), '..', '.vaspflow-development'));

/** Session workspace cwd for a tool call (same contract as dsh-tool-fs.sessionCwd). */
function workspaceOf(exec) {
  return exec?.agent?.session?.header?.cwd || process.cwd();
}

/** Every vasp_* tool returns a top-level error string; '' means the call itself succeeded. */
function directoryError(rootPath) {
  return isDirectory(rootPath) ? '' : `Directory not found or unreadable: ${rootPath}`;
}

function statusActions(code) {
  if (code === 'NO_OUTPUT_EVIDENCE') return ['确认是否已提交计算，或运行用户指定的输入规则检查'];
  if (code === 'RUNNING') return ['等待下一次扫描确认进度；不要依据当前状态重复提交'];
  if (code === 'ERROR_DETECTED') return ['打开证据文件核对错误签名，再决定是否修改输入或续算'];
  if (code === 'UNKNOWN') return ['查看状态证据和最后更新时间；必要时检查调度器或补充任务类型规则'];
  return ['按研究工作流复核输入与结果质量'];
}

function normalizeRelPath(relPath) {
  return String(relPath ?? '').replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || '.';
}

function taskAtPath(rootPath, relPath) {
  const root = resolvePath(rootPath);
  const candidate = resolvePath(root, normalizeRelPath(relPath));
  const relative = relativePath(root, candidate);
  if (isAbsolute(relative) || relative === '..' || relative.startsWith(`..${sep}`)) return null;
  const task = scanSingleDir(candidate, rootPath);
  return task ? { ...task, root_path: rootPath } : null;
}

const RENDER_TEXT_LIMIT = 30_000;

function clipRenderText(value, limit = RENDER_TEXT_LIMIT) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（结果过长，已截断 ${text.length - limit} 个字符）`;
}

function renderJson(value, limit = 16_000) {
  try {
    return clipRenderText(JSON.stringify(value, null, 2), limit);
  } catch {
    return String(value ?? '');
  }
}

function renderEvidence(items, limit = 8) {
  if (!Array.isArray(items) || items.length === 0) return '无';
  const lines = items.slice(0, limit).map((item) => {
    const file = item.file ? ` [${item.file}]` : '';
    const excerpt = item.excerpt ? `：${item.excerpt}` : '';
    return `- ${item.message ?? item.ruleId ?? '未命名证据'}${file}${excerpt}`;
  });
  if (items.length > limit) lines.push(`- …另有 ${items.length - limit} 条证据`);
  return lines.join('\n');
}

function renderFileList(files, limit = 120) {
  if (!Array.isArray(files) || files.length === 0) return '无';
  const lines = files.slice(0, limit).map((file) => `${file.name ?? file.path ?? '未命名文件'} (${file.size ?? '?'} B)`);
  if (files.length > limit) lines.push(`…另有 ${files.length - limit} 个文件`);
  return lines.join(', ');
}

function renderBatchInspection(value) {
  if (value.error) return [{ type: 'text', text: `读取计算状态失败：${value.error}` }];
  const rows = value.results.map((row) => row.error
    ? `${row.rel_path} | 读取失败：${row.error}`
    : `${row.rel_path} | 计算状态：${row.status?.label ?? row.status?.code ?? '未知'}${row.status?.reason ? `（${row.status.reason}）` : ''} | 先前输入规则检查记录：${row.input_check?.profileId ? `${row.input_check.profileId} / ${row.input_check.label}` : '无'} | 状态证据：${renderEvidence(row.status?.evidence, 4)} | 文件：${renderFileList(row.files, 16)}`);
  return [{ type: 'text', text: clipRenderText(`查看 ${value.results.length} 个任务的计算状态（输入正确性须调用 vasp_check_inputs；先前记录不代表本次复查）：\n${rows.join('\n')}`) }];
}

function inspectScannedTask(rootPath, relPath, scanResult, store) {
  const task = scanResult.tasks.find((candidate) => normalizeRelPath(candidate.rel_path) === normalizeRelPath(relPath));
  if (!task) return { root_path: rootPath, rel_path: relPath, files: [], dirs: [], error: '目录不是已识别的 VASP 任务：需要四个标准输入文件，或符合 NEB 父目录结构' };
  const info = store.getTask(task.id) ?? { ...task, root_path: rootPath };
  const entries = listFilesAndDirs(taskDir(info));
  return {
    root_path: rootPath,
    rel_path: task.rel_path,
    task_type: task.task_type,
    status: task.status_record,
    input_check: task.input_check,
    output_files: task.output_files,
    recommended_actions: statusActions(task.status_record.code),
    files: entries.files,
    dirs: entries.dirs,
    error: '',
  };
}

function renderScanResult(value) {
  if (value.error) return [{ type: 'text', text: `扫描失败：${value.error}` }];
  const counts = {};
  for (const task of value.tasks ?? []) {
    const label = task.status_record?.label ?? task.status ?? '未知';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const rows = (value.tasks ?? []).slice(0, 120).map((task) => {
    const label = task.status_record?.label ?? task.status ?? '未知';
    return `${task.rel_path} | ${label} | ${task.task_type?.label ?? task.task_type?.code ?? '未知'}`;
  });
  if ((value.tasks ?? []).length > 120) rows.push(`…另有 ${(value.tasks ?? []).length - 120} 个任务`);
  const directories = (value.directories ?? []).slice(0, 120).map((directory) => `${directory.rel_path} | ${directory.label}`);
  if ((value.directories ?? []).length > 120) directories.push(`…另有 ${(value.directories ?? []).length - 120} 个目录`);
  return [{ type: 'text', text: clipRenderText([
    `扫描目录：${value.root_path}；扫描完成：${value.tasks?.length ?? 0} 个 VASP 任务，${value.directories?.length ?? 0} 个子目录（含任务目录；project_id=${value.project_id}）`,
    `状态统计：${Object.entries(counts).map(([label, count]) => `${label} ${count}`).join('；') || '无'}`,
    `任务清单：\n${rows.length > 0 ? rows.join('\n') : '无'}`,
    `普通目录：\n${directories.length > 0 ? directories.join('\n') : '无'}`,
  ].join('\n\n')) }];
}

function renderSeries(values, limit = 120) {
  if (!Array.isArray(values) || values.length <= limit) return values ?? [];
  const head = Math.floor(limit / 2);
  return { head: values.slice(0, head), tail: values.slice(-head), omitted: values.length - head * 2 };
}

/**
 * Conversation-page presentation for the input builder.
 *
 * `output.render()` is the model-facing text contract. These presenters are
 * the separate, human-facing conversation card contract: keep the default
 * view short and useful, while leaving the canonical JSON result untouched.
 */
function buildInputsCallContent(args) {
  const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
  const names = tasks.slice(0, 4).map((task) => task?.dir).filter(Boolean);
  const extra = tasks.length > names.length ? `；另有 ${tasks.length - names.length} 个任务` : '';
  const options = [
    args?.linkPotcar ? 'POTCAR 使用链接' : 'POTCAR 使用复制',
    tasks.some((task) => task?.freeAtoms?.length || task?.fixedAtoms?.length) ? '按原子序号处理 SD' : '',
  ].filter(Boolean);
  return [{
    type: 'text',
    text: [
      `目标：构建 ${tasks.length} 个任务`,
      names.length > 0 ? `任务：${names.join('、')}${extra}` : '任务：未提供',
      options.length > 0 ? `选项：${options.join('；')}` : '',
    ].filter(Boolean).join('\n'),
  }];
}

function buildInputsCallLocations(args) {
  const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
  const locations = [];
  for (const task of tasks.slice(0, 12)) {
    if (task?.dir) locations.push({ path: String(task.dir) });
    for (const source of [task?.poscarSrc, task?.incarSrc, task?.kpointsSrc, task?.potcarSrc, task?.submitSrc]) {
      if (source) locations.push({ path: String(source) });
    }
  }
  return locations.slice(0, 24);
}

function buildInputsResultContent(value) {
  const data = value?.meta && typeof value.meta === 'object' ? value.meta : value;
  if (data?.error) return [{ type: 'text', text: `输入文件构建失败\n${data.error}` }];
  const results = Array.isArray(data?.results) ? data.results : [];
  const count = data?.count ?? results.length;
  const wroteCount = data?.wroteCount ?? 0;
  const mode = data?.dryRun
    ? '当前模式：用户预览确认；构建计划完成，未写入任何文件'
    : `当前模式：交给 AI 直接构建；已写入 ${wroteCount}/${count} 个任务`;
  const rows = results.slice(0, 6).map((row) => {
    const icon = row?.errors?.length ? '失败' : row?.warnings?.length ? '注意' : '通过';
    const notes = [row?.sd && `SD ${row.sd}`, row?.potcar && `POTCAR ${row.potcar}`].filter(Boolean).join(' · ');
    const sources = row?.sources && Object.keys(row.sources).length > 0
      ? `来源: ${Object.entries(row.sources).map(([dest, src]) => `${dest}←${src}`).join('，')}`
      : '';
    const issue = row?.errors?.[0] ?? row?.warnings?.[0] ?? '';
    return `${icon}：${row?.dir ?? '未命名任务'}${notes ? ` · ${notes}` : ''}${sources ? ` · ${sources}` : ''}${issue ? ` · ${issue}` : ''}`;
  });
  if (results.length > rows.length) rows.push(`…另有 ${results.length - rows.length} 个任务，展开结果可查看完整清单`);
  return [{
    type: 'text',
    text: [
      mode,
      data?.dryRun && data?.planId ? '等待用户在任务树确认；确认按钮会直接写入，不需要再次调用构建工具' : '',
      `结果：${data?.okCount ?? 0} 个通过 · ${data?.warnCount ?? 0} 个有注意项 · ${data?.errorCount ?? 0} 个失败`,
      rows.length > 0 ? rows.join('\n') : '没有任务结果',
    ].filter(Boolean).join('\n'),
  }];
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function scanEvent(res, type, body) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(body)}\n\n`);
}

/** Parse the query string of a Node request into a plain object. */
function parseQuery(url) {
  const q = url.split('?')[1] ?? '';
  const out = {};
  for (const part of q.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    out[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
  }
  return out;
}

/**
 * Register the model-facing VASP tools into one Agent's scoped tool catalog.
 *
 * The host plugin deliberately does not call this at startup: the VASP Agent
 * preset injects the shared service and calls it only for sessions that chose
 * that preset. `store` remains host-owned so agent scans and the dock panel
 * still observe the same task ids and task data.
 */
export function registerVaspTools(ctx, store, buildPlans = new Map(), buildMode = { dryRun: true }, buildOutcomes = new Map(), saveBuildOutcomes = () => {}) {

  ctx.tools.register(defineTool({
    name: 'vasp_scan',
    description: '扫描一个 VASP 项目目录树。标准任务目录必须同时存在 POSCAR、INCAR、KPOINTS、POTCAR；NEB 父目录按共享输入和 image 结构识别。返回五态状态记录、最小证据和普通目录清单，面板与 Agent 共用同一数据层。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '要扫描的根目录绝对路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'number' },
          root_path: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'number' },
                rel_path: { type: 'string' },
                label: { type: 'string' },
                system: { type: 'string' },
                status: { type: 'string' },
                is_converged: { type: 'boolean' },
                n_ion_steps: { type: 'number' },
                // Some input-only tasks have no OSZICAR yet, so this remains
                // nullable while the status_record explains why.
                final_energy: { type: 'json' },
                status_record: { type: 'object', additionalProperties: true },
                input_check: { type: 'object', additionalProperties: true },
              },
            },
          },
          directories: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                rel_path: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderScanResult(value),
      presentationMeta: (_args, value) => ({ rootPath: value.root_path, error: value.error, tasks: value.tasks, directories: value.directories }),
    },
    async execute(args) {
      const error = directoryError(args.rootPath);
      if (error) return { project_id: 0, root_path: args.rootPath, tasks: [], directories: [], error };
      try {
        const scanResult = await scanProject(args.rootPath);
        const projectId = store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
        return { project_id: projectId, root_path: args.rootPath, tasks: scanResult.tasks, directories: scanResult.directories, error: '' };
      } catch (caught) {
        return { project_id: 0, root_path: args.rootPath, tasks: [], directories: [], error: `Scan failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '扫描计算目录', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_inspect_tasks',
    description: '一次查看 1–200 个 VASP 任务的计算运行状态：读取输出证据和目录文件清单；只展示此前输入规则检查记录，不重新校验输入文件。需要检查输入正确性时使用 vasp_check_inputs；要读文件内容时使用文件读取工具。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      relPaths: { type: 'array', required: true, items: { type: 'string' }, description: '相对于项目根目录的任务路径列表。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        root_path: { type: 'string' },
        results: { type: 'array', items: { type: 'object', additionalProperties: true } },
        error: { type: 'string', required: true },
      } },
      render: (_args, value) => renderBatchInspection(value),
      presentationMeta: (_args, value) => ({ rootPath: value.root_path, error: value.error, results: value.results.map((row) => ({ relPath: row.rel_path, status: row.status, inputCheck: row.input_check, fileCount: row.files?.length ?? 0, filesListed: true, outputFiles: row.output_files, error: row.error })) }),
    },
    async execute(args) {
      const error = directoryError(args.rootPath);
      if (error) return { root_path: args.rootPath, results: [], error };
      const relPaths = [...new Set((args.relPaths ?? []).map(normalizeRelPath))];
      if (relPaths.length === 0 || relPaths.length > 200) return { root_path: args.rootPath, results: [], error: '请提供 1–200 个任务路径' };
      try {
        const scanResult = await scanProject(args.rootPath);
        store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
        const results = relPaths.map((relPath) => {
          try { return inspectScannedTask(args.rootPath, relPath, scanResult, store); }
          catch (caught) { return { root_path: args.rootPath, rel_path: relPath, files: [], dirs: [], error: `Task inspection failed: ${String(caught)}` }; }
        });
        return { root_path: args.rootPath, results, error: '' };
      } catch (caught) {
        return { root_path: args.rootPath, results: [], error: `Batch inspection failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `查看 ${args.relPaths?.length ?? 0} 个 VASP 任务的计算状态`, kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_convergence',
    description: '读取 1–12 个 VASP 任务的收敛数据；每个任务独立给出离子步、能量和最大力，可在对话中切换比较。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      relPaths: { type: 'array', required: true, items: { type: 'string' }, description: '1–12 个相对项目根目录的任务路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root_path: { type: 'string' },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error ? `收敛数据不可用：${value.error}` : clipRenderText(value.results.map((row) => row.error
          ? `${row.rel_path}：${row.error}`
          : `${row.rel_path}：${row.ion_steps.length} 个离子步，末步能量 ${row.energies.at(-1)?.toFixed(6) ?? '未知'} eV；离子步 ${renderJson(renderSeries(row.ion_steps))}；能量 ${renderJson(renderSeries(row.energies))}；最大力 ${renderJson(renderSeries(row.max_forces))}`).join('\n')),
      }],
      presentationMeta: (_args, value) => ({ rootPath: value.root_path, results: value.results, error: value.error }),
    },
    async execute(args) {
      const rootError = directoryError(args.rootPath);
      if (rootError) return { root_path: args.rootPath, results: [], error: rootError };
      const relPaths = [...new Set(args.relPaths ?? [])];
      if (relPaths.length < 1 || relPaths.length > 12) return { root_path: args.rootPath, results: [], error: '请提供 1–12 个任务路径' };
      const results = await Promise.all(relPaths.map(async (relPath) => {
        const info = taskAtPath(args.rootPath, relPath);
        if (!info) return { rel_path: relPath, ion_steps: [], energies: [], max_forces: [], error: '未找到 VASP 任务' };
        try {
          const result = await parseConvergence(taskDir(info));
          const sourceFile = result._source?.startsWith('OUTCAR') ? 'OUTCAR' : result._source?.startsWith('OSZICAR') ? 'OSZICAR' : '';
          return { ...result, source_path: sourceFile ? joinPath(taskDir(info), sourceFile) : taskDir(info), rel_path: info.rel_path, error: result.error ?? '' };
        } catch (caught) {
          return { rel_path: relPath, ion_steps: [], energies: [], max_forces: [], error: `收敛数据解析失败：${String(caught)}` };
        }
      }));
      return { root_path: args.rootPath, results, error: '' };
    },
    presentCall: (args) => ({ card: 'generic', title: '查看收敛曲线', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_structure_scene',
    description: '读取 1–12 个结构文件并直接在对话中显示 3D 场景；可跨任务比较，每个结构独立标签页。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      structures: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        relPath: { type: 'string', required: true }, file: { type: 'string', description: '结构文件名，默认 CONTCAR。' },
      } }, description: '1–12 个结构引用，可来自不同任务，也可比较同一任务不同文件。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root_path: { type: 'string' },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error ? `结构读取失败：${value.error}` : clipRenderText(value.results.map((row) => row.error
          ? `${row.rel_path}/${row.file}：${row.error}`
          : `${row.rel_path}/${row.file}：${row.summary?.formula ?? '未知'}，${row.summary?.atom_count ?? row.atoms?.length ?? 0} 原子，${row.bonds?.length ?? 0} 条键；摘要 ${renderJson(row.summary ?? {})}；场景 ${renderJson({ cell: row.cell, atoms: row.atoms, bonds: row.bonds, bond_families: row.bond_families, warnings: row.warnings })}`).join('\n')),
      }],
      presentationMeta: (_args, value) => ({ rootPath: value.root_path, results: value.results, error: value.error }),
    },
    async execute(args) {
      const rootError = directoryError(args.rootPath);
      if (rootError) return { root_path: args.rootPath, results: [], error: rootError };
      const structures = args.structures ?? [];
      if (structures.length < 1 || structures.length > 12) return { root_path: args.rootPath, results: [], error: '请提供 1–12 个结构' };
      const results = structures.map(({ relPath, file = 'CONTCAR' }) => {
        const info = taskAtPath(args.rootPath, relPath);
        if (!info) return { rel_path: relPath, file, error: '未找到 VASP 任务' };
        const filePath = resolveTaskFile(info, file);
        if (!filePath) return { rel_path: info.rel_path, file, error: '未找到结构文件' };
        try {
          return { ...getStructureScene(filePath, { includeConnectivity: true, bondAlgorithm: 'minimum-distance' }), rel_path: info.rel_path, file, error: '' };
        } catch (caught) {
          return { rel_path: info.rel_path, file, error: `结构解析失败：${String(caught)}` };
        }
      });
      return { root_path: args.rootPath, results, error: '' };
    },
    presentCall: (args) => ({ card: 'generic', title: '查看原子结构', kind: 'other', rawInput: args }),
  }));

  // The two legacy taskId file tools remain here only as a short-lived source
  // compatibility adapter. New VASP Agent sessions use vasp_inspect_tasks.
  if (false) {
  ctx.tools.register(defineTool({
    name: 'vasp_task_files',
    description: '列出已扫描 VASP 任务目录内的文件与子目录（{files: [{name,size,ext}], dirs: [{name}]}）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
                size: { type: 'number' },
                ext: { type: 'string' },
              },
            },
          },
          dirs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
              },
            },
          },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `目录内容：${value.files.length} 个文件，${value.dirs.length} 个子目录`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { files: [], dirs: [], error: `Task ${args.taskId} not found` };
      try {
        return { ...listFilesAndDirs(taskDir(info)), error: '' };
      } catch (caught) {
        return { files: [], dirs: [], error: `List files failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP task files', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_read_file',
    description: '读取已扫描 VASP 任务目录内的一个文本文件（大文件默认返回末尾的一个受限片段，并返回位置范围）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
      name: { type: 'string', required: true, description: '文件名（如 INCAR、OUTCAR、CONTCAR）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          size: { type: 'number' },
          totalSize: { type: 'number' },
          offset: { type: 'number' },
          length: { type: 'number' },
          content: { type: 'string' },
          hasBefore: { type: 'boolean' },
          hasAfter: { type: 'boolean' },
          truncated: { type: 'boolean' },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `文件 ${value.name}（${value.size} 字节${value.truncated ? '，已截断' : ''}）：\n${value.content}`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { name: args.name, size: 0, totalSize: 0, offset: 0, length: 0, content: '', hasBefore: false, hasAfter: false, truncated: false, error: `Task ${args.taskId} not found` };
      try {
        return { ...readTextPreview(info, args.name), error: '' };
      } catch (caught) {
        return { name: args.name, size: 0, totalSize: 0, offset: 0, length: 0, content: '', hasBefore: false, hasAfter: false, truncated: false, error: `Read file failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Read VASP file', kind: 'other', rawInput: args }),
  }));
  }


  ctx.tools.register(defineTool({
    name: 'vasp_build_inputs',
    description: '按明确来源批量构建 VASP 输入：建目录、复制 INCAR/KPOINTS/POTCAR/POSCAR/提交脚本，按显式 freeAtoms 或 fixedAtoms 规则写 Selective dynamics，覆盖 INCAR 参数并校验 POTCAR-POSCAR 物种顺序。工具调用始终表达同一构建意图；预览或直接写入由插件模式决定，AI 不指定 dryRun。预览结果有 planId 时，任务树提供确认按钮并自动结束本轮；不要再次调用本工具来确认。直接构建按结果中的 wroteCount 和错误项判断实际写入情况。',
    parameters: {
      projectRoot: { type: 'string', description: '项目根目录：任务 dir 与相对源路径的基准；缺省用当前会话工作空间。' },
      tasks: {
        type: 'array', required: true, description: '构建任务列表。',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            dir: { type: 'string', required: true },
            poscarSrc: { type: 'string', description: '可选：POSCAR 源；未提供时跳过 SD/POTCAR 校验（分段构建）' },
            template: { type: 'string' },
            incarSrc: { type: 'string' },
            kpointsSrc: { type: 'string' },
            potcarSrc: { type: 'string' },
            submitSrc: { type: 'string', description: '可选：提交脚本（不自动探测；缺失仅警告，稍后补充）' },
            incarOverrides: { type: 'object', additionalProperties: true },
            sources: { type: 'object', additionalProperties: false, properties: {
              poscar: { type: 'string' }, incar: { type: 'string' }, kpoints: { type: 'string' },
              potcar: { type: 'string' }, submit: { type: 'string' },
            } },
            freeAtoms: { type: 'array', items: { type: 'number' } },
            fixedAtoms: { type: 'array', items: { type: 'number' } },
            sdPolicy: { type: 'string', enum: ['override', 'keep'], description: "SD 策略：'override'（默认）= 必须显式 freeAtoms/fixedAtoms；'keep' = 沿用源文件旗标，源无旗标时任务报错或警告" },
            extraFiles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              src: { type: 'string', description: '显式来源路径（相对 projectRoot 或绝对）；不存在 → 任务报错' },
              dest: { type: 'string', description: '目标文件名（缺省 = 来源文件名）' },
              fromTemplate: { type: 'string', description: '从模板目录取该文件（不存在 → 警告跳过）' },
            } }, description: '自定义/任意输入文件（如 WAVECAR、CHGCAR、DOSCAR、自建势文件）：任务需要的非标准输入' },
          },
        },
      },
      linkPotcar: { type: 'boolean', description: '用硬链接替代复制 POTCAR（默认 false）。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          results: {
            type: 'array', items: {
              type: 'object', additionalProperties: true, properties: {
                dir: { type: 'string' }, status: { type: 'string' },
                sources: { type: 'object', additionalProperties: true },
                sd: { type: 'string' }, potcar: { type: 'string' },
                errors: { type: 'array', items: { type: 'string' } },
                warnings: { type: 'array', items: { type: 'string' } },
                sdNotes: { type: 'array', items: { type: 'string' } },
                wrote: { type: 'boolean' },
              },
            },
          },
          okCount: { type: 'number' }, warnCount: { type: 'number' }, errorCount: { type: 'number' },
          dryRun: { type: 'boolean' }, count: { type: 'number' }, wroteCount: { type: 'number' },
          written: { type: 'boolean' },
          planId: { type: 'string' }, projectRoot: { type: 'string' },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: clipRenderText(buildInputsResultContent(value)[0].text),
      }],
      presentationMeta: (_args, value) => ({
        error: value.error,
        ...(value.planId ? { planId: value.planId } : {}),
        ...(value.projectRoot ? { projectRoot: value.projectRoot } : {}),
        dryRun: value.dryRun,
        count: value.count,
        wroteCount: value.wroteCount,
        okCount: value.okCount,
        warnCount: value.warnCount,
        errorCount: value.errorCount,
        results: Array.isArray(value.results) ? value.results.map((row) => ({
          dir: row.dir,
          sources: row.sources,
          sd: row.sd,
          sdNotes: row.sdNotes,
          potcar: row.potcar,
          errors: row.errors,
          warnings: row.warnings,
          wrote: row.wrote,
        })) : [],
      }),
    },
    async execute(args, exec) {
      const dryRun = buildMode.dryRun;
      try {
        const projectRoot = args.projectRoot ?? workspaceOf(exec);
        const result = await buildInputs(projectRoot, args.tasks ?? [], { dryRun, linkPotcar: !!args.linkPotcar });
        if (dryRun && Array.isArray(args.tasks) && args.tasks.length > 0) {
          for (const [id, plan] of buildPlans) {
            if (Date.now() - plan.createdAt > 30 * 60 * 1000) buildPlans.delete(id);
          }
          const planId = randomUUID();
          const sessionId = exec?.agent?.session?.header?.id;
          buildPlans.set(planId, { projectRoot, tasks: structuredClone(args.tasks), linkPotcar: !!args.linkPotcar, sessionId, createdAt: Date.now() });
          if (sessionId) {
            const rows = buildOutcomes.get(sessionId) ?? [];
            buildOutcomes.set(sessionId, [...rows.slice(-19), { planId, state: 'pending', projectRoot, dirs: args.tasks.map((task) => task.dir), updatedAt: Date.now() }]);
            saveBuildOutcomes();
          }
          exec?.concludeTurn?.();
          return { ...result, projectRoot, planId, error: '' };
        }
        return { ...result, projectRoot, error: '' };
      } catch (caught) {
        return { results: [], okCount: 0, warnCount: 0, errorCount: 0, dryRun, count: 0, wroteCount: 0, written: false, error: `Build inputs failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: '构建 VASP 输入文件',
      kind: 'edit',
      content: buildInputsCallContent(args),
      locations: buildInputsCallLocations(args),
    }),
    presentResult: (args, value) => ({
      card: 'generic',
      title: value?.error
        ? '构建 VASP 输入文件 · 失败'
        : value?.dryRun
          ? '构建 VASP 输入文件 · 预览完成'
          : '构建 VASP 输入文件 · 执行完成',
      content: buildInputsResultContent(value),
    }),
  }));
  ctx.tools.register(defineTool({
    name: 'vasp_check_inputs',
    description: '校验一批已构建的 VASP 任务目录：POSCAR-POTCAR 物种匹配（等长同序）、Selective dynamics 的 F/T 旗标（无旗标坐标报 FLAG_MISSING）、关键 INCAR 参数、KPOINTS 网格。每个目录独立检查，单个目录异常不中断其余。',
    parameters: {
      dirs: { type: 'array', required: true, items: { type: 'string' }, description: '待校验的目录路径（相对 projectRoot 或绝对）。' },
      projectRoot: { type: 'string', description: '项目根目录：dirs 里相对路径的解析基准（与 vasp_build_inputs 一致）；缺省用当前会话工作空间。' },
      profileId: { type: 'string', enum: Object.keys(INPUT_CHECK_PROFILES), description: '用户指定的检查规则：basic-inputs、static-scf、structure-optimization、frequency-zpe、aimd 或 neb。未指定时只返回原始机械检查结果，input_check 为“未指定检查规则”。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          project_root: { type: 'string' },
          results: {
            type: 'array', items: {
              type: 'object', additionalProperties: true, properties: {
                dir: { type: 'string' },
                resolved: { type: 'string' },
                species: { type: 'array', items: { type: 'string' } },
                poscarPotcar: { type: 'string' }, sd: { type: 'string' },
                warnings: { type: 'array', items: { type: 'string' } }, input_check: { type: 'object', additionalProperties: true },
                incar: { type: 'json' }, kpoints: { type: 'string' }, error: { type: 'string' },
              },
            },
          },
          consistency: {
            type: 'object', additionalProperties: true, properties: {
              uniform: { type: 'boolean' },
              groups: {
                type: 'array', items: {
                  type: 'object', additionalProperties: true, properties: {
                    pattern: { type: 'string' }, count: { type: 'number' },
                    dirs: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              note: { type: 'string' },
            },
          },
          linked_count: { type: 'number' },
          unlinked_dirs: { type: 'array', items: { type: 'string' } },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: clipRenderText(value.error ? `输入检查失败：${value.error}` : value.results.map((r) => {
          const inc = typeof r.incar === 'object' && r.incar ? Object.entries(r.incar).slice(0, 8).map(([k, v]) => k + '=' + v).join('; ') : (r.incar || '-');
          const warn = (r.warnings && r.warnings.length > 0) ? ' | 警告: ' + r.warnings.join('; ') : '';
          const check = r.input_check ? ` | 输入检查: ${r.input_check.label ?? r.input_check.code ?? '未检查'}${r.input_check.profileId ? `（${r.input_check.profileId}）` : ''}` : '';
          const evidence = r.input_check?.evidence?.length ? ` | 检查依据: ${r.input_check.evidence.map((item) => item.message ?? item.ruleId).join('; ')}` : '';
          return (r.error ? '[CRASH] ' : '[ok] ') + r.dir + ' -> ' + r.resolved + ' | POTCAR-POSCAR: ' + r.poscarPotcar + ' | SD: ' + r.sd + ' | ' + inc + ' | ' + r.kpoints + check + evidence + (r.error ? ' | ' + r.error : '') + warn;
        }).join('\n') + `\n目录一致性：${value.consistency?.note ?? '未提供'}\n[面板同步] 已关联 ${value.linked_count ?? 0} 个任务${value.unlinked_dirs?.length ? `；未关联：${value.unlinked_dirs.join(', ')}` : ''}`),
      }],
      presentationMeta: (args, value) => ({ projectRoot: value.project_root ?? args.projectRoot, profileId: args.profileId, results: value.results, consistency: value.consistency, error: value.error }),
    },
    execute(args, exec) {
      const projectRoot = args.projectRoot ?? workspaceOf(exec);
      try {
        const result = checkInputs(args.dirs ?? [], { projectRoot });
        const rows = result.results.map((row) => ({ ...row, input_check: buildInputCheck(row, args.profileId) }));
        let linkedCount = 0;
        const unlinkedDirs = [];
        for (const row of rows) {
          if (row.poscarPotcar === 'DIR_NOT_FOUND') continue;
          const linked = store.setInputCheck(projectRoot, store.relPathFromAbsolute(projectRoot, row.resolved), row.input_check);
          if (linked) linkedCount += 1;
          else unlinkedDirs.push(row.resolved);
        }
        return { ...result, project_root: projectRoot, results: rows, linked_count: linkedCount, unlinked_dirs: unlinkedDirs, error: '' };
      } catch (caught) {
        return { project_root: projectRoot, results: [], consistency: { uniform: true, groups: [], note: '' }, linked_count: 0, unlinked_dirs: [], error: `Check inputs failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '校验 VASP 输入', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_discover_inputs',
    description: '构建前一次发现结构源和候选模板：盘点 *.vasp/POSCAR/CONTCAR 的物种与 Selective dynamics，并列出含 INCAR 的模板目录及关键参数。仅报告候选，绝不替用户选择模板或提交脚本。',
    parameters: {
      rootPath: { type: 'string', description: '要扫描的根目录；缺省用当前会话工作空间。' },
      maxDepth: { type: 'number', description: '递归深度上限（默认 10）。' },
      include: { type: 'array', items: { type: 'string', enum: ['sources', 'templates'] }, description: '需要发现的候选；默认两类都返回。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          root_path: { type: 'string' },
          sources: { type: 'object', additionalProperties: true },
          templates: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `输入发现失败：${value.error}`
          : clipRenderText([
            `扫描目录：${value.root_path}；结构源文件：${value.sources.count} 个；一致性：${value.sources.consistency.note}`,
            `结构源明细：${renderJson(value.sources.files ?? [])}`,
            `含 INCAR 的候选模板目录：${value.templates.length} 个；这些不是参数组合数，也未自动选择`,
            `模板明细：${renderJson(value.templates)}`,
          ].join('\n')),
      }],
      presentationMeta: (_args, value) => ({ rootPath: value.root_path, sources: value.sources, templates: value.templates, error: value.error }),
    },
    execute(args, exec) {
      const rootPath = resolvePath(args.rootPath ?? workspaceOf(exec));
      const error = directoryError(rootPath);
      if (error) return { root_path: rootPath, sources: { files: [], count: 0, consistency: { uniform: true, groups: [], note: '' } }, templates: [], error };
      try {
        const include = new Set(args.include?.length ? args.include : ['sources', 'templates']);
        const sources = include.has('sources')
          ? srcInspect(rootPath, args.maxDepth ?? 10)
          : { files: [], count: 0, consistency: { uniform: true, groups: [], note: '未请求结构源盘点' } };
        const templates = include.has('templates') ? scanTemplates(rootPath, args.maxDepth ?? 10).templates : [];
        return { root_path: rootPath, sources, templates, error: '' };
      } catch (caught) {
        return { root_path: rootPath, sources: { files: [], count: 0, consistency: { uniform: true, groups: [], note: '' } }, templates: [], error: `Input discovery failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '寻找构建材料', kind: 'other', rawInput: args }),
  }));
  ctx.tools.register(defineTool({
    name: 'vasp_say',
    description: '仅在回答解释性问题或说明工具结果无法表达的阻碍时，向用户发送一条简短消息。需要用户回答的问题必须调用内置 ask_user_question。本调用必须单独进行；不能复述已有工具视图。',
    parameters: {
      kind: { type: 'string', required: true, enum: ['answer', 'blocker'] },
      text: { type: 'string', required: true, description: '向用户展示的正文；直接回答，避免过程播报。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { delivered: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: '消息已展示，当前轮次结束。' }],
    },
    execute(args, exec) {
      if (!['answer', 'blocker'].includes(args.kind) || typeof args.text !== 'string' || !args.text.trim() || args.text.length > 4000) {
        throw new Error('vasp_say requires a kind and 1–4000 characters of text');
      }
      exec.concludeTurn();
      return { delivered: true };
    },
    presentCall: () => ({ card: 'generic', title: '向用户发言', kind: 'other' }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_done',
    description: '当前轮次已有完整的 VASP 工具结果时结束本轮，不再输出正文。本调用必须单独进行。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: '本轮结束。' }],
    },
    execute(_args, exec) {
      exec.concludeTurn();
      return { done: true };
    },
    presentCall: () => ({ card: 'generic', title: '结束本轮', kind: 'other' }),
  }));

  // Superseded by vasp_discover_inputs; kept temporarily as an unregistered
  // implementation reference while 0.3 is validated.
  if (false) ctx.tools.register(defineTool({
    name: 'vasp_scan_templates',
    description: '扫描项目中的 VASP 输入模板目录（含 INCAR 的目录），报告文件齐备情况（INCAR/KPOINTS/POTCAR/提交脚本文件名）与关键 INCAR 参数（IBRION/NSW/ENCUT/ISPIN/EDIFFG/ISMEAR...）。仅用于向用户列出候选模板供确认；模板与提交脚本的最终选择仍由用户决定。',
    parameters: {
      rootPath: { type: 'string', description: '要扫描的根目录；缺省用当前会话工作空间。' },
      maxDepth: { type: 'number', description: '递归深度上限（默认 3）。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          templates: {
            type: 'array', items: {
              type: 'object', additionalProperties: true, properties: {
                relPath: { type: 'string' }, dir: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
                submit: { type: 'string' },
                params: { type: 'json' },
                complete: { type: 'boolean' },
              },
            },
          },
          count: { type: 'number' },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count + ' 个候选模板:\n' + value.templates.map((t) => {
          const p = t.params;
          const keys = ['IBRION', 'NSW', 'ENCUT', 'ISMEAR', 'SIGMA', 'ISPIN', 'EDIFFG'].filter((k) => p[k] !== undefined).map((k) => k + '=' + p[k]).join(' ');
          return (t.complete ? '[完整] ' : '[缺文件] ') + t.relPath + ' | 文件: ' + t.files.join(',') + ' | ' + keys;
        }).join('\n'),
      }],
    },
    execute(args, exec) {
      const rootPath = args.rootPath ?? workspaceOf(exec);
      const error = directoryError(rootPath);
      if (error) return { templates: [], count: 0, error };
      try {
        return { ...scanTemplates(rootPath, args.maxDepth ?? 3), error: '' };
      } catch (caught) {
        return { templates: [], count: 0, error: `Template scan failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Scan VASP templates', kind: 'other', rawInput: args }),
  }));
}

export function apply(ctx, config) {
  const store = new TaskStore();
  const buildPlans = new Map();
  const buildMode = { dryRun: config?.dryRun !== false };
  const outcomeFile = joinPath(process.env.DSH_HOME || joinPath(homedir(), '.dsh'), 'vaspflow', 'build-outcomes.json');
  let savedOutcomes = {};
  try { savedOutcomes = JSON.parse(readFileSync(outcomeFile, 'utf8')); } catch { /* no prior outcomes */ }
  const buildOutcomes = new Map(Object.entries(savedOutcomes).filter(([, rows]) => Array.isArray(rows)));
  const saveBuildOutcomes = () => {
    try {
      mkdirSync(dirname(outcomeFile), { recursive: true });
      writeFileSync(outcomeFile, JSON.stringify(Object.fromEntries([...buildOutcomes].slice(-40))), 'utf8');
    } catch { /* live session still retains the result */ }
  };
  const updateBuildOutcome = (sessionId, planId, patch) => {
    if (!sessionId) return;
    const rows = buildOutcomes.get(sessionId) ?? [];
    buildOutcomes.set(sessionId, rows.map((row) => row.planId === planId ? { ...row, ...patch, updatedAt: Date.now() } : row));
    saveBuildOutcomes();
  };

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    if (!assembly.tools?.some((tool) => tool.name === 'vasp_build_inputs')) return assembly;
    const sessionId = context.agent?.session?.header?.id;
    const outcomes = buildOutcomes.get(sessionId)?.slice(-8);
    if (!outcomes?.length) return assembly;
    const text = outcomes.map((item) => item.state === 'confirmed'
      ? `构建计划 ${item.planId}：用户已在界面确认，写入 ${item.wroteCount}/${item.selectedCount} 个任务，失败 ${item.errorCount} 个；目录数据：${JSON.stringify(item.dirs.slice(0, 12))}。不要说仍待确认。`
      : item.state === 'cancelled'
        ? `构建计划 ${item.planId}：用户已取消，未执行写入。`
        : item.state === 'invalidated' || Date.now() - item.updatedAt > 30 * 60 * 1000
          ? `构建计划 ${item.planId}：预览已失效，尚未写入；需要重新预览。`
          : `构建计划 ${item.planId}：仍在预览，尚未写入；目录数据：${JSON.stringify(item.dirs.slice(0, 12))}。`).join('\n');
    return { ...assembly, contexts: [...assembly.contexts, { name: 'vasp-build-outcomes', text }] };
  }, { global: true });

  // This service is consumed only by preset/vasp/tools/vaspflow-tools.mjs.
  // Its tool definitions close over this store, preserving panel/Agent state.
  ctx.provide('vaspflowTools', {
    register(toolCtx) {
      registerVaspTools(toolCtx, store, buildPlans, buildMode, buildOutcomes, saveBuildOutcomes);
    },
  });

  // ---- HTTP routes ------------------------------------------------------------

  let webRegistered = false;
  const registerWebSurface = () => {
    if (webRegistered) return;
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1]);
    if (webServer === undefined) return;
    webRegistered = true;

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/ping',
      handler: async (_req, res) => {
        json(res, 200, {
          ok: true,
          plugin: 'dsh-vaspflow',
          version: 3,
          development: developmentMode,
        });
      },
    }), 'dsh-vaspflow: ping route');

    // TaskStore version (reverse-linkage: the panel polls this and refreshes
    // when an agent tool bumped the store).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/version',
      handler: async (_req, res) => {
        json(res, 200, { version: store.version, projectId: store.projects.size > 0 ? store.nextProjectId - 1 : null });
      },
    }), 'dsh-vaspflow: version route');

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/build-inputs/mode',
      handler: async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { dryRun: buildMode.dryRun });
        if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST required' });
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (raw.length > 1024) return json(res, 413, { error: 'Request too large' });
          }
          const body = JSON.parse(raw);
          if (body?.dryRun !== true) return json(res, 400, { error: 'Only preview mode can be restored here' });
          buildMode.dryRun = true;
          return json(res, 200, { dryRun: true });
        } catch (error) {
          return json(res, 400, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: input build mode');

    // Replace one source in an existing preview plan. The edited plan is used
    // by confirmation, so the visible re-preview and eventual write agree.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/build-inputs/repreview',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (raw.length > 4096) return json(res, 413, { error: 'Request too large' });
          }
          const { planId, taskIndex, sourceKind, rootPath, relPath, file } = JSON.parse(raw);
          const plan = typeof planId === 'string' ? buildPlans.get(planId) : null;
          if (!plan || Date.now() - plan.createdAt > 30 * 60 * 1000) {
            buildPlans.delete(planId);
            return json(res, 404, { error: '预览已使用或过期，请重新预览' });
          }
          if (!Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= plan.tasks.length
            || !['structure', 'template'].includes(sourceKind)
            || typeof rootPath !== 'string' || !isAbsolute(rootPath) || !isDirectory(rootPath)
            || typeof relPath !== 'string') return json(res, 400, { error: '无效的构建来源' });
          const root = resolvePath(rootPath);
          const sourceDir = resolvePath(root, relPath);
          const inside = relativePath(root, sourceDir);
          if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !isDirectory(sourceDir)) {
            return json(res, 400, { error: '来源目录不在拖入的项目内' });
          }
          let source;
          if (sourceKind === 'structure') {
            if (typeof file !== 'string' || !/^(POSCAR|CONTCAR|[^\\/]+\.vasp)$/i.test(file)) return json(res, 400, { error: '请拖入结构文件' });
            source = resolvePath(sourceDir, file);
            if (!existsSync(source) || !statSync(source).isFile()) return json(res, 400, { error: '结构源文件不存在' });
          } else {
            source = sourceDir;
            if (!existsSync(joinPath(source, 'INCAR'))) return json(res, 400, { error: '模板目录需要包含 INCAR' });
          }
          const tasks = structuredClone(plan.tasks);
          const task = tasks[taskIndex];
          if (sourceKind === 'structure') {
            task.poscarSrc = source;
            if (task.sources) delete task.sources.poscar;
          } else {
            task.template = source;
            for (const key of ['incarSrc', 'kpointsSrc', 'potcarSrc']) delete task[key];
            if (task.sources) for (const key of ['incar', 'kpoints', 'potcar']) delete task.sources[key];
          }
          const preview = await buildInputs(plan.projectRoot, tasks, { dryRun: true, linkPotcar: plan.linkPotcar });
          plan.tasks = tasks;
          return json(res, 200, { ...preview, projectRoot: plan.projectRoot, planId, tasks, error: '' });
        } catch (error) {
          return json(res, 400, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: replace preview source');

    // A preview creates an opaque server-side plan. Only its selected task
    // indices may be confirmed; the browser cannot submit arbitrary paths.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/build-inputs/confirm',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (raw.length > 16384) return json(res, 413, { error: 'Request too large' });
          }
          const { planId, selectedIndices, cancel, enableDirect } = JSON.parse(raw);
          const plan = typeof planId === 'string' ? buildPlans.get(planId) : null;
          if (!plan || Date.now() - plan.createdAt > 30 * 60 * 1000) {
            buildPlans.delete(planId);
            return json(res, 404, { error: '预览已使用或过期，请重新预览' });
          }
          if (cancel === true) {
            buildPlans.delete(planId);
            updateBuildOutcome(plan.sessionId, planId, { state: 'cancelled' });
            return json(res, 200, { cancelled: true });
          }
          if (!Array.isArray(selectedIndices) || selectedIndices.length === 0
            || selectedIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= plan.tasks.length)
            || new Set(selectedIndices).size !== selectedIndices.length) {
            return json(res, 400, { error: '请选择有效的构建任务' });
          }
          buildPlans.delete(planId);
          const tasks = selectedIndices.map((index) => plan.tasks[index]);
          const preview = await buildInputs(plan.projectRoot, tasks, { dryRun: true, linkPotcar: plan.linkPotcar });
          if (preview.errorCount > 0) {
            updateBuildOutcome(plan.sessionId, planId, { state: 'invalidated' });
            return json(res, 409, { error: '任务预览已出现错误，请重新检查', ...preview });
          }
          const result = await buildInputs(plan.projectRoot, tasks, { dryRun: false, linkPotcar: plan.linkPotcar });
          updateBuildOutcome(plan.sessionId, planId, { state: 'confirmed', selectedCount: tasks.length, wroteCount: result.wroteCount, errorCount: result.errorCount, dirs: tasks.map((task) => task.dir) });
          if (enableDirect === true && result.errorCount === 0 && result.wroteCount === tasks.length) buildMode.dryRun = false;
          store.version += 1;
          return json(res, 200, { ...result, projectRoot: plan.projectRoot, dryRunMode: buildMode.dryRun, error: '' });
        } catch (error) {
          return json(res, 400, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: confirm input build');

    // Project scan (POST /scan?root_path=)
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/scan',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url ?? '');
          const rootPath = query.root_path ?? '';
          if (rootPath === '') {
            json(res, 400, { error: 'root_path required' });
            return;
          }
          const scanResult = await scanProject(rootPath);
          const projectId = store.addProject(rootPath, scanResult.tasks, scanResult.directories);
          json(res, 200, { project_id: projectId, tasks: scanResult.tasks, directories: scanResult.directories });
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: scan route');

    // Incremental breadth-first scan for the panel. The existing /scan route
    // remains the stable all-at-once contract used by tools and older clients.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/scan-events',
      handler: async (req, res) => {
        const query = parseQuery(req.url ?? '');
        const rootPath = query.root_path ?? '';
        if (rootPath === '') {
          json(res, 400, { error: 'root_path required' });
          return;
        }
        const controller = new AbortController();
        req.on?.('close', () => controller.abort());
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        });
        const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        scanEvent(res, 'scan-start', { batchId, root_path: rootPath });
        try {
          const scanResult = await scanProject(rootPath, {
            signal: controller.signal,
            onEvent: (event) => {
              if (controller.signal.aborted || event.type === 'scan-complete') return;
              if (event.task) store.addTask(rootPath, event.task);
              scanEvent(res, event.type, { ...event, batchId });
            },
          });
          if (!controller.signal.aborted) {
            const projectId = store.addProject(rootPath, scanResult.tasks, scanResult.directories);
            scanEvent(res, 'scan-complete', { batchId, project_id: projectId, ...scanResult });
          }
        } catch (error) {
          if (!controller.signal.aborted) scanEvent(res, 'scan-failed', { batchId, error: String(error) });
        } finally {
          res.end();
        }
      },
    }), 'dsh-vaspflow: incremental scan route');

    // Task list of a project (GET /tasks/{id})
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-vaspflow/tasks',
      handler: async (req, res) => {
        try {
          const pathname = new URL(req.url ?? '/', 'http://x').pathname;
          const id = Number(pathname.split('/').pop());
          const project = store.projects.get(id);
          if (!project) {
            json(res, 404, { error: 'Project not found' });
            return;
          }
          json(res, 200, project.tasks);
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: tasks route');

    // Open one directory as a task (POST /task/open-by-path?root_path=&rel_path=)
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/task/open-by-path',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url ?? '');
          const rootPath = query.root_path ?? '';
          const relPath = query.rel_path ?? '.';
          const fullPath = joinPath(rootPath, relPath);
          if (!isDirectory(fullPath)) {
            json(res, 404, { error: 'Directory not found' });
            return;
          }
          let taskData = scanSingleDir(fullPath, rootPath);
          if (taskData === null) {
            taskData = {
              rel_path: relPath,
              label: basename(fullPath) || relPath,
              system: 'unknown',
              status: 'directory',
              is_converged: false,
              n_ion_steps: 0,
              final_energy: null,
              final_max_force: null,
              magmom_total: null,
              lattice_consts: null,
              incar_summary: {},
              error_message: '',
              is_vasp_task: false,
            };
          }
          store.addTask(rootPath, taskData);
          json(res, 200, taskData);
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: open-by-path route');

    // Task-scoped routes (GET /task/{id}/...)
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-vaspflow/task',
      handler: async (req, res) => {
        try {
          const pathname = new URL(req.url ?? '/', 'http://x').pathname;
          const rest = pathname.slice('/plugins/dsh-vaspflow/task/'.length);
          const slash = rest.indexOf('/');
          const idText = slash < 0 ? rest : rest.slice(0, slash);
          const action = slash < 0 ? '' : rest.slice(slash + 1);
          const taskId = Number(idText);
          if (!Number.isFinite(taskId)) {
            json(res, 400, { error: `invalid task id: ${idText}` });
            return;
          }
          const info = store.tasks.get(taskId);
          if (!info) {
            json(res, 404, { error: `Task ${taskId} not found` });
            return;
          }
          const query = parseQuery(req.url ?? '');

          switch (action) {
            case 'input-check': {
              if (info.is_vasp_task === false) {
                json(res, 400, { error: '输入检查只适用于已识别的 VASP 任务目录' });
                return;
              }
              const profileId = query.profile_id ?? '';
              if (!INPUT_CHECK_PROFILES[profileId]) {
                json(res, 400, { error: 'profile_id must be one of: ' + Object.keys(INPUT_CHECK_PROFILES).join(', ') });
                return;
              }
              const rawCheck = checkOneDir(taskDir(info));
              const inputCheck = buildInputCheck(rawCheck, profileId);
              store.setInputCheck(info.root_path, info.rel_path, inputCheck);
              json(res, 200, { input_check: inputCheck, raw_check: rawCheck });
              return;
            }
            case 'convergence': {
              const result = await parseConvergence(taskDir(info));
              json(res, 200, result);
              return;
            }
            case 'structure': {
              const filePath = resolveTaskFile(info, query.file ?? 'CONTCAR');
              if (!filePath) {
                json(res, 404, { error: `File ${query.file ?? 'CONTCAR'} not found at ${taskDir(info)}` });
                return;
              }
              json(res, 200, getStructure(filePath));
              return;
            }
            case 'structure-scene': {
              const filePath = resolveTaskFile(info, query.file ?? 'CONTCAR');
              if (!filePath) {
                json(res, 404, { error: `File ${query.file ?? 'CONTCAR'} not found at ${taskDir(info)}` });
                return;
              }
              const includeConnectivity = query.include_connectivity !== 'false';
              const bondAlgorithm = query.bond_algorithm ?? 'minimum-distance';
              json(res, 200, getStructureScene(filePath, { includeConnectivity, bondAlgorithm }));
              return;
            }
            case 'files': {
              json(res, 200, listFilesAndDirs(taskDir(info)));
              return;
            }
            case 'structure-files': {
              json(res, 200, { files: listStructureFiles(taskDir(info)) });
              return;
            }
            case 'file-content': {
              try {
                json(res, 200, readTextPreview(info, query.name ?? '', { offset: query.offset, length: query.length }));
              } catch (error) {
                json(res, error.statusCode ?? 500, { error: error.message });
              }
              return;
            }
            default:
              json(res, 404, { error: `unknown task action: ${action}` });
          }
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: task routes');
  };
  registerWebSurface();
  ctx.on('internal/service', (serviceName) => {
    if (WEB_SERVER_KEYS.includes(serviceName)) {
      registerWebSurface();
    }
  });
  ctx.logger.info('dsh-vaspflow: host half active (phase 1 data service)');
}

// Local path helper.
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
