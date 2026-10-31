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
import { groupBatchBySource, toPosix } from './inheritance';

export type BatchCompareProps = {
  batch: { tasks: any[]; results: any[] } | undefined;
  projectRoot: string;
  projectName: string;
  planId?: string;
};

/** Nodes rendered per source before the list has to be expanded by hand. */
const NODE_LIMIT = 5;

const FILE_NAME_BY_SLOT: Record<string, string> = {
  POSCAR: 'POSCAR', INCAR: 'INCAR', KPOINTS: 'KPOINTS', POTCAR: 'POTCAR',
};

function taskLabel(dir?: string): string {
  const parts = toPosix(dir || '').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || dir || '任务';
}

export function BatchCompare({ batch, projectRoot, projectName, planId }: BatchCompareProps) {
  const groups = React.useMemo(() => groupBatchBySource(batch, projectRoot), [batch, projectRoot]);
  const [openKeys, setOpenKeys] = React.useState<Set<string>>(() => new Set(groups.slice(0, 1).map((group) => group.key)));
  const [showAll, setShowAll] = React.useState<Set<string>>(() => new Set());

  const toggle = (key: string) => setOpenKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const revealAll = (path: string) => setShowAll((current) => new Set(current).add(path));

  const tasks = batch?.tasks ?? [];
  const results = batch?.results ?? [];

  return (
    <div className="vfp-batch vaspflow-task-popover">
      <div className="vfp-batch-head">
        <strong>整批来源</strong>
        <span className="vfp-cmp-note">{tasks.length} 个任务 · {groups.length} 类输入文件</span>
      </div>
      <div className="vfp-batch-body">
        {groups.map((group) => {
          const open = openKeys.has(group.key);
          const total = group.sources.reduce((sum, source) => sum + source.tasks.length, 0);
          return (
            <section className="vfp-batch-group" key={group.key}>
              <button type="button" className="vfp-batch-group-head" aria-expanded={open} onClick={() => toggle(group.key)}>
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <strong>{group.label}</strong>
                <span className="vfp-cmp-note">{group.sources.length} 个来源 · {total} 个任务</span>
                {group.missing.length ? <span className="vfp-batch-missing">{group.missing.length} 缺失</span> : null}
              </button>
              {open && (
                <div className="vfp-batch-tree">
                  {group.sources.map((source) => {
                    const shown = showAll.has(source.path) ? source.tasks : source.tasks.slice(0, NODE_LIMIT);
                    const hidden = source.tasks.length - shown.length;
                    return (
                      <div className="vfp-batch-source" key={source.path}>
                        <div className="vfp-batch-node vfp-batch-root" title={source.path}>
                          <span className="vfp-batch-dot" aria-hidden="true" />
                          <code className="vfp-batch-path-label">{source.rel}</code>
                          <span className="vfp-batch-count">×{source.tasks.length}</span>
                        </div>
                        <SourceCompare
                          compact
                          variant="source"
                          projectRoot={projectRoot}
                          projectName={projectName}
                          slotLabel={group.label}
                          source={{ path: source.path }}
                          fileName=""
                        />
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
                                  source={{ path: source.path }}
                                  fileName={fileName}
                                  planId={planId}
                                  taskIndex={index}
                                  incarOverrides={group.key === 'INCAR' ? task?.incarOverrides : undefined}
                                  rewritten={group.key === 'POSCAR'}
                                  note={group.key === 'POSCAR' && result?.sd ? `SD 将改写为 ${result.sd}` : undefined}
                                />
                              </li>
                            );
                          })}
                          {hidden > 0 ? (
                            <li className="vfp-batch-more">
                              <button type="button" onClick={() => revealAll(source.path)}>还有 {hidden} 个任务，展开</button>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    );
                  })}
                  {group.missing.length ? (
                    <div className="vfp-batch-missing-row">
                      缺失：{group.missing.map((index) => taskLabel(tasks[index]?.dir)).join('、')}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
