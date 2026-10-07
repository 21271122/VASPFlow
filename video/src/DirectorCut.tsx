/**
 * 78 秒导演版。分镜和逐字文案来自《新版介绍片大纲与逐句文案.md》。
 * 演示数据全部取自 fixtures；此片不接触真实工作目录。
 */
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import './cards/cards.css';
import './DirectorCut.css';
import {ToolCard} from './cards/tool-cards';
import {ConvergenceChart, ResultTabs} from './cards/visuals';
import {buildScene, siCScene, type Vec3} from './cards/scene';
import {ROOT, collectValue, convergenceValue, scanValue} from './cards/fixtures';

const FPS = 30;
export const DIRECTOR_CUT_DURATION = 78 * FPS;
const FONT = '"Segoe UI","Microsoft YaHei",system-ui,sans-serif';
const stateColors = ['#43b58c','#e5a93a','#df6058','#a8aec0','#8a9cbc'];
const states = [
  ['已完成',9], ['运行中',2], ['检测到错误',1], ['未见计算输出',1], ['状态未知',1],
] as const;
const types = [
  ['结构优化',10], ['静态 / SCF',1], ['NEB',1], ['频率 / ZPE',1], ['AIMD',1],
] as const;
const tasks = scanValue.tasks;
const energyRows = collectValue.rows.slice(0,4);
const eMin = -173.055, eMax = -172.858;
const secondConvergence = {
  ...convergenceValue.results[0],
  rel_path:'slab-02-relax',
  source_path:'slab-02-relax/OSZICAR',
  energies:convergenceValue.results[0].energies.map((n,i)=>n+0.0587+Math.sin(i*.5)*.003),
  max_forces:convergenceValue.results[0].max_forces.map((n,i)=>n*(i<10?1.18:1.03)),
};
const curves = [convergenceValue.results[0],secondConvergence];
const baseAtoms = siCScene.atoms.filter((atom)=>!atom.is_periodic_image);
const ohScene = buildScene({
  lattice:siCScene.cell.vectors as Vec3[],
  species:[...baseAtoms.map((atom)=>atom.element),'O','H'],
  fracCoords:[...baseAtoms.map((atom)=>atom.fractional_position),[0.5,0.5,0.72],[0.53,0.53,0.75]] as Vec3[],
  numAtoms:baseAtoms.length+2,
});
const addedStructure = {...ohScene, rel_path:'ads-OH-relax',file:'CONTCAR',userAdded:true};
const structures = [{...siCScene,rel_path:'slab-01-relax',file:'CONTCAR'},addedStructure];

