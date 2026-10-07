/**
 * tool-cards.tsx — 对话里的工具结果卡片。
 *
 * 每个卡片主体都是 plugins/dsh-vaspflow/src/client/tool-rows.tsx 中同名组件的
 * 结构复刻：同样的 class、同样的字段读取、同样的分组与文案。差别只有两点，
 * 都因为这里是视频而不是浏览器：
 *   1. 分支由 props 决定，不再有 useState / fetch / sessionStorage；
 *   2. 每一行用 Remotion 的 Reveal 做入场，好让逐帧渲染有节奏。
 */
import React from 'react';
import { Reveal } from '../motion';
import { IssueRows, PathTree, PieBreakdown, ScanBar, ScanLegend } from './primitives';
import { ResultTabs } from './visuals';
import { checkCategories, profileNames, scanStates, scanTypes, titles } from './tokens';

/* ------------------------------------------------------------------ 卡片外壳 */

export const ToolCard: React.FC<{
  toolName: string;
  title?: string;
  status?: string;
  /** 首行右侧的紧凑摘要，折叠态才显示（对应 compactSummary）。 */
  compactSummary?: string;
  collapsed?: boolean;
  delay?: number;
  children?: React.ReactNode;
}> = ({ toolName, title, status = '完成', compactSummary, collapsed = false, delay = 0, children }) => (
  <Reveal delay={delay} y={16} duration={22}>
    <div data-dsh-vaspflow-tool={toolName}>
      <div className="vfp-tree-head">
        <button type="button" className="vfp-card-toggle" aria-expanded={!collapsed}>
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <strong>{title ?? titles[toolName]}</strong>
        </button>
        <span className="vfp-tree-muted">{collapsed && compactSummary ? `完成 · ${compactSummary}` : status}</span>
      </div>
      {!collapsed && <div>{children}</div>}
    </div>
  </Reveal>
);

/* -------------------------------------------------------------------- scan */

export const ScanOverviewView: React.FC<{ value: any; delay?: number; selectedCode?: string }> = ({ value, delay = 0, selectedCode }) => {
  const tasks: any[] = Array.isArray(value.tasks) ? value.tasks : [];
  const directories: any[] = Array.isArray(value.directories) ? value.directories : [];
  const total = tasks.length;
  const stateOf = (task: any) => scanStates.some(([code]) => code !== 'UNKNOWN' && code === task.status_record?.code) ? task.status_record.code : 'UNKNOWN';
  const typeOf = (task: any) => scanTypes.some(([code]) => code !== 'OTHER' && code === task.task_type?.code) ? task.task_type.code : 'OTHER';
  const states = scanStates.map(([code, label, color]) => ({ code, label, color, count: tasks.filter((task) => stateOf(task) === code).length }));
  const types = scanTypes.map(([code, label, color]) => ({ code, label, color, count: tasks.filter((task) => typeOf(task) === code).length }));
  const shown = selectedCode ? tasks.filter((task) => stateOf(task) === selectedCode) : tasks;
  const filterLabel = selectedCode ? states.find((item) => item.code === selectedCode)?.label : undefined;
  return <div className="vfp-overview">
    <Reveal delay={delay} y={8}><div className="vfp-scan-path">扫描目录：<code>{value.rootPath || '未知'}</code></div></Reveal>
    <Reveal delay={delay + 3} y={8}><div className="vfp-scan-stats"><strong>{directories.length}</strong> 个子目录（含任务目录） · <strong>{total}</strong> 个 VASP 任务</div></Reveal>
    <div className="vfp-pie-grid">
      <PieBreakdown title="计算状态" items={states} selectedCode={selectedCode} delay={delay + 6} />
      <PieBreakdown title="任务类型" items={types} delay={delay + 18} />
    </div>
    <Reveal delay={delay + 30} y={8}>
      <div className="vfp-discovery-heading">任务目录 <span>{filterLabel ? `${filterLabel} · ${shown.length}/${total} 个任务` : `${total} 个任务，点击查看详情`}</span></div>
    </Reveal>
    <IssueRows delay={delay + 34} step={3} openPath={[]} rows={shown.map((task) => ({
      path: task.rel_path,
      label: task.label || task.rel_path,
      note: task.status_record?.label || task.task_type?.label,
      status: task.status_record?.code === 'ERROR_DETECTED' ? 'error' : task.status_record?.code === 'UNKNOWN' ? 'warn' : undefined,
    }))} />
  </div>;
};

