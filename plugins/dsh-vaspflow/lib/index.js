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
 *   GET  /plugins/dsh-vaspflow/ping                       → {ok:true}
 *
 * Agent tools (port plan §4.4), registered on ctx.tools:
 *   vasp_scan / vasp_convergence / vasp_structure_scene / vasp_task_files / vasp_read_file
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
import { checkInputs } from './host/input-checker.js';
import { srcInspect } from './host/src-inspect.js';
import { scanTemplates } from './host/scan-templates.js';

export const name = 'dsh-vaspflow';
export const inject = ['tools'];

export const Config = z.object({
  defaultScanRoot: z.string().default(''),
});

const WEB_SERVER_KEYS = ['webServer', 'httpServer'];

/** Session workspace cwd for a tool call (same contract as dsh-tool-fs.sessionCwd). */
function workspaceOf(exec) {
  return exec?.agent?.session?.header?.cwd || process.cwd();
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
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

export function apply(ctx, config) {
  const store = new TaskStore();

  // ---- agent tools ----------------------------------------------------------

  ctx.tools.register(defineTool({
    name: 'vasp_scan',
    description: '扫描一个 VASP 项目目录树，返回所有被识别为 VASP 任务（含 OUTCAR 或 vasprun.xml）的目录元数据与目录清单。面板与 agent 共用同一数据层。',
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
                final_energy: { type: 'number' },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `扫描完成：${value.tasks.length} 个 VASP 任务，${value.directories.length} 个目录（project_id=${value.project_id}）`,
      }],
    },
    async execute(args) {
      const scanResult = await scanProject(args.rootPath);
      const projectId = store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
      return { project_id: projectId, tasks: scanResult.tasks, directories: scanResult.directories };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Scan VASP project', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_convergence',
    description: '读取一个已扫描 VASP 任务的收敛数据（每个离子步的能量与最大力）。返回 {ion_steps, energies, max_forces}。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id（来自 vasp_scan 的 tasks[].id）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ion_steps: { type: 'array', items: { type: 'number' } },
          energies: { type: 'array', items: { type: 'number' } },
          max_forces: { type: 'array', items: { type: 'number' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `收敛数据不可用: ${value.error}`
          : `收敛数据：${value.ion_steps.length} 个离子步，最终能量 ${value.energies.at(-1)?.toFixed(6)} eV`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) {
        return { ion_steps: [], energies: [], max_forces: [], error: `Task ${args.taskId} not found` };
      }
      return parseConvergence(taskDir(info));
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP convergence', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_structure_scene',
    description: '读取一个已扫描 VASP 任务的 3D 结构场景 JSON（晶胞、原子、键、键族、摘要）。file 可选（默认 CONTCAR）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.summary
          ? `结构：${value.summary.formula}，${value.summary.atom_count} 原子，${value.atoms.length} 个原子位点，${value.bonds.length} 条键`
          : JSON.stringify(value),
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { error: `Task ${args.taskId} not found` };
      const filePath = resolveTaskFile(info, args.file ?? 'CONTCAR');
      if (!filePath) return { error: `File ${args.file ?? 'CONTCAR'} not found at ${taskDir(info)}` };
      return getStructureScene(filePath, { includeConnectivity: true, bondAlgorithm: 'minimum-distance' });
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP structure scene', kind: 'other', rawInput: args }),
  }));

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
      return listFilesAndDirs(taskDir(info));
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP task files', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_read_file',
    description: '读取已扫描 VASP 任务目录内的一个文本文件（截断到 500KB，返回 truncated 标志）。',
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
          content: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `文件 ${value.name}（${value.size} 字节${value.truncated ? '，已截断' : ''}）：\n${value.content}`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { name: args.name, size: 0, content: '', truncated: false, error: `Task ${args.taskId} not found` };
      return readTextPreview(info, args.name);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Read VASP file', kind: 'other', rawInput: args }),
  }));


  ctx.tools.register(defineTool({
    name: 'vasp_build_inputs',
    description: '批量创建 VASP 结构优化输入文件：建目录、复制 INCAR/KPOINTS/POTCAR/POSCAR/提交脚本、按 freeAtoms 或 fixedAtoms 显式规则写 Selective dynamics（绝不按元素序推断）、INCAR 参数覆盖（缺失 tag 会追加）、POTCAR-POSCAR 等长同序校验。提交脚本必须显式给出 submitSrc（不做自动探测；缺失时应向用户询问）。dryRun=true 时仅预览不写盘。',
    parameters: {
      projectRoot: { type: 'string', description: '项目根目录：任务 dir 与相对源路径的基准；缺省用当前会话工作空间。' },
      tasks: {
        type: 'array', required: true, description: '构建任务列表。',
        items: {
          type: 'object', additionalProperties: true,
          properties: {
            dir: { type: 'string' },
            poscarSrc: { type: 'string', description: '可选：POSCAR 源；未提供时跳过 SD/POTCAR 校验（分段构建）' },
            template: { type: 'string' },
            incarSrc: { type: 'string' },
            kpointsSrc: { type: 'string' },
            potcarSrc: { type: 'string' },
            submitSrc: { type: 'string', description: '可选：提交脚本（不自动探测；缺失仅警告，稍后补充）' },
            incarOverrides: { type: 'object', additionalProperties: true },
            sources: { type: 'object', additionalProperties: true, properties: {
              poscar: { type: 'string' }, incar: { type: 'string' }, kpoints: { type: 'string' },
              potcar: { type: 'string' }, submit: { type: 'string' },
            } },
            freeAtoms: { type: 'array', items: { type: 'number' } },
            fixedAtoms: { type: 'array', items: { type: 'number' } },
            sdPolicy: { type: 'string', enum: ['override', 'keep'], description: "SD 策略：'override'（默认）= 必须显式 freeAtoms/fixedAtoms；'keep' = 沿用源文件旗标，源无旗标时任务报错或警告" },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.map((r) => {
          const prefix = value.dryRun ? '[dry-run] ' : '';
          const line = prefix + '[' + r.status + '] ' + r.dir + ' | SD: ' + r.sd + ' | POTCAR: ' + r.potcar;
          const notes = (r.sdNotes && r.sdNotes.length > 0) ? ' | ' + r.sdNotes.join(' | ') : '';
          return (r.errors.length > 0 ? line + ' | ERRORS: ' + r.errors.join('; ') : line) + notes;
        }).join('\n') + '\n' + (value.dryRun
          ? 'DRY-RUN MODE - 未写入任何文件（' + value.count + ' 个任务，written=false）'
          : '落盘: written=' + value.written + '，wroteCount=' + value.wroteCount + '/' + value.count + '；' + value.okCount + ' ok, ' + value.warnCount + ' warn, ' + value.errorCount + ' error'),
      }],
    },
    async execute(args, exec) {
      return buildInputs(args.projectRoot ?? workspaceOf(exec), args.tasks ?? [], { dryRun: !!args.dryRun, linkPotcar: !!args.linkPotcar });
    },
    presentCall: (args) => ({ card: 'generic', title: 'Build VASP inputs', kind: 'other', rawInput: args }),
  }));
  ctx.tools.register(defineTool({
    name: 'vasp_check_inputs',
    description: '校验一批已构建的 VASP 任务目录：POSCAR-POTCAR 物种匹配（等长同序）、Selective dynamics 的 F/T 旗标（无旗标坐标报 FLAG_MISSING）、关键 INCAR 参数、KPOINTS 网格。每个目录独立检查，单个目录异常不中断其余。',
    parameters: {
      dirs: { type: 'array', required: true, items: { type: 'string' }, description: '待校验的目录路径（相对 projectRoot 或绝对）。' },
      projectRoot: { type: 'string', description: '项目根目录：dirs 里相对路径的解析基准（与 vasp_build_inputs 一致）；缺省用当前会话工作空间。' },
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
                warnings: { type: 'array', items: { type: 'string' } },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.map((r) => {
          const inc = typeof r.incar === 'object' && r.incar ? Object.entries(r.incar).slice(0, 8).map(([k, v]) => k + '=' + v).join('; ') : (r.incar || '-');
          const warn = (r.warnings && r.warnings.length > 0) ? ' | 警告: ' + r.warnings.join('; ') : '';
          return (r.error ? '[CRASH] ' : '[ok] ') + r.dir + ' -> ' + r.resolved + ' | POTCAR-POSCAR: ' + r.poscarPotcar + ' | SD: ' + r.sd + ' | ' + inc + ' | ' + r.kpoints + (r.error ? ' | ' + r.error : '') + warn;
        }).join('\n'),
      }],
    },
    execute(args, exec) {
      return checkInputs(args.dirs ?? [], { projectRoot: args.projectRoot ?? workspaceOf(exec) });
    },
    presentCall: (args) => ({ card: 'generic', title: 'Check VASP inputs', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_src_inspect',
    description: '结构源文件盘点（构建前体检）：扫描目录内 *.vasp/POSCAR/CONTCAR，解析物种/数量/坐标类型/SD 旗标统计/坐标行数/尾部垃圾行，并跨文件比对一致性（物种序 + SD F/T 分布 + 坐标类型）。在 vasp_build_inputs 之前调用，用于发现源文件间的模型/旗标不一致。',
    parameters: {
      rootPath: { type: 'string', description: '要扫描的根目录；缺省用当前会话工作空间。' },
      maxDepth: { type: 'number', description: '递归深度上限（默认 10）。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          files: {
            type: 'array', items: {
              type: 'object', additionalProperties: true, properties: {
                path: { type: 'string' }, relPath: { type: 'string' },
                elements: { type: 'array', items: { type: 'string' } },
                counts: { type: 'array', items: { type: 'number' } },
                nAtoms: { type: 'number' }, coordType: { type: 'string' }, hasSd: { type: 'boolean' },
                fFlags: { type: 'number' }, tFlags: { type: 'number' },
                nCoord: { type: 'number' }, trailingLines: { type: 'number' }, error: { type: 'string' },
              },
            },
          },
          count: { type: 'number' },
          consistency: {
            type: 'object', additionalProperties: true, properties: {
              uniform: { type: 'boolean' },
              groups: {
                type: 'array', items: {
                  type: 'object', additionalProperties: true, properties: {
                    pattern: { type: 'string' }, count: { type: 'number' },
                    files: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              note: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count + ' 个结构文件，一致性: ' + value.consistency.note + '\n' + value.files.map((f) => {
          const flags = f.hasSd ? (' SD ' + f.fFlags + 'F/' + f.tFlags + 'T') : ' 无SD';
          const junk = f.trailingLines > 0 ? (' 尾行+' + f.trailingLines) : '';
          return (f.error ? '[ERR] ' : '[ok] ') + f.relPath + ' | ' + f.elements.join('') + ' ' + f.nAtoms + '原子' + flags + junk + (f.error ? ' | ' + f.error : '');
        }).join('\n'),
      }],
    },
    execute(args, exec) {
      return srcInspect(args.rootPath ?? workspaceOf(exec), args.maxDepth ?? 10);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Inspect VASP sources', kind: 'other', rawInput: args }),
  }));
  ctx.tools.register(defineTool({
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
      return scanTemplates(args.rootPath ?? workspaceOf(exec), args.maxDepth ?? 3);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Scan VASP templates', kind: 'other', rawInput: args }),
  }));
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
        json(res, 200, { ok: true, plugin: 'dsh-vaspflow', version: 3 });
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
                json(res, 200, readTextPreview(info, query.name ?? ''));
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

// Local path helpers (kept tiny to avoid a second import cycle).
import { join as joinPath, basename } from 'node:path';
import { statSync } from 'node:fs';
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
