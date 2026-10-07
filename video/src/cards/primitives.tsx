/**
 * primitives.tsx — 卡片的原子组件，结构与 class 名照抄
 * plugins/dsh-vaspflow/src/client/tool-rows.tsx：
 *   PathTree / PieBreakdown / IssueRows / 扫描条与图例 / 状态药丸。
 * 这里只做了两件与渲染无关的让步：状态由 props 传入（不再有 useState），
 * 以及行的入场用 Remotion 的 Reveal 包一层。
 */
import React from 'react';
import { Reveal, useProgress } from '../motion';

type PathNode<T> = { name: string; count: number; children: Map<string, PathNode<T>>; item?: T };

export const PathTree = <T,>({ items, pathOf, renderLeaf, openPath = [], delay = 0, step = 3 }: {
  items: T[];
  pathOf: (item: T) => string;
  renderLeaf: (item: T, name: string) => React.ReactNode;
  openPath?: string[];
  delay?: number;
  step?: number;
}) => {
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
  let leafIndex = 0;
  const sortNodes = (nodes: PathNode<T>[]) => [...nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const renderNode = (node: PathNode<T>, parentPath: string[] = []): React.ReactNode => {
    const path = [...parentPath, node.name];
    const children = sortNodes([...node.children.values()]);
    if (!children.length) {
      const index = leafIndex++;
      return <div className="vfp-path-leaf" key={node.name}>
        <Reveal delay={delay + index * step} y={7}>{node.item ? renderLeaf(node.item, node.name) : null}</Reveal>
      </div>;
    }
    const isOpen = path.every((part, index) => openPath[index] === part);
    return <details className="vfp-path-folder" key={node.name} open={isOpen}>
      <summary title={node.name}><span>{node.name}</span><small>{node.count}</small></summary>
      <div className="vfp-path-children">
        {node.item && <div className="vfp-path-leaf"><Reveal delay={delay} y={7}>{renderLeaf(node.item, '本目录')}</Reveal></div>}
        {children.map((child) => renderNode(child, path))}
      </div>
    </details>;
  };
  return <div className="vfp-tree-shell">
    <div className="vfp-tree-breadcrumb" hidden title={openPath.join('/')}>{openPath.join('/')}</div>
    <div className="vfp-path-tree">
      <details className="vfp-path-root vfp-path-folder" open>
        <summary><span>根目录</span><small>{items.length}</small></summary>
        <div className="vfp-path-children">{sortNodes([...root.children.values()]).map((node) => renderNode(node))}</div>
      </details>
    </div>
  </div>;
};

export const PieBreakdown: React.FC<{
  title: string;
  items: Array<{ code: string; label: string; color: string; count: number }>;
  selectedCode?: string;
  delay?: number;
}> = ({ title, items, selectedCode, delay = 0 }) => {
  const sweep = useProgress(delay + 4, 32);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const visible = items.filter((item) => item.count > 0);
  const slices = visible.map((item) => {
    const start = cursor;
    cursor += item.count / total * 100;
    return `${item.color} ${start}% ${cursor}%`;
  });
  return <section className="vfp-pie-section">
    <Reveal delay={delay} y={8}><div className="vfp-pie-title">{title}</div></Reveal>
    <div className="vfp-pie-body">
      <Reveal delay={delay + 4} y={0} scale={0.86}>
        <div className="vfp-pie" role="img" aria-label={items.map((item) => `${item.label} ${item.count}`).join('，')}
          style={{ background: slices.length ? `conic-gradient(${slices.join(', ')})` : 'rgba(128,128,128,.14)', maskImage: sweep < 1 ? `conic-gradient(#000 ${sweep * 360}deg, transparent ${sweep * 360}deg)` : undefined }} />
      </Reveal>
      <div className="vfp-pie-legend">
        {visible.map((item, index) => <Reveal key={item.code} delay={delay + 8 + index * 3} y={5} x={8}>
          <button type="button" className="vfp-pie-legend-row" data-selected={selectedCode === item.code ? '' : undefined} aria-pressed={selectedCode === item.code}>
            <i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count}</strong><small>{(item.count / total * 100).toFixed(1)}%</small>
          </button>
        </Reveal>)}
      </div>
    </div>
  </section>;
};

export const IssueRows: React.FC<{
  rows: Array<{ path: string; label: string; note?: string; status?: string }>;
  openPath?: string[];
  delay?: number;
  step?: number;
}> = ({ rows, openPath = [], delay = 0, step = 3 }) => (
  <div className="vfp-result-rows">
    <PathTree items={rows} pathOf={(row) => row.path || row.label} openPath={openPath} delay={delay} step={step}
      renderLeaf={(row, name) => <button type="button" className="vfp-result-row" title={`${row.path} · 可拖到其他工具卡片`}>
        <span>{name}</span><span className="vfp-tree-muted">{row.note}</span>
        <span className="vfp-tree-status" data-status={row.status}>{row.status === 'error' ? '错误' : row.status === 'warn' ? '注意' : row.path ? '查看' : ''}</span>
      </button>} />
  </div>
);

export const ScanBar: React.FC<{ counts: Array<{ code: string; label: string; color: string; count: number }>; total: number; delay?: number; style?: React.CSSProperties }> = ({ counts, total, delay = 0, style }) => (
  <div className="vfp-scan-bar" role="img" aria-label={counts.map((item) => `${item.label} ${item.count}`).join('，')} style={style}>
    {counts.filter((item) => item.count).map((item, index) => <Reveal key={item.code} delay={delay + index * 3} y={0} x={-14} duration={16} style={{ height: '100%' }}>
      <span style={{ display: 'block', height: '100%', width: `${item.count / Math.max(total, 1) * 100}%`, background: item.color }} />
    </Reveal>)}
    {counts.every((item) => !item.count) && <span style={{ width: '100%' }} />}
  </div>
);

export const ScanLegend: React.FC<{ counts: Array<{ code: string; label: string; color: string; count: number }>; delay?: number }> = ({ counts, delay = 0 }) => (
  <div className="vfp-scan-legend">
    {counts.filter((item) => item.count).map((item, index) => <Reveal key={item.code} delay={delay + index * 3} y={5} x={6}>
      <span><i style={{ background: item.color }} />{item.label} <strong>{item.count}</strong></span>
    </Reveal>)}
  </div>
);

export const StateChip: React.FC<{ status?: string; children: React.ReactNode }> = ({ status, children }) => (
  <span className="vfp-state-chip" data-status={status}>{children}</span>
);