/* --------------------------------------------------------- 状态核查（批量） */

export const StatusInspectionView: React.FC<{ value: any; delay?: number; openPath?: string[] }> = ({ value, delay = 0, openPath = [] }) => {
  const results: any[] = Array.isArray(value.results) ? value.results : [];
  const counts = scanStates.map(([code, label, color]) => ({ code, label, color, count: results.filter((row) => row.status?.code === code).length }));
  const failed = results.filter((row) => row.error).length;
  return <div className="vfp-status-inspection">
    <Reveal delay={delay} y={8}><div className="vfp-tool-intent">读取任务的计算输出与状态证据；不重新校验输入文件。</div></Reveal>
    <Reveal delay={delay + 3} y={8}><div className="vfp-scan-path">项目目录：<code>{value.rootPath || '未知'}</code> · 查看 {results.length} 个任务{failed ? ` · ${failed} 个目录读取失败` : ''}</div></Reveal>
    <ScanBar counts={counts} total={results.length} delay={delay + 6} />
    <ScanLegend counts={counts} delay={delay + 10} />
    <div className="vfp-inspection-list">
      <PathTree items={results} pathOf={(row: any) => row.relPath ?? row.rel_path} openPath={openPath} delay={delay + 14} step={4}
        renderLeaf={(row: any, name: string) => <details className="vfp-inspection-item" open>
          <summary title="可拖到收敛曲线、原子结构或计算状态卡片">
            <strong>{name}</strong>
            <span className="vfp-state-chip" data-status={row.error ? 'error' : row.status?.code}>{row.error ? '读取失败' : row.status?.label || '状态未知'}</span>
            <small>{row.error || row.status?.reason || ''}</small>
          </summary>
          <div className="vfp-inspection-detail">
            <div><b>状态依据</b>{row.status?.evidence?.length ? row.status.evidence.map((item: any, i: number) => <span key={i}>{item.file ? `${item.file}：` : ''}{item.message ?? item.excerpt ?? '证据'}</span>) : <span>没有更多输出证据</span>}</div>
            <div><b>发现的输出文件</b><span>{row.outputFiles?.length ? row.outputFiles.map((file: any) => file.path ?? file.name).join('、') : '未发现'}</span></div>
            <div><b>先前输入检查</b><span>{row.inputCheck?.profileId ? `${row.inputCheck.profileId} · ${row.inputCheck.label}` : '无记录；本工具不检查输入正确性'}</span></div>
            {Number.isFinite(row.fileCount) && <div><b>目录文件</b><span>{row.fileCount} 个；文件内容请在任务详情中查看</span></div>}
          </div>
        </details>} />
    </div>
  </div>;
};

/* -------------------------------------------------------------- 输入检查 */

const basicFailure = (row: any) => row.poscarPotcar !== 'OK' || typeof row.incar !== 'object' || !row.incar
  || /MISSING|UNREADABLE/.test(String(row.kpoints)) || /PARSE_ERROR|COUNT_MISMATCH|FLAG_MISSING/.test(String(row.sd));

