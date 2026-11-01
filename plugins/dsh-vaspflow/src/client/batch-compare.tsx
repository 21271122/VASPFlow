/**
 * dsh-vaspflow client: batch-wide source view.
 *
 * Grouped by input file, then by the file every task in that group copies from:
 * the source path is the root node, and each task is a node of its own that
 * *is* the preview — it renders the same 参考来源 / 将写入 comparison inline, so
 * the batch can be read without opening tasks one by one.
 */
import React from 'react';
import { SourceCompare } from './source-compare';
import { absoluteTaskPath, buildRelativeTree, groupBatchBySource, projectRelative, toPosix } from './inheritance';
import type { DirNode } from './inheritance';

export type BatchCompareProps = {
  batch: { tasks: any[]; results: any[] } | undefined;
  projectRoot: string;
  projectName: string;
  planId?: string;
  /** Upper bound from the anchor position, so the card cannot leave the window. */
  maxWidth?: number;
};

const FILE_NAME_BY_SLOT: Record<string, string> = {
  POSCAR: 'POSCAR', INCAR: 'INCAR', KPOINTS: 'KPOINTS', POTCAR: 'POTCAR',
};

function taskLabel(dir?: string): string {
  const parts = toPosix(dir || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || dir || '任务';
}

export function BatchCompare({ batch, projectRoot, projectName, planId, maxWidth }: BatchCompareProps) {
  const groups = React.useMemo(() => groupBatchBySource(batch, projectRoot), [batch, projectRoot]);
  // Accordion: expanding one file type closes the others, so only one set of
  // previews is on screen at a time.
  const [openKey, setOpenKey] = React.useState<string | null>(() => groups[0]?.key ?? null);
  const [treeKeys, setTreeKeys] = React.useState<Set<string>>(() => new Set());

  const toggle = (key: string) => setOpenKey((current) => (current === key ? null : key));

  const toggleTree = (key: string) => setTreeKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const tasks = batch?.tasks ?? [];
  const results = batch?.results ?? [];

  return (
    <div className="vfp-batch vaspflow-task-popover" style={maxWidth ? { width: Math.min(1240, maxWidth) } : undefined}>
      <div className="vfp-batch-head">
        <strong>整批来源</strong>
        <span className="vfp-cmp-note">{tasks.length} 个任务 · {groups.length} 类输入文件</span>
      </div>
      <div className="vfp-batch-body">
        {groups.map((group) => {
          const open = openKey === group.key;
          const total = group.sources.reduce((sum, source) => sum + source.tasks.length, 0);
          return (
            <section className="vfp-batch-group" key={group.key}>
              <div className="vfp-batch-group-head">
                <button type="button" className="vfp-batch-group-toggle" aria-expanded={open} onClick={() => toggle(group.key)}>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <strong>{group.label}</strong>
                  <span className="vfp-cmp-note">{group.sources.length} 个来源 · {total} 个任务</span>
                  {group.missing.length ? <span className="vfp-batch-missing">{group.missing.length} 缺失</span> : null}
                </button>
                <button
                  type="button"
                  className="vfp-batch-dirbutton"
                  aria-pressed={treeKeys.has(group.key)}
                  title="查看模板与任务的相对目录结构"
                  onClick={() => toggleTree(group.key)}
                >
                  目录
                </button>
              </div>
              {open && (
                <div className="vfp-batch-tree">
                  {group.sources.map((source) => {
                    const shown = source.tasks;
                    // The directory that holds the template is what the user
                    // names the source by ("C1"), not the word 模板.
                    const sourceName = toPosix(source.path).split('/').filter(Boolean).slice(-2, -1)[0] || '模板';
                    const slotFileName = group.key === 'submit'
                      ? toPosix(tasks[source.tasks[0]]?.submitSrc || '').split('/').pop() || 'submit.sh'
                      : FILE_NAME_BY_SLOT[group.key] ?? group.key;
                    const compareWith = source.tasks
                      .map((index) => results[index]?.files?.[slotFileName]?.written)
                      .filter((text) => typeof text === 'string') as string[];
                    return (
                      <div className="vfp-batch-row" key={source.path}>
                        <div className="vfp-batch-row-source">
                          <SourceCompare
                            compact
                            variant="source"
                            projectRoot={projectRoot}
                            projectName={projectName}
                            slotLabel={source.tasks.length > 1 ? `${sourceName} ×${source.tasks.length}` : sourceName}
                            hint={projectRelative(projectRoot, source.path)}
                            compareWith={compareWith}
                            source={{ path: source.path }}
                            fileName=""
                          />
                        </div>
                        <ul className="vfp-batch-children">
                          {shown.map((index) => {
                            const task = tasks[index];
                            const result = results[index];
                            const fileName = group.key === 'submit'
                              ? toPosix(task?.submitSrc || '').split('/').pop() || 'submit.sh'
                              : FILE_NAME_BY_SLOT[group.key] ?? group.key;
                            return (
                              <li className="vfp-batch-leaf" key={`${group.key}-${index}`}>
                                <SourceCompare
                                  compact
                                  variant="written"
                                  projectRoot={projectRoot}
                                  projectName={projectName}
                                  slotLabel={taskLabel(task?.dir)}
                                  hint={toPosix(task?.dir || "")}
                                  source={{ path: source.path }}
                                  fileName={fileName}
                                  files={results[index]?.files}
                                  planId={planId}
                                  taskIndex={index}
                                  incarOverrides={group.key === 'INCAR' ? task?.incarOverrides : undefined}
                                  rewritten={group.key === 'POSCAR'}
                                  note={group.key === 'POSCAR' && result?.sd ? `SD 将改写为 ${result.sd}` : undefined}
                                  writtenLabel={fileName}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                  {group.missing.length ? (
                    <div className="vfp-batch-missing-row">
                      缺失：{group.missing.map((index) => taskLabel(tasks[index]?.dir)).join('、')}
                    </div>
                  ) : null}
                  {treeKeys.has(group.key) ? (() => {
                    const tree = buildRelativeTree(
                      group.sources.map((source) => toPosix(source.path).split('/').slice(0, -1).join('/')),
                      group.sources.flatMap((source) => source.tasks.map((index) => absoluteTaskPath(projectRoot, tasks[index]?.dir || '.'))),
                      projectRoot,
                    );
                    return tree ? <DirTree root={tree} /> : null;
                  })() : null}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Directory graph: every node is a folder, edges are nesting. */
export function DirTree({ root }: { root: DirNode }) {
  const render = (node: DirNode) => (
    <li className="vfp-dir-item" data-kind={node.kind} key={node.path || node.name}>
      <span className="vfp-dir-label" title={node.path}>
        <i className="vfp-dir-dot" aria-hidden="true" />
        <b>{node.name}</b>
        {node.kind === 'template' ? <em className="vfp-dir-tag">模板</em> : null}
        {node.kind === 'task' ? <em className="vfp-dir-tag">{node.taskCount > 1 ? `任务 ×${node.taskCount}` : '任务'}</em> : null}
        {node.kind === 'both' ? <em className="vfp-dir-tag">模板 + 任务</em> : null}
      </span>
      {node.children.length > 0 ? <ul>{node.children.map((child) => render(child))}</ul> : null}
    </li>
  );
  return (
    <div className="vfp-dirtree">
      <div className="vfp-dirtree-head">
        <strong>相对目录</strong>
        <span className="vfp-dirtree-legend">
          <i data-kind="template" aria-hidden="true" />模板
          <i data-kind="task" aria-hidden="true" />任务
          <i data-kind="plain" aria-hidden="true" />上级
        </span>
      </div>
      <ul className="vfp-dirtree-root">{render(root)}</ul>
    </div>
  );
}
