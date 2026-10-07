/**
 * visuals.tsx — 两张“可视化”卡片的主体：
 *   ConvergenceChart —— recharts 双轴折线（能量 #8884d8 / 最大力 #82ca9d）的 SVG 复刻；
 *   StructureViewer   —— 3D 结构的确定性 SVG 复刻（元素色、球半径、成键、晶胞配色同源）。
 * 以及把它们装进对话里的 ResultTabs（任务树 + 标签栏）。
 */
import React from 'react';
import { Reveal, useProgress } from '../motion';
import { atomColor } from './tokens';
import { projectScene, type StructureScene } from './scene';
import { PathTree } from './primitives';

const num = (value: unknown, digits: number) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';

/* ------------------------------------------------------------------ chart */

export interface ConvergenceSeries {
  rel_path?: string;
  ion_steps: number[];
  energies: number[];
  max_forces: number[];
  source_path?: string;
  _source?: string;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const raw = (max - min) / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export const ConvergenceChart: React.FC<{ series: ConvergenceSeries; delay?: number; width?: number; height?: number; absolute?: boolean }> = ({ series, delay = 0, width = 1010, height = 286, absolute = false }) => {
  const steps = series.ion_steps ?? [];
  const last = series.energies?.[series.energies.length - 1] ?? 0;
  const energies = (series.energies ?? []).map((value) => absolute ? value : value - last);
  const forces = series.max_forces ?? [];
  const source = series.source_path ? `${series.source_path}${series._source ? ` · ${series._source}` : ''}` : series._source ?? 'OSZICAR / OUTCAR';
  const energyLabel = absolute ? '绝对能量 (eV)' : '相对能量 ΔE (eV)';

  const padding = { left: 66, right: 62, top: 18, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xMin = Math.min(...steps), xMax = Math.max(...steps);
  const eMin = Math.min(...energies), eMax = Math.max(...energies);
  const fMax = Math.max(...forces);
  const x = (step: number) => padding.left + (step - xMin) / Math.max(xMax - xMin, 1) * plotWidth;
  const yEnergy = (value: number) => padding.top + (1 - (value - eMin) / Math.max(eMax - eMin, 1e-9)) * plotHeight;
  const yForce = (value: number) => padding.top + (1 - value / Math.max(fMax, 1e-9)) * plotHeight;

  const line = (values: number[], scale: (v: number) => number) => values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(steps[index]).toFixed(2)},${scale(value).toFixed(2)}`).join(' ');
  const energyPath = line(energies, yEnergy);
  const forcePath = line(forces, yForce);
  const draw = useProgress(delay + 6, 34);

  const eTicks = niceTicks(eMin, eMax);
  const fTicks = niceTicks(0, fMax);
  const xTicks = niceTicks(xMin, xMax, 7).filter((t) => t >= xMin && t <= xMax && Number.isInteger(t));

  const tickFont: React.CSSProperties = { fontSize: 10, fill: '#65746b', fontVariantNumeric: 'tabular-nums' };

  return <div>
    <div title={`数据来源: ${source}`} style={{ marginBottom: 2, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
      数据来源: {source}
    </div>
    <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 26, height: 14, borderRadius: 7, background: 'rgba(128,128,128,.25)', display: 'inline-block', position: 'relative' }}>
        <span style={{ position: 'absolute', top: 2, left: 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
      </span>
      <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #888)' }}>{absolute ? '绝对能量' : '相对能量（相对最后一步）'}</span>
    </div>
    <Reveal delay={delay + 2} y={10} duration={20}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收敛曲线">
        <defs><clipPath id="vfp-chart-clip"><rect x={padding.left} y={padding.top - 8} width={plotWidth} height={plotHeight + 12} /></clipPath></defs>
        {eTicks.map((tick) => <line key={`g${tick}`} x1={padding.left} x2={padding.left + plotWidth} y1={yEnergy(tick)} y2={yEnergy(tick)} stroke="#f0f0f0" strokeDasharray="3 3" />)}
        {xTicks.map((tick) => <line key={`gx${tick}`} x1={x(tick)} x2={x(tick)} y1={padding.top} y2={padding.top + plotHeight} stroke="#f0f0f0" strokeDasharray="3 3" />)}
        <line x1={padding.left} x2={padding.left + plotWidth} y1={padding.top + plotHeight} y2={padding.top + plotHeight} stroke="#c9d2cc" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + plotHeight} stroke="#c9d2cc" />
        <line x1={padding.left + plotWidth} x2={padding.left + plotWidth} y1={padding.top} y2={padding.top + plotHeight} stroke="#c9d2cc" />
        {eTicks.map((tick) => <g key={`et${tick}`}><line x1={padding.left - 4} x2={padding.left} y1={yEnergy(tick)} y2={yEnergy(tick)} stroke="#c9d2cc" /><text x={padding.left - 7} y={yEnergy(tick) + 3.5} textAnchor="end" style={tickFont}>{absolute ? tick.toFixed(2) : tick.toExponential(1)}</text></g>)}
        {fTicks.map((tick) => <g key={`ft${tick}`}><line x1={padding.left + plotWidth} x2={padding.left + plotWidth + 4} y1={yForce(tick)} y2={yForce(tick)} stroke="#c9d2cc" /><text x={padding.left + plotWidth + 7} y={yForce(tick) + 3.5} textAnchor="start" style={tickFont}>{tick.toFixed(3)}</text></g>)}
        {xTicks.map((tick) => <text key={`xt${tick}`} x={x(tick)} y={padding.top + plotHeight + 15} textAnchor="middle" style={tickFont}>{tick}</text>)}
        <text x={padding.left + plotWidth} y={padding.top + plotHeight + 30} textAnchor="end" style={{ ...tickFont, fontSize: 11, fill: '#454d5f' }}>离子步</text>
        <text transform={`translate(16 ${padding.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" style={{ ...tickFont, fontSize: 11, fill: '#454d5f' }}>{energyLabel}</text>
        <text transform={`translate(${width - 12} ${padding.top + plotHeight / 2}) rotate(90)`} textAnchor="middle" style={{ ...tickFont, fontSize: 11, fill: '#454d5f' }}>最大力 (eV/Å)</text>
        <g clipPath="url(#vfp-chart-clip)">
          <path d={energyPath} fill="none" stroke="#8884d8" strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(draw, 0.02)} />
          <path d={forcePath} fill="none" stroke="#82ca9d" strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(draw - 0.12, 0)} />
          {draw > 0.98 && energies.map((value, index) => <circle key={`ed${index}`} cx={x(steps[index])} cy={yEnergy(value)} r={3} fill="#8884d8" />)}
          {draw > 0.98 && forces.map((value, index) => <circle key={`fd${index}`} cx={x(steps[index])} cy={yForce(value)} r={3} fill="#82ca9d" />)}
        </g>
      </svg>
    </Reveal>
    <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}><i style={{ width: 16, height: 2, background: '#8884d8', display: 'inline-block' }} />{energyLabel}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}><i style={{ width: 16, height: 2, background: '#82ca9d', display: 'inline-block' }} />最大力</span>
    </div>
  </div>;
};

