import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, Spin } from 'antd';
import { fetchConvergence, fetchFileContent, fetchStructureFiles, fetchStructureScene, openTaskByPath } from './api';
import type { StructureScene } from './api';
import { panelStore } from './store';
import ConvergenceChart from './ConvergenceChart';
import StructureViewer from './StructureViewer';
import { readStructureDrag, STRUCTURE_DRAG_TYPE } from './structure-drag';
import { scrollExpandedTreeRow } from './tree-scroll';

const titles: Record<string, string> = {
  vasp_scan: '扫描计算目录',
  vasp_inspect_task: '查看计算状态',
  vasp_inspect_tasks: '查看计算状态',
  vasp_convergence: '查看收敛曲线',
  vasp_structure_scene: '查看原子结构',
  vasp_discover_inputs: '寻找构建材料',
  vasp_check_inputs: '校验 VASP 输入',
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
  return <div className="vfp-result-rows"><PathTree items={rows} pathOf={(row) => row.path || row.label} renderLeaf={(row, name) => <button type="button" className="vfp-result-row" title={row.path} disabled={!row.path || !rootPath} onClick={() => { void openTask(rootPath, row.path, tab); }}>
    <span>{name}</span><span className="vfp-tree-muted">{row.note}</span><span className="vfp-tree-status" data-status={row.status}>{row.status === 'error' ? '错误' : row.status === 'warn' ? '注意' : row.path ? '查看' : ''}</span>
  </button>} /></div>;
}

const scanStates = [
  ['TASK_COMPLETED', '已完成', '#279d69'],
  ['RUNNING', '运行中', '#55a6d9'],
  ['ERROR_DETECTED', '检测到错误', '#d55750'],
  ['NO_OUTPUT_EVIDENCE', '未见计算输出', '#d9aa52'],
  ['UNKNOWN', '状态未知', '#9a91a8'],
] as const;

const scanTypes = [
  ['RELAXATION', '结构优化', '#5795d1'],
  ['STATIC_SCF', '静态 / SCF', '#53b7a5'],
  ['NEB', 'NEB', '#a490d8'],
  ['FREQUENCY_ZPE', '频率 / ZPE', '#d9b36d'],
  ['AIMD', 'AIMD', '#6eafd1'],
  ['OTHER', '其他 / 未识别', '#8c9cae'],
] as const;

function PieBreakdown({ title, items }: { title: string; items: Array<{ label: string; color: string; count: number }> }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const slices = items.filter((item) => item.count > 0).map((item) => {
    const start = cursor;
    cursor += item.count / total * 100;
    return `${item.color} ${start}% ${cursor}%`;
  });
  return <section className="vfp-pie-section"><div className="vfp-pie-title">{title}</div><div className="vfp-pie-body">
    <div className="vfp-pie" role="img" aria-label={items.map((item) => `${item.label} ${item.count}`).join('，')} style={{ background: slices.length ? `conic-gradient(${slices.join(', ')})` : 'rgba(128,128,128,.14)' }} />
    <div className="vfp-pie-legend">{items.filter((item) => item.count > 0).map((item) => <div className="vfp-pie-legend-row" key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count}</strong><small>{(item.count / total * 100).toFixed(1)}%</small></div>)}{total === 0 && <span>无任务</span>}</div>
  </div></section>;
}

function relativePath(rootPath: string, filePath: string) {
  const root = rootPath.replace(/[\\/]+$/, '');
  const tail = filePath.slice(root.length);
  return filePath.slice(0, root.length).toLowerCase() === root.toLowerCase() && (tail === '' || /^[\\/]/.test(tail))
    ? tail.replace(/^[\\/]/, '') || '.' : filePath;
}

type PathNode<T> = { name: string; count: number; children: Map<string, PathNode<T>>; item?: T };

function PathTree<T>({ items, pathOf, renderLeaf }: { items: T[]; pathOf: (item: T) => string; renderLeaf: (item: T, name: string) => React.ReactNode }) {
  const [openPath, setOpenPath] = useState<string[]>([]);
  const [rootOpen, setRootOpen] = useState(true);
  const root: PathNode<T> = { name: '', count: 0, children: new Map() };
  for (const item of items) {
    const parts = pathOf(item).split(/[\\/]+/).filter(Boolean);
    if (!parts.length) parts.push('.');
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { name: part, count: 0, children: new Map() });
      node = node.children.get(part)!;
      node.count += 1;
    }
    node.item = item;
  }
  const renderNode = (node: PathNode<T>, parentPath: string[] = []): React.ReactNode => {
    const path = [...parentPath, node.name];
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!children.length) return node.item && <div className="vfp-path-leaf" key={node.name}>{renderLeaf(node.item, node.name)}</div>;
    const isOpen = path.every((part, index) => openPath[index] === part);
    return <details className="vfp-path-folder" key={node.name} open={isOpen}><summary title={node.name} onClick={(event) => { event.preventDefault(); setOpenPath(isOpen ? parentPath : path); if (!isOpen) scrollExpandedTreeRow(event.currentTarget); }}><span>{node.name}</span><small>{node.count}</small></summary><div className="vfp-path-children">
      {node.item && <div className="vfp-path-leaf">{renderLeaf(node.item, '本目录')}</div>}
      {children.map((child) => renderNode(child, path))}
    </div></details>;
  };
  return <div className="vfp-path-tree"><details className="vfp-path-root vfp-path-folder" open={rootOpen}>
    <summary onClick={(event) => { event.preventDefault(); if (rootOpen) setOpenPath([]); else scrollExpandedTreeRow(event.currentTarget); setRootOpen(!rootOpen); }}><span>根目录</span><small>{items.length}</small></summary>
    <div className="vfp-path-children">{[...root.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((node) => renderNode(node))}</div>
  </details></div>;
}

