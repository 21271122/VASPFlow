/**
 * dsh-vaspflow client: batch-wide source view.
 *
 * The per-task card answers "what will this file look like"; this one answers
 * "which tasks share which source file", for the whole batch at once. Grouped
 * by input file, each group renders a tree: the source file is the root node,
 * every task that copies from it is a connected child. Picking a child renders
 * the same comparison the single-task card uses, inline.
 */
import React from 'react';
import { SourceCompare } from './source-compare';
import { basenameOf, groupBatchBySource, toPosix } from './inheritance';

export type BatchCompareProps = {
  batch: { tasks: any[]; results: any[] } | undefined;
  projectRoot: string;
  projectName: string;
  planId?: string;
};

type Picked = { slotKey: string; index: number; sourcePath: string };

const FILE_NAME_BY_SLOT: Record<string, string> = {
  POSCAR: 'POSCAR', INCAR: 'INCAR', KPOINTS: 'KPOINTS', POTCAR: 'POTCAR',
};

export function BatchCompare({ batch, projectRoot, projectName, planId }: BatchCompareProps) {
  const groups = React.useMemo(() => groupBatchBySource(batch, projectRoot), [batch, projectRoot]);
  const [openKeys, setOpenKeys] = React.useState<Set<string>>(() => new Set(groups.slice(0, 1).map((group) => group.key)));
  const [picked, setPicked] = React.useState<Picked | null>(null);

  const toggle = (key: string) => setOpenKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const detailRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (picked) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);

  const tasks = batch?.tasks ?? [];
  const results = batch?.results ?? [];

  let detail: React.ReactNode = (
    <div className="vfp-batch-hint">点任意任务节点，在这里看它与来源文件的差异</div>
  );
  if (picked) {
    const task = tasks[picked.index];
    const result = results[picked.index];
    const fileName = picked.slotKey === 'submit' ? basenameOf(task?.submitSrc) : FILE_NAME_BY_SLOT[picked.slotKey] ?? picked.slotKey;
    detail = (
      <SourceCompare
        key={`${picked.slotKey}-${picked.index}`}
        projectRoot={projectRoot}
        projectName={projectName}
        slotLabel={picked.slotKey === 'submit' ? '提交脚本' : picked.slotKey}
        source={{ path: picked.sourcePath }}
        fileName={fileName}
        planId={planId}
        taskIndex={picked.index}
        incarOverrides={picked.slotKey === 'INCAR' ? task?.incarOverrides : undefined}
        rewritten={picked.slotKey === 'POSCAR'}
        note={picked.slotKey === 'POSCAR' && result?.sd ? `SD 将改写为 ${result.sd}` : undefined}
      />
    );
  }

  return (
    <div className="vfp-batch vaspflow-task-popover">
      <div className="vfp-batch-head">
        <strong>整批来源</strong>
        <span className="vfp-cmp-note">{tasks.length} 个任务 · {groups.length} 类输入文件</span>
      </div>
      <div className="vfp-batch-body">
        {groups.map((group) => {
          const open = openKeys.has(group.key);
          return (
            <section className="vfp-batch-group" key={group.key}>
              <button type="button" className="vfp-batch-group-head" aria-expanded={open} onClick={() => toggle(group.key)}>
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <strong>{group.label}</strong>
                <span className="vfp-cmp-note">{group.sources.length} 个来源 · {group.sources.reduce((sum, source) => sum + source.tasks.length, 0)} 个任务</span>
                {group.missing.length ? <span className="vfp-batch-missing">{group.missing.length} 缺失</span> : null}
              </button>
              {open && (
                <div className="vfp-batch-tree">
                  {group.sources.map((source) => (
                    <div className="vfp-batch-source" key={source.path}>
                      <div className="vfp-batch-node vfp-batch-root" title={source.path}>
                        <span className="vfp-batch-dot" aria-hidden="true" />
                        <code className="vfp-batch-path-label">{source.rel}</code>
                        <span className="vfp-batch-count">×{source.tasks.length}</span>
                      </div>
                      <ul className="vfp-batch-children">
                        {source.tasks.map((index) => {
                          const fullDir = tasks[index]?.dir || `任务 ${index + 1}`;
                          const parts = toPosix(fullDir).split('/').filter(Boolean);
                          const label = parts.slice(-2).join('/') || fullDir;
                          const active = picked && picked.slotKey === group.key && picked.index === index;
                          return (
                            <li key={`${group.key}-${index}`}>
                              <button
                                type="button"
                                className="vfp-batch-node vfp-batch-task"
                                data-active={active ? '' : undefined}
                                title={`${toPosix(fullDir)} · 第 ${index + 1} 个任务`}
                                onClick={() => setPicked({ slotKey: group.key, index, sourcePath: source.path })}
                              >
                                <span className="vfp-batch-name">{label}</span>
                                <span className="vfp-batch-dir">#{index + 1}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {group.missing.length ? (
                    <div className="vfp-batch-missing-row">
                      缺失：{group.missing.map((index) => basenameOf(tasks[index]?.dir) || `任务 ${index + 1}`).join('、')}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="vfp-batch-detail" ref={detailRef}>{detail}</div>
    </div>
  );
}