export const InputChecksView: React.FC<{ value: any; args?: any; delay?: number; openPath?: string[]; expandIndex?: number }> = ({ value, args = {}, delay = 0, openPath = [], expandIndex = 4 }) => {
  const results: any[] = Array.isArray(value.results) ? value.results : [];
  const profileId = value.profileId || args.profileId || '';
  const statusOf = (row: any) => row.error || basicFailure(row) ? 'FILE_FAIL'
    : row.input_check?.code === 'FAIL' ? 'RULE_FAIL'
      : row.input_check?.code === 'WARN' || row.warnings?.length ? 'WARN'
        : row.input_check?.code === 'PASS' ? 'PASS' : 'NOT_REQUESTED';
  const counts = checkCategories.map(([code, label, color]) => ({ code, label, color, count: results.filter((row) => statusOf(row) === code).length }));
  const checkedRows = results.map((row, index) => ({
    row, index,
    path: typeof row.resolved === 'string'
      ? String(row.resolved).replace(value.rootPath, '').replace(/^[\\/]/, '') || '.'
      : args.dirs?.[index] ?? row.dir ?? `任务 ${index + 1}`,
  }));
  return <div className="vfp-input-checks">
    <Reveal delay={delay} y={8}><div className="vfp-scan-path"><code>{value.rootPath || '未知目录'}</code> · {results.length} 个目录{profileId ? ` · ${profileNames[profileId] ?? profileId}` : ''}</div></Reveal>
    <ScanBar counts={counts} total={results.length} delay={delay + 4} />
    <ScanLegend counts={counts} delay={delay + 8} />
    <div className="vfp-inspection-list">
      <PathTree items={checkedRows} pathOf={(item: any) => item.path} openPath={openPath} delay={delay + 12} step={4}
        renderLeaf={({ row, index }: any, name: string) => {
          const state = statusOf(row);
          const fields: [string, any][] = [
            ['POSCAR ↔ POTCAR', row.poscarPotcar === 'OK' ? `元素顺序一致${row.species?.length ? `：${row.species.join(' → ')}` : ''}` : row.poscarPotcar],
            ['选择性动力学', row.sd],
            ['KPOINTS', row.kpoints],
          ];
          const checks: [string, string][] = [
            ['结构', row.poscarPotcar === 'OK' ? 'ok' : 'bad'],
            ['SD', row.sd === '-' || row.sd === '?' || /PARSE_ERROR|COUNT_MISMATCH|FLAG_MISSING/.test(String(row.sd)) ? 'bad' : 'ok'],
            ['INCAR', typeof row.incar === 'object' && row.incar ? 'ok' : 'bad'],
            ['KPOINTS', row.kpoints === '-' || row.kpoints === '?' || /MISSING|UNREADABLE/.test(String(row.kpoints)) ? 'bad' : 'ok'],
            ['规则', profileId ? row.input_check?.code === 'PASS' ? 'ok' : row.input_check?.code === 'WARN' ? 'warn' : 'bad' : 'skip'],
          ];
          return <details className="vfp-inspection-item" open={index === expandIndex}>
            <summary title={`${row.resolved} · 可拖到其他工具卡片`}>
              <strong>{name}</strong>
              <span className="vfp-state-chip" data-status={state === 'FILE_FAIL' || state === 'RULE_FAIL' ? 'FAIL' : state}>
                {state === 'PASS' ? '规则通过' : state === 'WARN' ? '注意' : state === 'RULE_FAIL' ? '规则未过' : state === 'FILE_FAIL' ? '文件异常' : '已解析'}
              </span>
              {state !== 'PASS' && <small>{row.error || row.input_check?.evidence?.[0]?.message || row.warnings?.[0] || ''}</small>}
              <span className="vfp-check-matrix">{checks.map(([label, code]) => <span key={label} data-check={code}><i />{label}</span>)}</span>
            </summary>
            <div className="vfp-inspection-detail">
              {fields.map(([label, text]) => <div key={label}><b>{label}</b><span>{String(text ?? '未读取')}</span></div>)}
              <div><b>INCAR 参数</b><span>{typeof row.incar === 'object' && row.incar ? Object.entries(row.incar).map(([key, val]) => `${key}=${val}`).join(' · ') || '未提取到关键参数' : String(row.incar ?? '未读取')}</span></div>
              {row.input_check?.evidence?.length > 0 && <div><b>规则依据</b>{row.input_check.evidence.map((item: any, i: number) => <span key={i}>{item.message ?? item.ruleId}</span>)}</div>}
            </div>
          </details>;
        }} />
    </div>
    {value.consistency?.uniform === false && <Reveal delay={delay + 34} y={8}>
      <div className="vfp-discovery-foot vfp-tree-muted">发现 {value.consistency.groups?.length ?? 0} 种输入模式，请核对目录间差异。</div>
    </Reveal>}
  </div>;
};

/* ------------------------------------------------------------ 数据收集 */