function SourcePreview({ rootPath, filePath, onClose }: { rootPath: string; filePath: string; onClose: () => void }) {
  const [taskId, setTaskId] = useState<number>();
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const rel = relativePath(rootPath, filePath);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  const name = parts.at(-1) ?? '';
  useEffect(() => {
    let cancelled = false;
    if (!rootPath || rel === filePath || !name) { setError('结构文件不在本次搜索目录内'); setLoading(false); return; }
    openTaskByPath(rootPath, parts.slice(0, -1).join('/') || '.')
      .then(async (task) => {
        const result = await fetchFileContent(task.id, name, { offset: 0 });
        if (!cancelled) { setTaskId(task.id); setData(result); }
      })
      .catch((caught) => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rootPath, filePath]);
  const page = async (offset: number) => {
    if (taskId === undefined) return;
    setLoading(true);
    try { setData(await fetchFileContent(taskId, name, { offset })); setError(''); }
    catch (caught) { setError(String(caught)); }
    finally { setLoading(false); }
  };
  return <Modal title={name} open onCancel={onClose} width={800} footer={data ? <div className="vfp-preview-footer"><span>{data.offset + 1}–{data.offset + data.length} / {data.totalSize} 字节</span><Button size="small" disabled={!data.hasBefore || loading} onClick={() => void page(Math.max(0, data.offset - data.length))}>上一段</Button><Button size="small" disabled={!data.hasAfter || loading} onClick={() => void page(data.offset + data.length)}>下一段</Button></div> : null}>
    <div className="vfp-source-location" title={filePath}>{filePath}</div>
    {loading ? <Spin style={{ display: 'block', margin: '36px auto' }} /> : error ? <div className="vfp-result-summary" data-error="">{error}</div> : <pre className="vaspflow-file-preview vfp-file-preview">{data?.content ?? ''}</pre>}
  </Modal>;
}

function ScanOverview({ value, rootPath }: { value: any; rootPath: string }) {
  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  const directories = Array.isArray(value.directories) ? value.directories : [];
  const total = tasks.length;
  const states = scanStates.map(([code, label, color]) => ({ label, color, count: tasks.filter((task: any) => code === 'UNKNOWN' ? !scanStates.some(([known]) => known !== 'UNKNOWN' && known === task.status_record?.code) : task.status_record?.code === code).length }));
  const types = scanTypes.map(([code, label, color]) => ({ label, color, count: tasks.filter((task: any) => code === 'OTHER' ? !scanTypes.some(([known]) => known !== 'OTHER' && known === task.task_type?.code) : task.task_type?.code === code).length }));
  return <div className="vfp-overview">
    <div className="vfp-scan-path">扫描目录：<code>{rootPath || '未知'}</code></div>
    <div className="vfp-scan-stats"><strong>{directories.length}</strong> 个子目录（含任务目录） · <strong>{total}</strong> 个 VASP 任务</div>
    <div className="vfp-pie-grid"><PieBreakdown title="计算状态" items={states} /><PieBreakdown title="任务类型" items={types} /></div>
    {tasks.length > 0 && <><div className="vfp-discovery-heading">任务目录 <span>{tasks.length} 个任务，点击查看详情</span></div><IssueRows rootPath={rootPath} rows={tasks.map((task: any) => ({ path: task.rel_path, label: task.label || task.rel_path, note: task.status_record?.label || task.task_type?.label, status: task.status_record?.code === 'ERROR_DETECTED' ? 'error' : task.status_record?.code === 'UNKNOWN' ? 'warn' : undefined }))} /></>}
  </div>;
}

type AddedStructure = { rootPath: string; rel_path: string; file: string; userAdded: true };
const droppedSceneCache = new Map<string, StructureScene>();

function structureKey(row: { rootPath: string; rel_path: string; file: string }): string {
  return `${row.rootPath}/${row.rel_path}/${row.file}`.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function droppedStorageKey(block: any, kind = 'structure'): string {
  const id = block?.call?.id ?? block?.call?.toolCallId ?? block?.id ?? block?.call?.argsRaw;
  return id ? `dsh-vaspflow:${kind}-drops:${String(id)}` : '';
}

function readDroppedRows(key: string): any[] {
  if (!key) return [];
  try {
    const rows = JSON.parse(sessionStorage.getItem(key) || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row?.userAdded === true && typeof row.rootPath === 'string' && typeof row.rel_path === 'string') : [];
  } catch { return []; }
}

function readDroppedStructures(key: string): AddedStructure[] {
  if (!key) return [];
  try {
    const rows = JSON.parse(sessionStorage.getItem(key) || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row?.userAdded === true && typeof row.rootPath === 'string' && typeof row.rel_path === 'string' && typeof row.file === 'string') : [];
  } catch { return []; }
}

function DroppedStructurePane({ row, active }: { row: AddedStructure; active: boolean }) {
  const key = structureKey(row);
  const [scene, setScene] = useState<StructureScene | undefined>(() => droppedSceneCache.get(key));
  const [error, setError] = useState('');
  useEffect(() => {
    const cached = droppedSceneCache.get(key);
    if (cached) { setScene(cached); return; }
    let cancelled = false;
    openTaskByPath(row.rootPath, row.rel_path)
      .then((task) => fetchStructureScene(task.id, row.file))
      .then((result) => { droppedSceneCache.set(key, result); if (!cancelled) setScene(result); })
      .catch((caught) => { if (!cancelled) setError(String(caught)); });
    return () => { cancelled = true; };
  }, [key]);
  if (error) return <div className="vfp-result-summary" data-error="">{error}</div>;
  if (!scene) return <Spin style={{ display: 'block', margin: '36px auto' }} />;
  return <StructureViewer inlineScene={scene} inlineLabel={`${row.rel_path}/${row.file}`} sourcePath={`${row.rootPath}/${row.rel_path}/${row.file}`} active={active} />;
}

function ResultTabs({ rows, kind, rootPath, focus, orderStorageKey }: { rows: any[]; kind: 'convergence' | 'structure'; rootPath: string; focus?: { key: string; nonce: number }; orderStorageKey: string }) {
  const [active, setActive] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);
  const [savedOrder, setSavedOrder] = useState<string[]>(() => {
    if (!orderStorageKey) return [];
    try { const saved = JSON.parse(sessionStorage.getItem(orderStorageKey) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const dragging = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const current = rows[active];
  const select = (index: number) => { if (index === active) return; setActive(index); setVisited((old) => [...old.filter((item) => item !== index), index].slice(-6)); };
  useEffect(() => {
    if (!focus?.key) return;
    const index = rows.findIndex((row) => kind === 'structure'
      ? structureKey({ rootPath: row.rootPath ?? rootPath, rel_path: row.rel_path, file: row.file }) === focus.key
      : `${row.rootPath ?? rootPath}/${row.rel_path}`.replace(/\\/g, '/').toLowerCase() === focus.key);
    if (index >= 0) { setActive(index); setVisited((old) => [...old.filter((item) => item !== index), index].slice(-6)); }
  }, [focus?.nonce, rows.length]);
  if (!rows.length) return <div className="vfp-result-summary">没有结果</div>;
  const treeRows = rows.map((row, index) => {
    const sourceRoot = row.rootPath ?? rootPath;
    const prefix = sourceRoot.replace(/[\\/]+$/, '').toLowerCase() === rootPath.replace(/[\\/]+$/, '').toLowerCase() ? '' : `${sourceRoot}/`;
    return { row, index, path: `${prefix}${row.rel_path ?? row.relPath ?? '.'}${kind === 'structure' ? `/${row.file ?? 'CONTCAR'}` : ''}` };
  });
  const keys = treeRows.map((item) => item.path.replace(/\\/g, '/').toLowerCase());
  const orderedIndices = [...rows.keys()].sort((a, b) => {
    const ai = savedOrder.indexOf(keys[a]);
    const bi = savedOrder.indexOf(keys[b]);
    return (ai < 0 ? savedOrder.length + a : ai) - (bi < 0 ? savedOrder.length + b : bi);
  });
  const moveTab = (from: number, to: number) => {
    if (from === to) return;
    const movingRight = orderedIndices.indexOf(from) < orderedIndices.indexOf(to);
    const next = orderedIndices.filter((index) => index !== from);
    next.splice(next.indexOf(to) + (movingRight ? 1 : 0), 0, from);
    const order = next.map((index) => keys[index]);
    setSavedOrder(order);
    if (orderStorageKey) try { sessionStorage.setItem(orderStorageKey, JSON.stringify(order)); } catch { /* keep current order */ }
  };
  return <div className="vfp-inline-visual">
    <div className="vfp-inline-tree">
      <PathTree items={treeRows} pathOf={(item) => item.path} renderLeaf={({ row, index }, name) => <button type="button" className="vfp-visual-tree-leaf" aria-current={index === active ? 'true' : undefined} data-user-added={row.userAdded ? '' : undefined} title={treeRows[index].path} onClick={() => select(index)}>{name}</button>} />
    </div>
    <div className="vfp-visual-tabs" role="tablist" aria-label={kind === 'structure' ? '结构文件' : '计算任务'} onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      const next = orderedIndices[Math.max(0, Math.min(orderedIndices.length - 1, orderedIndices.indexOf(active) + (event.key === 'ArrowRight' ? 1 : -1)))];
      select(next);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[orderedIndices.indexOf(next)]?.focus();
    }}>
      {orderedIndices.map((index) => <button key={keys[index]} type="button" role="tab" aria-selected={index === active} tabIndex={index === active ? 0 : -1}
        draggable data-user-added={rows[index].userAdded ? '' : undefined} data-drag-side={dragOver === index && dragging.current !== null ? orderedIndices.indexOf(dragging.current) < orderedIndices.indexOf(index) ? 'right' : 'left' : undefined}
        title={treeRows[index].path} onClick={() => select(index)}
        onDragStart={(event) => { dragging.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-vaspflow-tab', keys[index]); }}
        onDragOver={(event) => { if (dragging.current !== null) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOver(index); } }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragging.current !== null) moveTab(dragging.current, index); dragging.current = null; setDragOver(null); }}
        onDragEnd={() => { dragging.current = null; setDragOver(null); }}>
        {kind === 'structure' ? `${(rows[index].rel_path ?? rows[index].relPath ?? '结构').split(/[\\/]/).filter(Boolean).at(-1) ?? '结构'} / ${rows[index].file ?? 'CONTCAR'}` : (rows[index].rel_path ?? rows[index].relPath ?? '任务').split(/[\\/]/).filter(Boolean).at(-1) ?? '任务'}
      </button>)}
    </div>
    {kind === 'convergence'
      ? current?.error ? <div className="vfp-result-summary" data-error="">{current.error}</div> : <ConvergenceChart key={active} series={current} />
      : rows.map((row, index) => visited.includes(index) && <div key={`${row.rel_path}-${row.file}-${index}`} style={{ display: index === active ? 'block' : 'none' }}>
        {row.error ? <div className="vfp-result-summary" data-error="">{row.error}</div>
          : row.userAdded ? <DroppedStructurePane row={row} active={index === active} /> : <StructureViewer inlineScene={row} inlineLabel={`${row.rel_path}/${row.file}`} sourcePath={`${row.rootPath ?? rootPath}/${row.rel_path}/${row.file ?? 'CONTCAR'}`} active={index === active} />}
      </div>)}
  </div>;
}

function InputDiscovery({ value, rootPath, args }: { value: any; rootPath: string; args: any }) {
  const [previewPath, setPreviewPath] = useState('');
  const sources = value.sources?.files ?? [];
  const templates = value.templates ?? [];
  const sourceGroups = new Map<string, any[]>();
  for (const source of sources) {
    const signature = JSON.stringify([source.elements, source.coordType, source.hasSd, source.fFlags, source.tFlags]);
    sourceGroups.set(signature, [...(sourceGroups.get(signature) ?? []), source]);
  }
  const templateGroups = new Map<string, any[]>();
  for (const template of templates) {
    const signature = JSON.stringify(Object.entries(template.params ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    templateGroups.set(signature, [...(templateGroups.get(signature) ?? []), template]);
  }
  const coverage = [
    ['INCAR', (template: any) => template.files?.includes('INCAR')],
    ['KPOINTS', (template: any) => template.files?.includes('KPOINTS')],
    ['POTCAR', (template: any) => template.files?.includes('POTCAR')],
    ['提交脚本', (template: any) => !!template.submit],
  ] as const;
  const requested = args.include?.length ? args.include : ['sources', 'templates'];
  return <div className="vfp-discovery">
    <div className="vfp-tool-intent">按目录和深度寻找两类构建材料：结构文件供 POSCAR 使用，含 INCAR 的目录供参数等文件使用；这里只盘点候选。</div>
    <div className="vfp-scan-path">搜索范围：<code>{rootPath || '未知'}</code> · 最深 {args.maxDepth ?? 10} 层</div>
    <div className="vfp-source-flow">
      <div><strong>{requested.includes('sources') ? sources.length : '—'}</strong><span>结构文件</span><small>{requested.includes('sources') ? '*.vasp / POSCAR / CONTCAR → 可作为新任务的 POSCAR' : '本次未搜索'}</small></div>
      <b aria-hidden="true">＋</b>
      <div><strong>{requested.includes('templates') ? templates.length : '—'}</strong><span>模板目录</span><small>{requested.includes('templates') ? '含 INCAR；可提供参数、K 点、赝势与脚本' : '本次未搜索'}</small></div>
    </div>
    {requested.includes('sources') && <section className="vfp-discovery-section">
      <div className="vfp-discovery-heading">结构类型 <span>{sourceGroups.size} 组 · 按元素、坐标类型和选择性动力学标记归并</span></div>
      {[...sourceGroups.values()].sort((a, b) => b.length - a.length).map((members, index) => {
        const example = members[0];
        const label = `${example.elements?.join(' · ') || '未识别物种'} · ${example.coordType || '未知坐标'} · ${example.hasSd ? `SD ${example.fFlags} 固定 / ${example.tFlags} 放开` : '无 SD'}`;
        return <details className="vfp-distribution-row" key={index}><summary><span>{label}</span><strong>{members.length}</strong><i style={{ width: `${members.length / Math.max(sources.length, 1) * 100}%` }} /></summary><PathTree items={members} pathOf={(source: any) => relativePath(rootPath, source.path)} renderLeaf={(source: any, name) => <button type="button" className="vfp-source-file" title={source.path} onClick={() => setPreviewPath(source.path)}><span>{name}</span><small>{source.error || `${source.nAtoms ?? 0} 原子`}</small><span>预览 ›</span></button>} /></details>;
      })}
      {sources.length === 0 && <div className="vfp-tree-muted">没有找到结构文件</div>}
    </section>}
    {requested.includes('templates') && <section className="vfp-discovery-section">
      <div className="vfp-discovery-heading">模板目录文件覆盖 <span>每条表示 {templates.length} 个候选目录中有多少个包含该文件</span></div>
      <div className="vfp-coverage">{coverage.map(([label, matches]) => {
        const count = templates.filter(matches).length;
        return <div key={label}><span>{label}</span><div><i style={{ width: `${count / Math.max(templates.length, 1) * 100}%` }} /></div><strong>{count}/{templates.length}</strong></div>;
      })}</div>
      <div className="vfp-discovery-heading">INCAR 参数组合 <span>{templateGroups.size} 组；目录数不等于参数方案数</span></div>
      {[...templateGroups.entries()].map(([signature, members], index) => <details className="vfp-template-group" key={signature}><summary><strong>方案 {index + 1}</strong><span>{members.length} 个目录</span><span className="vfp-tree-muted">{Object.entries(members[0]?.params ?? {}).map(([key, val]) => `${key} ${val}`).join(' · ') || '未提取到关键参数'}</span></summary><div className="vfp-discovery-list">{members.map((template: any) => <div key={template.dir}><code title={template.dir}>{template.relPath ?? template.dir}</code><span>{template.missing?.length ? `缺 ${template.missing.join('、')}` : '所列文件齐备'}</span></div>)}</div></details>)}
      {templates.length === 0 && <div className="vfp-tree-muted">没有找到含 INCAR 的目录</div>}
    </section>}
    <div className="vfp-tree-muted vfp-discovery-foot">“缺项”表示该模板目录里未找到对应文件；提交脚本是可选项。两类候选尚未配对或选用，也未验证科学合理性。</div>
    {previewPath && <SourcePreview rootPath={rootPath} filePath={previewPath} onClose={() => setPreviewPath('')} />}
  </div>;
}

function StatusInspection({ value, rootPath }: { value: any; rootPath: string }) {
  const results = Array.isArray(value.results) ? value.results : [];
  const counts = scanStates.map(([code, label, color]) => ({ code, label, color, count: results.filter((row: any) => row.status?.code === code).length }));
  const failed = results.filter((row: any) => row.error).length;
  return <div className="vfp-status-inspection">
    <div className="vfp-tool-intent">读取任务的计算输出与状态证据；不重新校验输入文件。</div>
    <div className="vfp-scan-path">项目目录：<code>{rootPath || '未知'}</code> · 查看 {results.length} 个任务{failed ? ` · ${failed} 个目录读取失败` : ''}</div>
    <div className="vfp-scan-bar" role="img" aria-label={counts.map((item) => `${item.label} ${item.count}`).join('，')}>{counts.filter((item) => item.count).map((item) => <span key={item.code} style={{ width: `${item.count / Math.max(results.length, 1) * 100}%`, background: item.color }} />)}</div>
    <div className="vfp-scan-legend">{counts.filter((item) => item.count).map((item) => <span key={item.code}><i style={{ background: item.color }} />{item.label} <strong>{item.count}</strong></span>)}</div>
    <div className="vfp-inspection-list"><PathTree items={results} pathOf={(row: any) => row.rootPath && row.rootPath !== rootPath ? `${row.rootPath}/${row.relPath}` : row.relPath} renderLeaf={(row: any, name) => <details className="vfp-inspection-item">
      <summary><strong>{name}</strong><span className="vfp-state-chip" data-status={row.error ? 'error' : row.status?.code}>{row.error ? '读取失败' : row.status?.label || '状态未知'}</span><small>{row.error || row.status?.reason || ''}</small></summary>
      <div className="vfp-inspection-detail">
        <div><b>状态依据</b>{row.status?.evidence?.length ? row.status.evidence.map((item: any, i: number) => <span key={i}>{item.file ? `${item.file}：` : ''}{item.message ?? item.excerpt ?? '证据'}</span>) : <span>没有更多输出证据</span>}</div>
        <div><b>发现的输出文件</b><span>{row.outputFiles?.length ? row.outputFiles.map((file: any) => file.path ?? file.name).join('、') : '未发现'}</span></div>
        <div><b>先前输入检查</b><span>{row.inputCheck?.profileId ? `${row.inputCheck.profileId} · ${row.inputCheck.label}` : '无记录；本工具不检查输入正确性'}</span></div>
        {row.filesListed && Number.isFinite(row.fileCount) && <div><b>目录文件</b><span>{row.fileCount} 个；文件内容请在任务详情中查看</span></div>}
        {row.preview && <div><b>旧调用附带片段</b><span>{row.preview.name}；新调用已将文件读取与状态检查分开</span></div>}
        {!row.error && <button type="button" onClick={() => { void openTask(row.rootPath ?? rootPath, row.relPath, 'status'); }}>在右侧打开任务详情</button>}
      </div>
    </details>} /></div>
  </div>;
}

const profileNames: Record<string, string> = {
  'basic-inputs': '基础输入', 'static-scf': '静态 SCF', 'structure-optimization': '结构优化',
  'frequency-zpe': '频率 / ZPE', aimd: 'AIMD', neb: 'NEB',
};

function InputChecks({ value, args, rootPath }: { value: any; args: any; rootPath: string }) {
  const results = Array.isArray(value.results) ? value.results : [];
  const profileId = value.profileId || args.profileId || '';
  const basicFailure = (row: any) => row.poscarPotcar !== 'OK' && !(profileId === 'neb' && row.poscarPotcar === 'POSCAR_MISSING')
    || typeof row.incar !== 'object' || !row.incar
    || /MISSING|UNREADABLE/.test(String(row.kpoints))
    || /PARSE_ERROR|COUNT_MISMATCH|FLAG_MISSING/.test(String(row.sd));
  const statusOf = (row: any) => row.error || row.input_check?.code === 'FAIL' || basicFailure(row) ? 'FAIL'
    : row.input_check?.code === 'WARN' || row.warnings?.length ? 'WARN'
      : row.input_check?.code === 'PASS' ? 'PASS' : 'NOT_REQUESTED';
  const categories = [
    ['PASS', '通过', '#279d69'], ['WARN', '注意', '#d9aa52'], ['FAIL', '失败', '#d55750'], ['NOT_REQUESTED', '未套规则', '#9a91a8'],
  ] as const;
  const counts = categories.map(([code, label, color]) => ({ code, label, color, count: results.filter((row: any) => statusOf(row) === code).length }));
  const checkedRows = results.map((row: any, index: number) => ({
    row, index, path: typeof row.resolved === 'string' ? relativePath(rootPath, row.resolved) : args.dirs?.[index] ?? row.dir ?? `任务 ${index + 1}`,
  }));
  return <div className="vfp-input-checks">
    <div className="vfp-scan-path"><code>{rootPath || '未知目录'}</code> · {results.length} 个目录{profileId ? ` · ${profileNames[profileId] ?? profileId}` : ''}</div>
    <div className="vfp-scan-bar" role="img" aria-label={counts.map((item) => `${item.label} ${item.count}`).join('，')}>{counts.filter((item) => item.count).map((item) => <span key={item.code} style={{ width: `${item.count / Math.max(results.length, 1) * 100}%`, background: item.color }} />)}</div>
    <div className="vfp-scan-legend">{counts.map((item) => <span key={item.code}><i style={{ background: item.color }} />{item.label} <strong>{item.count}</strong></span>)}</div>
    <div className="vfp-inspection-list"><PathTree<{ row: any; index: number; path: string }> items={checkedRows} pathOf={(item) => item.path} renderLeaf={({ row, index }, name) => {
      const state = statusOf(row);
      const fields = [
        ['POSCAR ↔ POTCAR', row.poscarPotcar === 'OK' ? `元素顺序一致${row.species?.length ? `：${row.species.join(' → ')}` : ''}` : row.poscarPotcar],
        ['选择性动力学', row.sd],
        ['KPOINTS', row.kpoints],
      ];
      const checks = [
        ['结构', row.poscarPotcar === 'OK' ? 'ok' : profileId === 'neb' && row.poscarPotcar === 'POSCAR_MISSING' ? 'skip' : 'bad'],
        ['SD', profileId === 'neb' && row.poscarPotcar === 'POSCAR_MISSING' ? 'skip' : row.sd === '-' || row.sd === '?' || /PARSE_ERROR|COUNT_MISMATCH|FLAG_MISSING/.test(String(row.sd)) ? 'bad' : 'ok'],
        ['INCAR', typeof row.incar === 'object' && row.incar ? 'ok' : 'bad'],
        ['KPOINTS', row.kpoints === '-' || row.kpoints === '?' || /MISSING|UNREADABLE/.test(String(row.kpoints)) ? 'bad' : 'ok'],
        ['规则', profileId ? row.input_check?.code === 'PASS' ? 'ok' : row.input_check?.code === 'WARN' ? 'warn' : 'bad' : 'skip'],
      ];
      return <details className="vfp-inspection-item" key={`${row.resolved}-${index}`}><summary title={row.resolved}><strong>{name}</strong><span className="vfp-state-chip" data-status={state}>{state === 'PASS' ? '通过' : state === 'WARN' ? '注意' : state === 'FAIL' ? '失败' : '已解析'}</span>{state !== 'PASS' && <small>{row.error || row.input_check?.evidence?.[0]?.message || row.warnings?.[0] || ''}</small>}<span className="vfp-check-matrix">{checks.map(([label, code]) => <span key={label} data-check={code}><i />{label}</span>)}</span></summary>
        <div className="vfp-inspection-detail">
          {fields.map(([label, text]) => <div key={label}><b>{label}</b><span>{String(text ?? '未读取')}</span></div>)}
          <div><b>INCAR 参数</b><span>{typeof row.incar === 'object' && row.incar ? Object.entries(row.incar).map(([key, val]) => `${key}=${val}`).join(' · ') || '未提取到关键参数' : String(row.incar ?? '未读取')}</span></div>
          {row.input_check?.evidence?.length > 0 && <div><b>规则依据</b>{row.input_check.evidence.map((item: any, i: number) => <span key={i}>{item.message ?? item.ruleId}</span>)}</div>}
          {row.input_check?.uncheckedItems?.length > 0 && <div><b>未检查</b><span>{row.input_check.uncheckedItems.join('、')}</span></div>}
        </div></details>;
    }} /></div>
    {value.consistency?.uniform === false && <div className="vfp-discovery-foot vfp-tree-muted">发现 {value.consistency.groups?.length ?? 0} 种输入模式，请核对目录间差异。</div>}
  </div>;
}

export function VaspToolRow({ block, toolName }: { block: any; toolName: string }) {
  const args = argsOf(block);
  const settled = block?.kind === 'tool-result';
  const value = valueOf(block);
  const toolError = block?.result?.isError ? block.result.content?.find((item: any) => item.type === 'text')?.text ?? '工具执行失败' : '';
  const storageKey = toolName === 'vasp_structure_scene' ? droppedStorageKey(block) : '';
  const otherStorageKey = ['vasp_convergence', 'vasp_inspect_tasks', 'vasp_inspect_task'].includes(toolName) ? droppedStorageKey(block, toolName) : '';
  const [dropped, setDropped] = useState<AddedStructure[]>(() => readDroppedStructures(storageKey));
  const [otherDropped, setOtherDropped] = useState<any[]>(() => readDroppedRows(otherStorageKey));
  const [dropFocus, setDropFocus] = useState({ key: '', nonce: 0 });
  const [dropActive, setDropActive] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState('');
  useEffect(() => { if (storageKey) setDropped(readDroppedStructures(storageKey)); }, [storageKey]);
  useEffect(() => { if (otherStorageKey) setOtherDropped(readDroppedRows(otherStorageKey)); }, [otherStorageKey]);
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
  const visualRows = Array.isArray(value.results) ? value.results : [];
  let summary = '';
  let rows: Array<{ path: string; label: string; note?: string; status?: string }> = [];
  let tab: 'status' | 'chart' | 'structure' | 'files' = 'status';
  if (toolName === 'vasp_scan') {
    summary = '';
  } else if (toolName === 'vasp_inspect_task') {
    summary = [value.status?.label ?? value.status?.code, value.inputCheck?.profileId ? `输入规则 ${value.inputCheck.profileId}：${value.inputCheck.label}` : '未进行输入规则检查', value.status?.reason].filter(Boolean).join(' · ');
    rows = relPath ? [{ path: relPath, label: relPath, note: '在右侧查看证据' }] : [];
  } else if (toolName === 'vasp_inspect_tasks') {
    summary = '';
  } else if (toolName === 'vasp_convergence') {
    summary = visualRows.length ? `${visualRows.length} 个任务的收敛曲线` : `${value.ionSteps ?? 0} 个离子步${Number.isFinite(value.finalEnergy) ? ` · 末步能量 ${Number(value.finalEnergy).toFixed(6)} eV` : ''}`;
    if (!visualRows.length && relPath) { rows = [{ path: relPath, label: relPath, note: '在右侧查看曲线' }]; tab = 'chart'; }
  } else if (toolName === 'vasp_structure_scene') {
    summary = visualRows.length || dropped.length ? `${visualRows.length} 个原始结构${dropped.length ? ` · ${dropped.length} 个拖入结构` : ''}` : `${value.summary?.formula ?? '结构'} · ${value.summary?.atom_count ?? 0} 个原子`;
    if (!visualRows.length && relPath) { rows = [{ path: relPath, label: relPath, note: '在右侧查看结构' }]; tab = 'structure'; }
  } else if (toolName === 'vasp_discover_inputs') {
    summary = '';
  } else if (toolName === 'vasp_check_inputs') {
    summary = '';
  }
  const error = toolError || value.error || block?.result?.error;
  const acceptsDrop = ['vasp_structure_scene', 'vasp_convergence', 'vasp_inspect_tasks', 'vasp_inspect_task'].includes(toolName) && settled && !error && !dropBusy;
  const hasSupportedDrag = (event: React.DragEvent) => {
    const kinds = toolName === 'vasp_structure_scene' ? ['file', 'task'] : ['task'];
    return kinds.some((kind) => Array.from(event.dataTransfer.types).includes(`${STRUCTURE_DRAG_TYPE}-${kind}`));
  };
  const handleDrop = async (event: React.DragEvent) => {
    if (!acceptsDrop || !hasSupportedDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const item = readStructureDrag(event.dataTransfer);
    if (!item) return;
    if (toolName !== 'vasp_structure_scene' && item.kind !== 'task') return;
    if (toolName === 'vasp_structure_scene' && item.kind === 'directory') return;
    setDropBusy(true);
    setDropError('');
    try {
      const task = await openTaskByPath(item.rootPath, item.relPath);
      if (toolName !== 'vasp_structure_scene') {
        const key = `${item.rootPath}/${item.relPath}`.replace(/\\/g, '/').toLowerCase();
        const current = toolName === 'vasp_convergence' ? visualRows : Array.isArray(value.results) ? value.results : [];
        if (!current.some((row: any) => `${row.rootPath ?? rootPath}/${row.rel_path ?? row.relPath}`.replace(/\\/g, '/').toLowerCase() === key)
          && !otherDropped.some((row) => `${row.rootPath}/${row.rel_path}`.replace(/\\/g, '/').toLowerCase() === key)) {
          const row = toolName === 'vasp_convergence'
            ? { ...await fetchConvergence(task.id), rootPath: item.rootPath, rel_path: task.rel_path, userAdded: true }
            : { rootPath: item.rootPath, relPath: task.rel_path, rel_path: task.rel_path, status: task.status_record, outputFiles: task.output_files, inputCheck: task.input_check, userAdded: true };
          const next = [...otherDropped, row];
          setOtherDropped(next);
          if (otherStorageKey) try { sessionStorage.setItem(otherStorageKey, JSON.stringify(next)); } catch { /* keep in memory */ }
        }
        if (toolName === 'vasp_convergence') setDropFocus((old) => ({ key, nonce: old.nonce + 1 }));
        return;
      }
      const files = await fetchStructureFiles(task.id);
      const selectedFiles = item.kind === 'task' ? files : files.filter((file) => file.toUpperCase() === item.file!.toUpperCase());
      if (!selectedFiles.length) throw new Error(item.kind === 'task' ? '该任务直属目录没有结构文件' : '该结构文件不在任务直属目录中');
      const candidates = selectedFiles.map((file) => ({ rootPath: item.rootPath, rel_path: item.relPath, file, userAdded: true as const }));
      const existing = new Set([...visualRows, ...dropped].map((row) => structureKey({ rootPath: row.rootPath ?? rootPath, rel_path: row.rel_path, file: row.file })));
      const additions = candidates.filter((row) => !existing.has(structureKey(row)));
      if (additions.length) {
        const next = [...dropped, ...additions];
        setDropped(next);
        if (storageKey) try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* keep in memory */ }
      }
      setDropFocus((old) => ({ key: structureKey(additions[0] ?? candidates[0]), nonce: old.nonce + 1 }));
    } catch (caught) {
      setDropError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDropBusy(false);
    }
  };
  return <div data-dsh-vaspflow-tool={toolName} data-drop-active={dropActive ? '' : undefined}
    onDragOver={(event) => { if (acceptsDrop && hasSupportedDrag(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true); } }}
    onDragLeave={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) setDropActive(false);
    }}
    onDrop={(event) => { void handleDrop(event); }}>
    <div className="vfp-tree-head"><strong>{titles[toolName]}</strong><span className="vfp-tree-muted">{settled ? error ? '失败' : '完成' : '处理中'}</span></div>
    {dropActive && <div className="vfp-structure-drop-hint">松开以{toolName === 'vasp_structure_scene' ? '添加结构标签页' : toolName === 'vasp_convergence' ? '添加任务曲线标签页' : '补充任务状态记录'}</div>}
    {dropBusy && <div className="vfp-tree-muted">正在读取任务…</div>}
    {dropError && <div className="vfp-result-summary" data-error="">{dropError}</div>}
    {settled && (error ? <div className="vfp-result-summary" data-error="">{error}</div> : <>
      {toolName === 'vasp_scan' ? <ScanOverview value={value} rootPath={rootPath} />
        : toolName === 'vasp_discover_inputs' ? <InputDiscovery value={value} rootPath={rootPath} args={args} />
          : toolName === 'vasp_inspect_tasks' || toolName === 'vasp_inspect_task' ? <StatusInspection value={{ ...value, results: [...(toolName === 'vasp_inspect_task' ? [{ relPath, status: value.status, inputCheck: value.inputCheck, outputFiles: value.outputFiles }] : visualRows), ...otherDropped] }} rootPath={rootPath} />
            : toolName === 'vasp_check_inputs' ? <InputChecks value={value} rootPath={rootPath} args={args} />
          : toolName === 'vasp_convergence' || toolName === 'vasp_structure_scene'
            ? <><div className="vfp-result-summary">{toolName === 'vasp_convergence' && otherDropped.length ? `${visualRows.length} 个原始任务 · ${otherDropped.length} 个拖入任务` : summary}</div>{(visualRows.length > 0 || dropped.length > 0 || otherDropped.length > 0) && <ResultTabs rows={toolName === 'vasp_structure_scene' ? [...visualRows, ...dropped] : [...visualRows, ...otherDropped]} kind={toolName === 'vasp_convergence' ? 'convergence' : 'structure'} rootPath={rootPath} focus={dropFocus} orderStorageKey={droppedStorageKey(block, `${toolName}-tab-order`)} />}</>
            : <div className="vfp-result-summary">{summary || '无结果'}</div>}
      {rows.length > 0 && <IssueRows rows={rows} rootPath={rootPath} tab={tab} />}
    </>)}
  </div>;
}