/* -------------------------------------------------------------- structure */

export const StructureCanvas: React.FC<{ scene: StructureScene; width?: number; height?: number; delay?: number; yaw?: number; pitch?: number; zoom?: number; showCell?: boolean }> = ({ scene, width = 620, height = 380, delay = 0, yaw, pitch, zoom, showCell = true }) => {
  const projected = projectScene(scene, { width, height, yaw, pitch, zoom });
  const appear = useProgress(delay + 4, 26);
  const elements = [...new Set(scene.atoms.map((atom) => atom.element))];
  const bonds = [...projected.bonds].sort((a, b) => a.depth - b.depth);
  const atoms = [...projected.atoms].sort((a, b) => a.depth - b.depth);
  return <div style={{ position: 'relative', width: '100%', height, background: 'var(--dsw-alias-bg-elevated, #f7f9fb)', border: '1px solid var(--dsw-alias-border-l2, #e8e8e8)' }}>
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="晶体结构">
      <defs>
        {elements.map((element) => <radialGradient key={element} id={`vfp-atom-${element.replace(/[^A-Za-z]/g, '')}`} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="38%" stopColor={atomColor(element)} stopOpacity="1" />
          <stop offset="100%" stopColor={atomColor(element)} stopOpacity="1" />
        </radialGradient>)}
      </defs>
      <g opacity={(1 - appear * 0.15)}>
        {showCell && projected.edges.map((edge, index) => <line key={`c${index}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke="#4d9fff" strokeWidth={1.1} opacity={0.35 + appear * 0.55} />)}
        {bonds.map((bond, index) => {
          const midX = (bond.x1 + bond.x2) / 2, midY = (bond.y1 + bond.y2) / 2;
          const c1 = bond.color1, c2 = bond.color2;
          return <g key={index} opacity={appear}>
            <line x1={bond.x1} y1={bond.y1} x2={midX} y2={midY} stroke={c1} strokeWidth={bond.radius * 2} strokeLinecap="round" />
            <line x1={midX} y1={midY} x2={bond.x2} y2={bond.y2} stroke={c2} strokeWidth={bond.radius * 2} strokeLinecap="round" />
          </g>;
        })}
        {projected.atoms.slice().sort((a, b) => a.depth - b.depth).map((atom) => <g key={atom.index} opacity={appear}>
          <circle cx={atom.x} cy={atom.y + 1} r={atom.radius * 1.05} fill="rgba(30,45,60,.10)" />
          <circle cx={atom.x} cy={atom.y} r={atom.radius} fill={`url(#vfp-atom-${atom.atom.element.replace(/[^A-Za-z]/g, '')})`} stroke="rgba(40,55,70,.35)" strokeWidth={0.6} />
        </g>)}
      </g>
    </svg>
  </div>;
};

export const StructureViewerInline: React.FC<{ scene: StructureScene; sourcePath: string; delay?: number; height?: number; yaw?: number; pitch?: number; zoom?: number }> = ({ scene, sourcePath, delay = 0, height = 380, yaw, pitch, zoom }) => {
  const summary = scene.summary;
  return <div>
    <div className="vfp-structure-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div className="vfp-source-location" title={sourcePath}>文件：{sourcePath}</div>
      <div className="vfp-structure-actions" style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
        <button type="button" className="vfp-structure-action">复位</button>
        <button type="button" className="vfp-structure-action">设置</button>
      </div>
    </div>
    <StructureCanvas scene={scene} height={height} delay={delay} yaw={yaw} pitch={pitch} zoom={zoom} />
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '7px 0 2px', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#65746b)' }}>
      <span>化学式 <strong style={{ color: 'var(--dsw-alias-label-primary,#1f2329)' }}>{summary.formula}</strong></span>
      <span>{summary.atom_count} 个原子</span>
      <span>晶格 {scene.cell.lengths.map((value) => value.toFixed(3)).join(' / ')} Å</span>
      <span>键 {scene.bonds.length} 条 · {scene.bond_families.map((family) => family.elements.join('–')).join('、') || '无'}</span>
    </div>
  </div>;
};

/* ------------------------------------------------------------- result tabs */

export const ResultTabs: React.FC<{
  rows: any[];
  kind: 'convergence' | 'structure';
  rootPath: string;
  active?: number;
  openPath?: string[];
  delay?: number;
  structureHeight?: number;
}> = ({ rows, kind, rootPath, active = 0, openPath = [], delay = 0, structureHeight = 380 }) => {
  const current = rows[active];
  const labelOf = (row: any) => kind === 'structure'
    ? `${(row.rel_path ?? row.relPath ?? '结构').split(/[\\/]/).filter(Boolean).at(-1) ?? '结构'} / ${row.file ?? 'CONTCAR'}`
    : (row.rel_path ?? row.relPath ?? '任务').split(/[\\/]/).filter(Boolean).at(-1) ?? '任务';
  const pathOf = (row: any) => `${row.rel_path ?? row.relPath ?? '.'}${kind === 'structure' ? `/${row.file ?? 'CONTCAR'}` : ''}`;
  return <div className="vfp-inline-visual">
    <div className="vfp-inline-tree">
      <PathTree items={rows} pathOf={pathOf} openPath={openPath} delay={delay} step={3}
        renderLeaf={(row, name) => <button type="button" className="vfp-visual-tree-leaf" data-user-added={row.userAdded ? '' : undefined} aria-current={rows.indexOf(row) === active ? 'true' : undefined}
          title={`${pathOf(row)} · 可拖到其他工具卡片`}>{name}</button>} />
    </div>
    <div className="vfp-visual-tabs" role="tablist" aria-label={kind === 'structure' ? '结构文件' : '计算任务'}>
      {rows.map((row, index) => <Reveal key={index} delay={delay + index * 3} y={6}>
        <button type="button" role="tab" data-user-added={row.userAdded ? '' : undefined} aria-selected={index === active} tabIndex={index === active ? 0 : -1} style={{ marginRight: 3 }}>{labelOf(row)}</button>
      </Reveal>)}
    </div>
    {kind === 'convergence'
      ? <ConvergenceChart series={current as ConvergenceSeries} delay={delay + 4} />
      : <StructureViewerInline scene={current as StructureScene} sourcePath={`${rootPath}/${current?.rel_path ?? ''}/${current?.file ?? 'CONTCAR'}`} delay={delay + 4} height={structureHeight} />}
  </div>;
};

export { num };