export const CollectedResultsView: React.FC<{ value: any; delay?: number; openPath?: string[] }> = ({ value, delay = 0, openPath = [] }) => {
  const rows: any[] = Array.isArray(value.rows) ? value.rows : [];
  const excluded: any[] = Array.isArray(value.excluded) ? value.excluded : [];
  const metrics: string[] = value.query?.metrics ?? [];
  const parentOf = (row: any) => row.relPath.split(/[\\/]+/).slice(0, -1).join('/').toLowerCase();
  const parents = [...new Set(rows.map(parentOf))];
  const energyScales = new Map(parents.map((parent) => {
    const members = rows.filter((row) => parentOf(row) === parent);
    const energies = members.map((row) => row.values?.last_ionic_free_energy?.value).filter((energy) => typeof energy === 'number' && Number.isFinite(energy));
    const low = energies.length ? Math.min(...energies) : 0;
    const high = energies.length ? Math.max(...energies) : 0;
    const padding = high > low ? (high - low) * 0.04 : 0.002;
    return [parent, { hasEnergy: energies.length > 0, axisMin: low - padding, axisMax: high + padding }] as const;
  }));
  const number = (item: any, digits: number) => item?.status === 'ok' && typeof item.value === 'number' ? item.value.toFixed(digits) : '—';
  return <div className="vfp-collect">
    <Reveal delay={delay} y={8}><div className="vfp-scan-path"><code>{value.rootPath}</code> · 弛豫 · {rows.length} 个任务{excluded.length ? ` · ${excluded.length} 个排除` : ''}</div></Reveal>
    <Reveal delay={delay + 3} y={8}><div className="vfp-collect-scope">
      {(value.query?.scope?.subtrees ?? []).map((item: any) => `${item.relPath} ↓${item.maxDepth} 层`).concat((value.query?.scope?.taskPaths ?? []).map((item: string) => `精确 ${item}`)).join(' · ')}
      {metrics.includes('last_ionic_free_energy') ? ' · 末步 F / eV（同一父目录共用能量轴）' : ''}
    </div></Reveal>
    <PathTree items={rows} pathOf={(row: any) => row.relPath} openPath={openPath} delay={delay + 6} step={4}
      renderLeaf={(row: any, name: string) => {
        const { axisMin, axisMax } = energyScales.get(parentOf(row))!;
        const vals = row.values ?? {};
        const energy = vals.last_ionic_free_energy;
        const pos = energy?.status === 'ok' ? (energy.value - axisMin) / (axisMax - axisMin) * 100 : 50;
        return <button type="button" className="vfp-collect-item" title={`${row.relPath} · 在右侧查看任务详情`}>
          <span className="vfp-collect-name" title={row.relPath}>{name}</span>
          {metrics.includes('last_ionic_free_energy') && <>
            <span className="vfp-collect-track" data-range="" data-min={axisMin.toFixed(3)} data-max={axisMax.toFixed(3)}>
              {energy?.status === 'ok' && <i style={{ left: `${pos}%` }} />}
            </span>
            <b className="vfp-collect-energy">{number(energy, 6)} eV</b>
          </>}
          {metrics.includes('last_max_force') && <span className="vfp-collect-force">力 {number(vals.last_max_force, 3)}</span>}
          {metrics.includes('ionic_steps') && <span className="vfp-collect-steps">{number(vals.ionic_steps, 0)} 步</span>}
        </button>;
      }} />
    {excluded.length > 0 && <Reveal delay={delay + 40} y={8}>
      <details className="vfp-collect-excluded" open><summary>未纳入 {excluded.length}</summary>
        {excluded.map((item, index) => <div key={index}>{item.relPath} · {item.reason}</div>)}
      </details>
    </Reveal>}
  </div>;
};

/* ------------------------------------------------------------ 发现材料 */

