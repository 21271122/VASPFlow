import React from 'react';
import { openTaskByPath } from './api';
import { panelStore } from './store';

const titles: Record<string, string> = {
  vasp_scan: '扫描项目',
  vasp_inspect_task: '核查任务',
  vasp_convergence: '收敛数据',
  vasp_structure_scene: '结构场景',
  vasp_discover_inputs: '发现输入来源',
  vasp_check_inputs: '检查输入文件',
};

function argsOf(block: any): any {
  const raw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw;
  try { return typeof raw === 'string' ? JSON.parse(raw) : {}; } catch { return {}; }
}

function valueOf(block: any): any {
  return block?.result?.meta ?? block?.resultView?.meta ?? block?.result?.value ?? block?.meta ?? {};
}

async function openTask(rootPath: string, relPath: string, tab: 'status' | 'chart' | 'structure' | 'files') {
  if (!rootPath || !relPath) return;
  const snapshot = panelStore.getSnapshot();
  let task = snapshot.projectPath === rootPath ? snapshot.tasks.find((item) => item.rel_path === relPath) : undefined;
  if (!task) {
    try { task = await openTaskByPath(rootPath, relPath); } catch { return; }
  }
  panelStore.setProjectPath(rootPath);
  if (snapshot.projectPath !== rootPath) panelStore.setTasks([task]);
  else if (!snapshot.tasks.some((item) => item.id === task.id)) panelStore.setTasks([...snapshot.tasks, task]);
  panelStore.setSelectedTask(task);
  panelStore.setViewTab(tab);
  panelStore.setOpen(true);
}

function IssueRows({ rows, rootPath, tab = 'status' }: { rows: Array<{ path: string; label: string; note?: string; status?: string }>; rootPath: string; tab?: 'status' | 'chart' | 'structure' | 'files' }) {
  return <div className="vfp-result-rows">{rows.map((row, index) => <button type="button" key={`${row.path}-${index}`} className="vfp-result-row" disabled={!row.path || !rootPath} onClick={() => { void openTask(rootPath, row.path, tab); }}>
    <span>{row.label}</span><span className="vfp-tree-muted">{row.note}</span><span className="vfp-tree-status" data-status={row.status}>{row.status === 'error' ? '错误' : row.status === 'warn' ? '注意' : row.path ? '查看' : ''}</span>
  </button>)}</div>;
}

