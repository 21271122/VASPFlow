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

export const name = 'dsh-vaspflow';
export const inject = [];

export const Config = z.object({
  defaultScanRoot: z.string().default(''),
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

function previewCursor(offset, length) {
  return Buffer.from(JSON.stringify({ offset, length })).toString('base64url');
}

function parsePreviewCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return Number.isSafeInteger(value?.offset) && Number.isSafeInteger(value?.length) ? value : null;
  } catch {
    return null;
  }
}

function taskPreview(info, file) {
  if (!file?.name) return null;
  const bytes = Math.min(512 * 1024, Math.max(1, Number(file.bytes) || 256 * 1024));
  const part = file.part ?? 'tail';
  const cursor = part === 'previous' ? parsePreviewCursor(file.cursor) : null;
  if (part === 'previous' && !cursor) throw new Error('读取上一段需要使用上次返回的 cursor');
  const options = { length: bytes };
  if (part === 'head') options.offset = 0;
  if (cursor) options.offset = Math.max(0, cursor.offset - bytes);
  const preview = readTextPreview(info, file.name, options);
  return {
    name: preview.name,
    size: preview.totalSize,
    content: preview.content,
    truncated: preview.truncated,
    hasBefore: preview.hasBefore,
    hasAfter: preview.hasAfter,
    cursor: previewCursor(preview.offset, preview.length),
    previousCursor: preview.hasBefore ? previewCursor(preview.offset, preview.length) : '',
  };
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

function renderTaskInspection(args, value) {
  if (value.error) return [{ type: 'text', text: `任务核查失败：${value.error}` }];
  const includes = new Set(args?.include?.length ? args.include : ['status', 'files']);
  const status = value.status ?? {};
  const taskType = value.task_type ?? {};
  const inputCheck = value.input_check ?? {};
  const lines = [
    `任务：${value.rel_path}`,
    `状态：${status.label ?? status.code ?? '未知'}${status.reason ? `（${status.reason}）` : ''}`,
    `任务类型：${taskType.label ?? taskType.code ?? '未知'}`,
    `输入检查：${inputCheck.label ?? inputCheck.code ?? '未检查'}`,
    `状态证据：\n${renderEvidence(status.evidence)}`,
    `输出文件：${renderFileList(value.output_files)}`,
  ];
  if (inputCheck.evidence?.length) lines.push(`输入检查证据：\n${renderEvidence(inputCheck.evidence)}`);
  if (includes.has('files')) {
    lines.push(`目录文件（${value.files?.length ?? 0}）：${renderFileList(value.files)}`);
    lines.push(`子目录（${value.dirs?.length ?? 0}）：${Array.isArray(value.dirs) && value.dirs.length > 0 ? value.dirs.map((dir) => dir.name).join(', ') : '无'}`);
  }
  if (includes.has('preview')) {
    const preview = value.preview;
    lines.push(preview
      ? `文件预览：${preview.name}（${preview.size} B${preview.truncated ? '，片段' : ''}）\n${clipRenderText(preview.content, 12_000)}${preview.truncated ? `\n续读 cursor：${preview.cursor}；前段可用：${preview.hasBefore ? '是' : '否'}；后段可用：${preview.hasAfter ? '是' : '否'}` : ''}`
      : '文件预览：未返回（请提供 file.name）');
  }
  if (value.recommended_actions?.length) lines.push(`建议：${value.recommended_actions.join('；')}`);
  return [{ type: 'text', text: clipRenderText(lines.join('\n\n')) }];
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
    `扫描完成：${value.tasks?.length ?? 0} 个 VASP 任务，${value.directories?.length ?? 0} 个目录（project_id=${value.project_id}）`,
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
export function registerVaspTools(ctx, store) {

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
    },
    async execute(args) {
      const error = directoryError(args.rootPath);
      if (error) return { project_id: 0, tasks: [], directories: [], error };
      try {
        const scanResult = await scanProject(args.rootPath);
        const projectId = store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
        return { project_id: projectId, tasks: scanResult.tasks, directories: scanResult.directories, error: '' };
      } catch (caught) {
        return { project_id: 0, tasks: [], directories: [], error: `Scan failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Scan VASP project', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_inspect_task',
    description: '按稳定的 rootPath + relPath 核查一个 VASP 任务。一次返回状态、输入检查、输出证据和目录文件清单；可选预览一个文件。文件预览的 cursor 是不透明续读标记，不需要也不应计算字节偏移。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      relPath: { type: 'string', required: true, description: '任务相对项目根目录的路径。' },
      include: { type: 'array', items: { type: 'string', enum: ['status', 'files', 'preview'] }, description: '需要的部分；默认返回状态和文件清单。' },
      file: { type: 'object', additionalProperties: false, description: '仅 include 包含 preview 时使用。', properties: {
        name: { type: 'string' },
        part: { type: 'string', enum: ['head', 'tail', 'previous'] },
        bytes: { type: 'number' },
        cursor: { type: 'string' },
      } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          root_path: { type: 'string' }, rel_path: { type: 'string' },
          task_type: { type: 'object', additionalProperties: true },
          status: { type: 'object', additionalProperties: true },
          input_check: { type: 'object', additionalProperties: true },
          output_files: { type: 'array', items: { type: 'object', additionalProperties: true } },
          recommended_actions: { type: 'array', items: { type: 'string' } },
          files: { type: 'array', items: { type: 'object', additionalProperties: true } },
          dirs: { type: 'array', items: { type: 'object', additionalProperties: true } },
          preview: { type: 'json' },
          error: { type: 'string', required: true },
        },
      },
      render: (args, value) => renderTaskInspection(args, value),
    },
    async execute(args) {
      const error = directoryError(args.rootPath);
      if (error) return { root_path: args.rootPath, rel_path: args.relPath, files: [], dirs: [], preview: null, error };
      try {
        const scanResult = await scanProject(args.rootPath);
        store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
        const normalized = normalizeRelPath(args.relPath);
        const task = scanResult.tasks.find((candidate) => normalizeRelPath(candidate.rel_path) === normalized);
        if (!task) return { root_path: args.rootPath, rel_path: args.relPath, files: [], dirs: [], preview: null, error: '目录不是已识别的 VASP 任务：需要四个标准输入文件，或符合 NEB 父目录结构' };
        const includes = new Set(args.include?.length ? args.include : ['status', 'files']);
        const info = store.getTask(task.id) ?? { ...task, root_path: args.rootPath };
        const entries = includes.has('files') ? listFilesAndDirs(taskDir(info)) : { files: [], dirs: [] };
        return {
          root_path: args.rootPath,
          rel_path: task.rel_path,
          task_type: task.task_type,
          status: task.status_record,
          input_check: task.input_check,
          output_files: task.output_files,
          recommended_actions: statusActions(task.status_record.code),
          files: entries.files,
          dirs: entries.dirs,
          preview: includes.has('preview') ? taskPreview(info, args.file) : null,
          error: '',
        };
      } catch (caught) {
        return { root_path: args.rootPath, rel_path: args.relPath, files: [], dirs: [], preview: null, error: `Task inspection failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Inspect VASP task', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_convergence',
    description: '按 rootPath + relPath 读取一个 VASP 任务的收敛数据（每个离子步的能量与最大力）。不依赖临时 taskId。返回 {ion_steps, energies, max_forces}。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      relPath: { type: 'string', required: true, description: '任务相对项目根目录的路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ion_steps: { type: 'array', items: { type: 'number' } },
          energies: { type: 'array', items: { type: 'number' } },
          max_forces: { type: 'array', items: { type: 'number' } },
          root_path: { type: 'string' },
          rel_path: { type: 'string' },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `收敛数据不可用：${value.error}`
          : clipRenderText([
            `任务：${value.rel_path}`,
            `收敛数据：${value.ion_steps.length} 个离子步，最终能量 ${value.energies.at(-1)?.toFixed(6) ?? '未知'} eV`,
            `离子步：${renderJson(renderSeries(value.ion_steps))}`,
            `能量：${renderJson(renderSeries(value.energies))}`,
            `最大力：${renderJson(renderSeries(value.max_forces))}`,
          ].join('\n')),
      }],
    },
    async execute(args) {
      const info = taskAtPath(args.rootPath, args.relPath);
      if (!info) {
        return { ion_steps: [], energies: [], max_forces: [], root_path: args.rootPath, rel_path: args.relPath, error: `VASP task not found at ${args.rootPath}\\${args.relPath}` };
      }
      try {
        const { _source, ...result } = await parseConvergence(taskDir(info));
        return { ...result, root_path: args.rootPath, rel_path: info.rel_path, error: result.error ?? '' };
      } catch (caught) {
        return { ion_steps: [], energies: [], max_forces: [], root_path: args.rootPath, rel_path: args.relPath, error: `Convergence parse failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP convergence', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_structure_scene',
    description: '按 rootPath + relPath 读取一个 VASP 任务的 3D 结构场景 JSON（晶胞、原子、键、键族、摘要）。不依赖临时 taskId；file 可选（默认 CONTCAR）。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '项目根目录绝对路径。' },
      relPath: { type: 'string', required: true, description: '任务相对项目根目录的路径。' },
      file: { type: 'string', description: '结构文件名，默认 CONTCAR。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'number' },
          cell: { type: 'object', additionalProperties: true },
          atoms: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                site_index: { type: 'number' },
                element: { type: 'string' },
                position: { type: 'array', items: { type: 'number' } },
                is_periodic_image: { type: 'boolean' },
              },
            },
          },
          bonds: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                family_key: { type: 'string' },
                start_atom_index: { type: 'number' },
                end_atom_index: { type: 'number' },
                length: { type: 'number' },
              },
            },
          },
          bond_families: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                key: { type: 'string' },
                elements: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          summary: { type: 'object', additionalProperties: true },
          warnings: { type: 'array', items: { type: 'string' } },
          root_path: { type: 'string' },
          rel_path: { type: 'string' },
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `结构读取失败：${value.error}`
          : clipRenderText([
            `结构：${value.summary?.formula ?? '未知'}，${value.summary?.atom_count ?? value.atoms?.length ?? 0} 原子，${value.atoms?.length ?? 0} 个原子位点，${value.bonds?.length ?? 0} 条键`,
            `结构摘要：${renderJson(value.summary ?? {})}`,
            `晶胞与原子场景：${renderJson({ version: value.version, cell: value.cell, atoms: value.atoms, bonds: value.bonds, bond_families: value.bond_families, warnings: value.warnings })}`,
          ].join('\n')),
      }],
    },
    async execute(args) {
      const info = taskAtPath(args.rootPath, args.relPath);
      if (!info) return { root_path: args.rootPath, rel_path: args.relPath, error: `VASP task not found at ${args.rootPath}\\${args.relPath}` };
      const filePath = resolveTaskFile(info, args.file ?? 'CONTCAR');
      if (!filePath) return { root_path: args.rootPath, rel_path: info.rel_path, error: `File ${args.file ?? 'CONTCAR'} not found at ${taskDir(info)}` };
      try {
        return { ...getStructureScene(filePath, { includeConnectivity: true, bondAlgorithm: 'minimum-distance' }), root_path: args.rootPath, rel_path: info.rel_path, error: '' };
      } catch (caught) {
        return { root_path: args.rootPath, rel_path: info.rel_path, error: `Structure parse failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP structure scene', kind: 'other', rawInput: args }),
  }));

  // The two legacy taskId file tools remain here only as a short-lived source
  // compatibility adapter. New VASP Agent sessions use vasp_inspect_task.
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
    description: '批量创建 VASP 结构优化输入文件：建目录、复制 INCAR/KPOINTS/POTCAR/POSCAR/提交脚本、按 freeAtoms 或 fixedAtoms 显式规则写 Selective dynamics（绝不按元素序推断）、INCAR 参数覆盖（缺失 tag 会追加）、POTCAR-POSCAR 等长同序校验。提交脚本必须显式给出 submitSrc（不做自动探测；缺失时应向用户询问）。dryRun=true 时仅预览不写盘。',
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
      dryRun: { type: 'boolean', description: '仅预览不写盘（默认 false）。' },
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
          error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: clipRenderText(value.error ? `输入构建失败：${value.error}` : value.results.map((r) => {
          const prefix = value.dryRun ? '[dry-run] ' : '';
          const line = prefix + '[' + r.status + '] ' + r.dir + ' | SD: ' + r.sd + ' | POTCAR: ' + r.potcar;
          const notes = (r.sdNotes && r.sdNotes.length > 0) ? ' | ' + r.sdNotes.join(' | ') : '';
          const sources = r.sources && Object.keys(r.sources).length > 0
            ? ' | 来源: ' + Object.entries(r.sources).map(([dest, src]) => `${dest}←${src}`).join(', ')
            : '';
          const warnings = r.warnings?.length > 0 ? ' | WARNINGS: ' + r.warnings.join('; ') : '';
          return (r.errors.length > 0 ? line + ' | ERRORS: ' + r.errors.join('; ') : line) + notes + sources + warnings;
        }).join('\n') + '\n' + (value.dryRun
          ? 'DRY-RUN MODE - 未写入任何文件（' + value.count + ' 个任务，written=false）'
          : '落盘: written=' + value.written + '，wroteCount=' + value.wroteCount + '/' + value.count + '；' + value.okCount + ' ok, ' + value.warnCount + ' warn, ' + value.errorCount + ' error')),
      }],
    },
    async execute(args, exec) {
      try {
        const result = await buildInputs(args.projectRoot ?? workspaceOf(exec), args.tasks ?? [], { dryRun: !!args.dryRun, linkPotcar: !!args.linkPotcar });
        return { ...result, error: '' };
      } catch (caught) {
        return { results: [], okCount: 0, warnCount: 0, errorCount: 0, dryRun: !!args.dryRun, count: 0, wroteCount: 0, written: false, error: `Build inputs failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Build VASP inputs', kind: 'other', rawInput: args }),
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
    },
    execute(args, exec) {
      try {
        const projectRoot = args.projectRoot ?? workspaceOf(exec);
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
        return { ...result, results: rows, linked_count: linkedCount, unlinked_dirs: unlinkedDirs, error: '' };
      } catch (caught) {
        return { results: [], consistency: { uniform: true, groups: [], note: '' }, linked_count: 0, unlinked_dirs: [], error: `Check inputs failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Check VASP inputs', kind: 'other', rawInput: args }),
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
            `结构源：${value.sources.count} 个；一致性：${value.sources.consistency.note}`,
            `结构源明细：${renderJson(value.sources.files ?? [])}`,
            `候选模板：${value.templates.length} 个`,
            `模板明细：${renderJson(value.templates)}`,
          ].join('\n')),
      }],
    },
    execute(args, exec) {
      const rootPath = args.rootPath ?? workspaceOf(exec);
      const error = directoryError(rootPath);
      if (error) return { sources: { files: [], count: 0, consistency: { uniform: true, groups: [], note: '' } }, templates: [], error };
      try {
        const include = new Set(args.include?.length ? args.include : ['sources', 'templates']);
        const sources = include.has('sources')
          ? srcInspect(rootPath, args.maxDepth ?? 10)
          : { files: [], count: 0, consistency: { uniform: true, groups: [], note: '未请求结构源盘点' } };
        const templates = include.has('templates') ? scanTemplates(rootPath, args.maxDepth ?? 10).templates : [];
        return { sources, templates, error: '' };
      } catch (caught) {
        return { sources: { files: [], count: 0, consistency: { uniform: true, groups: [], note: '' } }, templates: [], error: `Input discovery failed: ${String(caught)}` };
      }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Discover VASP inputs', kind: 'other', rawInput: args }),
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

  // This service is consumed only by preset/vasp/tools/vaspflow-tools.mjs.
  // Its tool definitions close over this store, preserving panel/Agent state.
  ctx.provide('vaspflowTools', {
    register(toolCtx) {
      registerVaspTools(toolCtx, store);
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