export const InputDiscoveryView: React.FC<{ value: any; args?: any; delay?: number; openPath?: string[]; openGroup?: number }> = ({ value, args = {}, delay = 0, openPath = [], openGroup = 0 }) => {
  const sources: any[] = value.sources?.files ?? [];
  const templates: any[] = value.templates ?? [];
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
  const relativeTo = (rootPath: string, filePath: string) => filePath.toLowerCase().startsWith(rootPath.toLowerCase())
    ? filePath.slice(rootPath.length).replace(/^[\\/]/, '') : filePath;
  return <div className="vfp-discovery">
    <Reveal delay={delay} y={8}><div className="vfp-tool-intent">按目录和深度寻找两类构建材料：结构文件供 POSCAR 使用，含 INCAR 的目录供参数等文件使用；这里只盘点候选。</div></Reveal>
    <Reveal delay={delay + 3} y={8}><div className="vfp-scan-path">搜索范围：<code>{value.rootPath || '未知'}</code> · 最深 {args.maxDepth ?? 10} 层</div></Reveal>
    <div className="vfp-source-flow">
      <Reveal delay={delay + 6} y={10}>
        <div><strong>{requested.includes('sources') ? sources.length : '—'}</strong><span>结构文件</span><small>{requested.includes('sources') ? '*.vasp / POSCAR / CONTCAR → 可作为新任务的 POSCAR' : '本次未搜索'}</small></div>
      </Reveal>
      <b aria-hidden="true">＋</b>
      <Reveal delay={delay + 10} y={10}>
        <div><strong>{requested.includes('templates') ? templates.length : '—'}</strong><span>模板目录</span><small>{requested.includes('templates') ? '含 INCAR；可提供参数、K 点、赝势与脚本' : '本次未搜索'}</small></div>
      </Reveal>
    </div>
    <section className="vfp-discovery-section">
      <Reveal delay={delay + 14} y={8}><div className="vfp-discovery-heading">结构类型 <span>{sourceGroups.size} 组 · 按元素、坐标类型和选择性动力学标记归并</span></div></Reveal>
      {[...sourceGroups.values()].sort((a, b) => b.length - a.length).map((members, index) => {
        const example = members[0];
        const label = `${example.elements?.join(' · ') || '未识别物种'} · ${example.coordType || '未知坐标'} · ${example.hasSd ? `SD ${example.fFlags} 固定 / ${example.tFlags} 放开` : '无 SD'}`;
        return <Reveal key={index} delay={delay + 18 + index * 4} y={8}>
          <details className="vfp-distribution-row" open={index === openGroup}>
            <summary><span>{label}</span><strong>{members.length}</strong><i style={{ width: `${members.length / Math.max(sources.length, 1) * 100}%` }} /></summary>
            <PathTree items={members} pathOf={(source: any) => relativeTo(value.rootPath, source.path)} openPath={openPath} delay={delay + 20} step={2}
              renderLeaf={(source: any, name: string) => <button type="button" className="vfp-source-file" title={`${source.path} · 可拖到结构或构建卡片`}>
                <span>{name}</span><small>{source.error || `${source.nAtoms ?? 0} 原子`}</small><span>预览 ›</span>
              </button>} />
          </details>
        </Reveal>;
      })}
      {sources.length === 0 && <div className="vfp-tree-muted">没有找到结构文件</div>}
    </section>
    <section className="vfp-discovery-section">
      <Reveal delay={delay + 30} y={8}><div className="vfp-discovery-heading">模板目录文件覆盖 <span>每条表示 {templates.length} 个候选目录中有多少个包含该文件</span></div></Reveal>
      <div className="vfp-coverage">
        {coverage.map(([label, matches], index) => {
          const count = templates.filter(matches).length;
          return <Reveal key={label} delay={delay + 33 + index * 3} y={6}>
            <div><span>{label}</span><div><i style={{ width: `${count / Math.max(templates.length, 1) * 100}%` }} /></div><strong>{count}/{templates.length}</strong></div>
          </Reveal>;
        })}
      </div>
      <Reveal delay={delay + 45} y={8}><div className="vfp-discovery-heading">INCAR 参数组合 <span>{templateGroups.size} 组；目录数不等于参数方案数</span></div></Reveal>
      {[...templateGroups.entries()].map(([signature, members], index) => <Reveal key={signature} delay={delay + 48 + index * 4} y={8}>
        <details className="vfp-template-group" open={index === 0}>
          <summary><strong>方案 {index + 1}</strong><span>{members.length} 个目录</span><span className="vfp-tree-muted">{Object.entries(members[0]?.params ?? {}).map(([key, val]) => `${key} ${val}`).join(' · ') || '未提取到关键参数'}</span></summary>
          <div className="vfp-discovery-list">
            {members.map((template: any) => <div key={template.dir} title={`${template.dir} · 可拖到构建卡片替换模板`}>
              <code title={template.dir}>{template.relPath ?? template.dir}</code>
              <span>{template.missing?.length ? `缺 ${template.missing.join('、')}` : '所列文件齐备'}</span>
            </div>)}
          </div>
        </details>
      </Reveal>)}
    </section>
    <Reveal delay={delay + 62} y={8}><div className="vfp-tree-muted vfp-discovery-foot">“缺项”表示该模板目录里未找到对应文件；提交脚本是可选项。两类候选尚未配对或选用，也未验证科学合理性。</div></Reveal>
  </div>;
};

/* -------------------------------------------------------------- 构建预览 */