export function VaspToolRow({ block, toolName }: { block: any; toolName: string }) {
  const args = argsOf(block);
  const settled = block?.kind === 'tool-result';
  const value = valueOf(block);
  const toolError = block?.result?.isError ? block.result.content?.find((item: any) => item.type === 'text')?.text ?? '工具执行失败' : '';
  if (toolName === 'vasp_say') {
    if (!settled) return <div data-dsh-vaspflow-tool="vasp_say" className="vfp-tree-muted">正在准备回复…</div>;
    if (toolError) return <div data-dsh-vaspflow-tool="vasp_say" className="vfp-result-summary" data-error="">{toolError}</div>;
    return <div data-dsh-vaspflow-tool="vasp_say" className="vfp-say" data-kind={args.kind}>{args.text}</div>;
  }
  if (toolName === 'vasp_done') return toolError
    ? <div data-dsh-vaspflow-tool="vasp_done" className="vfp-result-summary" data-error="">{toolError}</div>
    : <span data-dsh-vaspflow-tool="vasp_done" data-complete="" hidden />;

  const rootPath = value.rootPath ?? args.rootPath ?? value.projectRoot ?? args.projectRoot ?? panelStore.getSnapshot().projectPath;
  const relPath = value.relPath ?? value.rel_path ?? args.relPath ?? '';
  let summary = '';
  let rows: Array<{ path: string; label: string; note?: string; status?: string }> = [];
  let tab: 'status' | 'chart' | 'structure' | 'files' = 'status';
  if (toolName === 'vasp_scan') {
    const tasks = Array.isArray(value.tasks) ? value.tasks : [];
    const running = tasks.filter((task: any) => task.status_record?.code === 'RUNNING');
    const abnormal = tasks.filter((task: any) => ['ERROR_DETECTED', 'UNKNOWN'].includes(task.status_record?.code));
    summary = `${tasks.length} 个任务 · ${running.length} 个运行中 · ${abnormal.length} 个异常或状态未知`;
    rows = [...abnormal, ...running].slice(0, 12).map((task: any) => ({ path: task.rel_path, label: task.label || task.rel_path, note: task.status_record?.reason, status: task.status_record?.code === 'ERROR_DETECTED' ? 'error' : 'warn' }));
  } else if (toolName === 'vasp_inspect_task') {
    summary = [value.status?.label ?? value.status?.code, value.inputCheck?.label, value.status?.reason].filter(Boolean).join(' · ');
    rows = relPath ? [{ path: relPath, label: relPath, note: '在右侧查看证据' }] : [];
  } else if (toolName === 'vasp_convergence') {
    summary = `${value.ionSteps ?? 0} 个离子步${Number.isFinite(value.finalEnergy) ? ` · 末步能量 ${Number(value.finalEnergy).toFixed(6)} eV` : ''}`;
    rows = relPath ? [{ path: relPath, label: relPath, note: '在右侧查看曲线' }] : [];
    tab = 'chart';
  } else if (toolName === 'vasp_structure_scene') {
    summary = `${value.summary?.formula ?? args.file ?? '结构'} · ${value.summary?.atom_count ?? 0} 个原子${value.warnings?.length ? ` · ${value.warnings.length} 项注意` : ''}`;
    rows = relPath ? [{ path: relPath, label: relPath, note: '在右侧查看结构' }] : [];
    tab = 'structure';
  } else if (toolName === 'vasp_discover_inputs') {
    const sources = value.sources?.files ?? [];
    const templates = value.templates ?? [];
    summary = `${value.sources?.count ?? sources.length} 个结构源 · ${templates.length} 个候选模板${value.sources?.consistency?.uniform === false ? ' · 来源不一致' : ''}`;
    rows = [...sources.slice(0, 8).map((source: any) => ({ path: '', label: source.relPath ?? source.path ?? '结构源', note: source.error || `${source.elements?.join(', ') ?? ''} · ${source.nAtoms ?? 0} 原子${source.hasSd ? ' · 含 SD' : ''}`, status: source.error ? 'error' : undefined })), ...templates.slice(0, 8).map((template: any) => ({ path: '', label: template.relPath ?? template.dir ?? '模板', note: template.complete === false ? '缺少文件' : `${template.files?.length ?? 0} 个文件`, status: template.complete === false ? 'warn' : undefined }))];
  } else if (toolName === 'vasp_check_inputs') {
    const results = Array.isArray(value.results) ? value.results : [];
    const errors = results.filter((row: any) => row.error || row.input_check?.code === 'FAIL');
    const warns = results.filter((row: any) => !errors.includes(row) && (row.warnings?.length || row.input_check?.code === 'WARN'));
    const passed = results.filter((row: any) => row.input_check?.code === 'PASS' && !errors.includes(row) && !warns.includes(row));
    const unchecked = results.filter((row: any) => !errors.includes(row) && !warns.includes(row) && !passed.includes(row));
    summary = `${passed.length} 个通过 · ${warns.length} 个注意 · ${errors.length} 个失败${unchecked.length ? ` · ${unchecked.length} 个未按规则检查` : ''}${value.consistency?.uniform === false ? ' · 批次设置不一致' : ''}`;
    rows = [...errors, ...warns, ...unchecked].slice(0, 12).map((row: any) => ({ path: row.dir, label: row.dir, note: row.error || row.input_check?.evidence?.[0]?.message || row.warnings?.[0] || row.input_check?.label, status: row.error || row.input_check?.code === 'FAIL' ? 'error' : 'warn' }));
  }
  const error = toolError || value.error || block?.result?.error;
  return <div data-dsh-vaspflow-tool={toolName}>
    <div className="vfp-tree-head"><strong>{titles[toolName]}</strong><span className="vfp-tree-muted">{settled ? error ? '失败' : '完成' : '处理中'}</span></div>
    {settled && <><div className="vfp-result-summary" data-error={error ? '' : undefined}>{error || summary || '无结果'}</div>{rows.length > 0 && <IssueRows rows={rows} rootPath={rootPath} tab={tab} />}</>}
  </div>;
}