function Caption({children}: {children:React.ReactNode}) {
  return <div className="dc-caption">{children}</div>;
}
function User({children}: {children:React.ReactNode}) {
  return <div className="dc-user"><span>{children}</span></div>;
}
function App({children, side, bodyClass=''}: {children:React.ReactNode;side?:React.ReactNode;bodyClass?:string}) {
  return <div className="dc-app" style={{
    '--dsw-font-family':FONT,
    '--dsw-alias-label-primary':'#1f2937',
    '--dsw-alias-label-secondary':'#5c697c',
    '--dsw-alias-label-tertiary':'#8c97a7',
    '--dsw-alias-border-l2':'#dce4ed',
    '--dsw-alias-bg-base':'#ffffff',
    '--dsw-alias-bg-elevated':'#f5f8fc',
  } as React.CSSProperties}>
    <div className="dc-app-head"><div className="dc-app-mark">✧</div><strong>VASP 计算助手</strong><span>SiC-slab-study</span><div className="dc-head-status">● 项目已连接</div></div>
    <div className={'dc-app-body '+bodyClass}><main>{children}</main>{side && <aside className="dc-side">{side}</aside>}</div>
  </div>;
}
function Stage({children,index}: {children:React.ReactNode;index:string}) {
  return <AbsoluteFill className="dc-stage">
    <div className="dc-stage-grid"/>
    <div className="dc-episode">VASPFLOW <span> / </span> {index}</div>
    {children}
  </AbsoluteFill>;
}
function Card({title,children,status='完成'}:{title:string;children:React.ReactNode;status?:string}) {
  return <ToolCard toolName="vasp_scan" title={title} status={status}>{children}</ToolCard>;
}
function Donut({title,parts,colors=stateColors,highlight=-1}:{title:string;parts:readonly (readonly [string,number])[];colors?:string[];highlight?:number}) {
  const total=parts.reduce((n,p)=>n+p[1],0);
  let cursor=0;
  const gradient=parts.map((p,i)=>{const start=cursor;cursor+=p[1]/total*100;return `${colors[i]} ${start}% ${cursor}%`;}).join(',');
  return <div className="dc-donut-panel">
    <h3>{title}</h3>
    <div className="dc-donut-body">
      <div className="dc-donut" style={{background:`conic-gradient(${gradient})`}}><div className="dc-donut-core"><b>{total}</b><small>个任务</small></div></div>
      <div className="dc-donut-legend">{parts.map(([label,count],i)=><div key={label} className={highlight===i?'dc-highlight':''}><i style={{background:colors[i]}}/><span>{label}</span><b>{count}</b></div>)}</div>
    </div>
  </div>;
}
function ScanTree({selected,expanded=false}:{selected?:string;expanded?:boolean}) {
  const visible=expanded?tasks.slice(0,8):tasks.slice(0,4);
  return <div className="dc-directory">
    <div className="dc-directory-head">任务目录 <span>点击任务，右侧查看详情</span></div>
    <div className="dc-folder">▾ <strong>SiC-slab-study</strong><small>14</small></div>
    <div className="dc-tree-children">
      {visible.map(t=><div className={'dc-task '+(selected===t.rel_path?'dc-selected':'')} key={t.rel_path}>
        <span className="dc-tree-branch">├─</span><strong>{t.rel_path}</strong>
        <span data-status={t.status_record.code}>{t.status_record.label}</span>
      </div>)}
    </div>
  </div>;
}
function Scene01() {
  const f=useCurrentFrame();
  return <Stage index="01 · 看见全局"><App><User>帮我看看 SiC-slab-study 里有哪些计算任务。</User>
    {f>48&&<Card title="扫描计算目录" status={f<96?'扫描中':'完成'}>
      <div className="dc-path">{ROOT}</div><div className="dc-large-count">{f>95?'14 个 VASP 任务':'正在读取计算目录…'}</div>
      {f>105&&<div className="dc-scan-preview"><span>计算状态</span><span>任务类型</span><span>任务目录</span></div>}
    </Card>}</App><Caption>一个项目有多少任务？先看全局。</Caption></Stage>;
}
function Scene02() {
  const f=useCurrentFrame();
  return <Stage index="02 · 看见全局"><App><Card title="扫描计算目录">
    <div className="dc-path">{ROOT}</div><div className="dc-large-count">14 个 VASP 任务</div>
    <div className="dc-donuts"><Donut title="计算状态" parts={states} highlight={f>95&&f<190?0:-1}/><Donut title="任务类型" parts={types} colors={['#4f8fd2','#6c9dc4','#ad80cf','#d9a85a','#88b09d']}/></div>
    {f>160&&<ScanTree expanded={false}/>}
  </Card></App><Caption>状态、类型和目录层级，放在同一张卡片里。</Caption></Stage>;
}
function Evidence() {
  return <div className="dc-evidence">
    <div className="dc-evidence-head">任务详情 <span>计算状态</span></div>
    <h2>slab-07-relax</h2>
    <div className="dc-evidence-status">● 检测到错误</div>
    <div className="dc-evidence-section"><h3>状态依据</h3>
      <div className="dc-evidence-line"><b>OUTCAR</b><strong>检测到 ZBRENT 错误</strong></div>
      <div className="dc-evidence-note">ZBRENT: fatal error in bracketing</div>
    </div>
    <div className="dc-evidence-section"><h3>计算输出</h3><div>OUTCAR · OSZICAR · CONTCAR</div></div>
  </div>;
}
function Scene03() {
  const f=useCurrentFrame();
  return <Stage index="03 · 找到依据"><App side={f>70?<Evidence/>:<div className="dc-side-empty">选择任务以查看详情</div>}>
    <Card title="扫描计算目录"><div className="dc-path">{ROOT}</div><div className="dc-large-count">14 个 VASP 任务</div>
      <div className="dc-mini-stats">已完成 9　　运行中 2　　检测到错误 1</div>
      <ScanTree expanded selected={f>42?'slab-07-relax':undefined}/>
      {f>42&&<div className="dc-selected-summary">slab-07-relax · 检测到错误</div>}
    </Card></App><Caption>点一个任务，右侧就能看到状态依据。</Caption></Stage>;
}
function EnergyPlot() {
  return <div className="dc-energy-plot">
    <div className="dc-energy-heading"><strong>末步自由能 F / eV</strong><span>同组成 SiC · 共用能量轴</span></div>
    <div className="dc-energy-axis"><span>{eMin.toFixed(3)}</span><span>{eMax.toFixed(3)}</span></div>
    <div className="dc-folder">▾ <strong>SiC-slab-study</strong><small>4</small></div>
    {energyRows.map((r,i)=>{
      const energy=r.values.last_ionic_free_energy.value as number;
      const pct=(energy-eMin)/(eMax-eMin)*100;
      return <div className="dc-energy-row" key={r.relPath}>
        <div className="dc-energy-name"><span>├─</span> {r.relPath}</div>
        <div className="dc-energy-track"><i style={{left:`${pct}%`}}/></div>
        <b>{energy.toFixed(4)} eV</b>
      </div>;
    })}
    <div className="dc-energy-foot">点击任务，右侧查看计算详情</div>
  </div>;
}
function Scene04() {
  return <Stage index="04 · 读懂结果"><App><User>汇总 slab-01 到 slab-04 的末步能量。</User>
    <Card title="查看弛豫数据"><div className="dc-path">{ROOT} · 4 个弛豫任务</div><EnergyPlot/></Card>
    </App><Caption>每个点对应一个任务。能量差异，一眼可见。</Caption></Stage>;
}
function Scene05() {
  const f=useCurrentFrame();
  const active=f<180?0:1;
  return <Stage index="05 · 读懂结果"><App><User>这几个任务的收敛过程呢？</User>
    <Card title="查看收敛曲线"><div className="dc-path">{ROOT} · 2 个任务</div>
      <div className="dc-curve-tabs"><button data-active={active===0}>slab-01-relax</button><button data-active={active===1}>slab-02-relax</button></div>
      <div className="dc-curve-legend"><span><i style={{background:'#8884d8'}}/>相对能量</span><span><i style={{background:'#82ca9d'}}/>最大力</span><small>←　→ 切换任务</small></div>
      <div className="dc-chart"><ConvergenceChart series={curves[active]} width={1330} height={320}/></div>
    </Card></App><Caption>曲线就在卡片里。一个任务，一页结果。</Caption></Stage>;
}
function FileList({highlight=false}: {highlight?:boolean}) {
  return <div className="dc-file-list"><div className="dc-evidence-head">项目文件 <span>结构文件</span></div>
    <div className="dc-file-item">▾　SiC-slab-study</div>
    <div className="dc-file-item">　　slab-01-relax / CONTCAR</div>
    <div className={'dc-file-item '+(highlight?'dc-file-highlight':'')}>　　ads-OH-relax/CONTCAR</div>
    <div className="dc-file-item">　　bulk-SiC-scf / POSCAR</div>
  </div>;
}
function DragPill({text,progress,from,to}:{text:string;progress:number;from:[number,number];to:[number,number]}) {
  return <div className="dc-drag-pill" style={{
    left:interpolate(progress,[0,1],[from[0],to[0]]),
    top:interpolate(progress,[0,1],[from[1],to[1]]),
  }}>{text}</div>;
}
function Scene06() {
  const f=useCurrentFrame();
  const moving=f>=125&&f<=205;
  const dropped=f>205;
  const active=f>235?1:0;
  return <Stage index="06 · 改变视角"><App side={<FileList highlight={f>85&&!dropped}/>}><Card title="查看原子结构">
    <div className="dc-structure-wrap"><ResultTabs rows={dropped?structures:[structures[0]]} kind="structure" rootPath={ROOT} active={active} structureHeight={370}/></div>
    {moving&&<div className="dc-drop-hint">松开以添加结构</div>}
    {dropped&&<div className="dc-added-note">黄色标签：本次手动加入</div>}
    </Card></App>
    {moving&&<DragPill text="ads-OH-relax/CONTCAR" progress={(f-125)/80} from={[1510,350]} to={[910,425]}/>}
    <Caption>再拖入一份结构，卡片就多一个标签页。</Caption></Stage>;
}
function BuildPreview({changed,done,confirming}:{changed:boolean;done:boolean;confirming:boolean}) {
  return <Card title="构建任务" status={done?'完成':changed?'待确认':'预览'}>
    <div className="dc-path">{ROOT}</div>
    <div className="dc-build-info">新建任务　<strong>slab-08-relax</strong></div>
    <div className="dc-build-tree"><div className="dc-folder">▾ <strong>SiC-slab-study</strong><small>1</small></div>
      <div className="dc-task dc-build-target"><span className="dc-tree-branch">└─</span><strong>slab-08-relax</strong><span>{done?'已写入':changed?'预览已更新':'待预览'}</span></div>
    </div>
    <div className="dc-build-sources"><div>结构来源 <b>templates/POSCAR_SiC_2x2</b></div>
      <div>模板来源 <b className={changed?'dc-new-source':''}>{changed?'templates/incar-relax-520':'templates/incar-old'}</b></div></div>
    {changed&&!done&&<div className="dc-preview-alert">预览已更新，尚未写入磁盘</div>}
    {done&&<div className="dc-done">✓　已写入 1/1</div>}
    <div className="dc-build-actions">{!done&&<button className={confirming?'dc-button-press':''}>确认构建 1 个任务</button>}</div>
  </Card>;
}
function Scene07() {
  const f=useCurrentFrame();
  const moving=f>=100&&f<=165;
  const changed=f>165;
  const confirming=f>=275&&f<315;
  const done=f>=315;
  return <Stage index="07 · 继续工作"><App bodyClass="dc-build-scene"><User>用这份结构和模板建一个新任务。</User>
    <div className="dc-build-columns"><div><Card title="寻找构建材料">
      <div className="dc-path">{ROOT}/templates</div>
      <div className="dc-material-heading">候选模板目录</div>
      <div className="dc-file-item">▸　templates/incar-old <span>ENCUT=400</span></div>
      <div className={'dc-file-item '+(f>55?'dc-file-highlight':'')}>▸　templates/incar-relax-520 <span>ENCUT=520</span></div>
      <div className="dc-material-files">INCAR　·　KPOINTS　·　POTCAR</div>
    </Card></div><div><BuildPreview changed={changed} done={done} confirming={confirming}/></div></div>
  </App>{moving&&<DragPill text="templates/incar-relax-520" progress={(f-100)/65} from={[560,441]} to={[1255,478]}/>}
  <Caption>{f<235?'把模板拖到目标任务，预览立即更新。':'你确认之后，才写入磁盘。'}</Caption></Stage>;
}
function MiniCard({title,rows}:{title:string;rows:string[]}) {
  return <div className="dc-mini-card"><h3>{title}</h3>{rows.map(r=><div key={r}>{r}</div>)}</div>;
}
function Scene08() {
  const f=useCurrentFrame();
  if(f>=120) return <Stage index="08 · VASPFlow"><div className="dc-brand-final"><div>VASPFlow</div><p>github.com/21271122/VASPFlow</p></div></Stage>;
  return <Stage index="08 · 收束"><App><div className="dc-outro-app">
    <User>汇总 slab-01 到 slab-04 的末步能量。</User>
    <MiniCard title="查看弛豫数据" rows={['slab-01-relax　●　-173.0431 eV','slab-02-relax　　●　-172.9844 eV']}/>
    <MiniCard title="查看原子结构" rows={['slab-01-relax / CONTCAR','ads-OH-relax / CONTCAR　·　手动加入']}/>
  </div></App>
  <div className="dc-brand-side"><h1>VASPFlow</h1><p>让 VASP 任务可见、可读、可操作</p><span>github.com/21271122/VASPFlow</span></div>
  <Caption>从看懂结果，到继续操作，都在同一段对话里。</Caption></Stage>;
}

export const DirectorCut:React.FC=()=> <AbsoluteFill style={{fontFamily:FONT}}>
  <Sequence from={0} durationInFrames={6*FPS}><Scene01/></Sequence>
  <Sequence from={6*FPS} durationInFrames={10*FPS}><Scene02/></Sequence>
  <Sequence from={16*FPS} durationInFrames={8*FPS}><Scene03/></Sequence>
  <Sequence from={24*FPS} durationInFrames={12*FPS}><Scene04/></Sequence>
  <Sequence from={36*FPS} durationInFrames={12*FPS}><Scene05/></Sequence>
  <Sequence from={48*FPS} durationInFrames={12*FPS}><Scene06/></Sequence>
  <Sequence from={60*FPS} durationInFrames={12*FPS}><Scene07/></Sequence>
  <Sequence from={72*FPS} durationInFrames={6*FPS}><Scene08/></Sequence>
</AbsoluteFill>;