export const BuildCard: React.FC<{
  value: any;
  tasks: any[];
  delay?: number;
  phase?: 'preview' | 'done';
  selected?: number[];
  focused?: number;
}> = ({ value, tasks, delay = 0, phase = 'preview', selected = [0, 1, 3, 4, 5], focused = 1 }) => {
  const preview = value.preview;
  const writeRows = preview.results ?? [];
  const selectedErrors = selected.filter((index) => writeRows[index]?.errors?.length).length;
  const rowStatus = (index: number) => {
    const row = writeRows[index];
    return row?.errors?.length ? 'error' : row?.warnings?.length ? 'warn' : 'ok';
  };
  const rowLabel = (index: number) => {
    const row = writeRows[index];
    if (row?.errors?.length) return '错误';
    if (phase === 'done') return selected.includes(index) ? '已写入' : '未写入';
    return row?.warnings?.length ? '需注意' : '可构建';
  };
  const status = phase === 'done'
    ? `已写入 ${selected.length}/${selected.length} · ${tasks.length} 个任务`
    : `待确认预览 · ${tasks.length} 个任务${selectedErrors ? ` · ${selectedErrors} 错误` : ''}`;
  return <div data-dsh-vaspflow-tool="vasp_build_inputs">
    <div className="vfp-tree-head">
      <button type="button" className="vfp-card-toggle" aria-expanded><span aria-hidden="true">▾</span><strong>构建任务</strong></button>
      <span className="vfp-tree-muted">{status}</span>
    </div>
    <div>
      <Reveal delay={delay} y={8}><div className="vfp-scan-path"><code>{preview.projectRoot}</code></div></Reveal>
      <Reveal delay={delay + 3} y={8}>
        <div className="vfp-build-steps" aria-label="构建进度">
          <span data-stage="done">① 预览已生成</span>
          <span data-stage={phase === 'preview' ? 'current' : 'done'}>② {phase === 'preview' ? '等待确认' : '已确认'}</span>
          <span data-stage={phase === 'done' ? 'done' : 'pending'}>③ {phase === 'done' ? `已写入 ${selected.length}/${selected.length}` : '尚未写入'}</span>
        </div>
      </Reveal>
      <div className="vfp-tree-shell">
        <div className="vfp-build-tree vfp-path-tree">
          <details className="vfp-path-root vfp-path-folder" open>
            <summary><span>根目录</span><small>{tasks.length}</small></summary>
            <div className="vfp-path-children">
              {tasks.map((task, index) => <div className="vfp-path-leaf" key={task.dir}>
                <Reveal delay={delay + 6 + index * 4} y={7}>
                  <div className="vfp-tree-task" data-selected={focused === index ? '' : undefined} title="拖入结构文件替换 POSCAR 来源；拖入含 INCAR 的目录替换模板来源并重算预览">
                    <input type="checkbox" checked={selected.includes(index)} readOnly aria-label={`选择 ${task.dir}`} />
                    <button type="button" className="vfp-tree-open" aria-label={`在右侧查看 ${task.dir} 详情`}>
                      <span className="vfp-tree-name">{task.dir}</span>
                      <span className="vfp-tree-status" data-status={rowStatus(index)}>{rowLabel(index)}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                  </div>
                </Reveal>
              </div>)}
            </div>
          </details>
        </div>
      </div>
      {phase === 'preview' && <Reveal delay={delay + 34} y={8}>
        <div className="vfp-tree-actions">
          <span>{selected.length} 个任务已选中{selectedErrors ? ` · ${selectedErrors} 个任务存在错误` : ''}</span>
          <span>
            <button type="button">取消预览</button>
            <button type="button" title="执行本次所选任务，并让后续 AI 调用直接构建">交给 AI 直接构建</button>
            <button type="button" className="vfp-tree-confirm" disabled={selectedErrors > 0}>确认构建 {selected.length} 个任务</button>
          </span>
        </div>
      </Reveal>}
      {phase === 'done' && <Reveal delay={delay + 34} y={8}>
        <div className="vfp-tree-actions">
          <span>{selected.length} 个任务已选中</span>
          <span><button type="button" className="vfp-tree-confirm" disabled>已完成</button></span>
        </div>
        <div className="vfp-tree-message">已写入 {selected.length}/{selected.length} 个任务</div>
      </Reveal>}
    </div>
  </div>;
};

export { ResultTabs };
