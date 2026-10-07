import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, interpolate, Easing} from 'remotion';
import {ToolCard, ScanOverviewView, CollectedResultsView, ResultTabs, BuildCard} from './cards/tool-cards';
import {PathTree} from './cards/primitives';
import {StructureViewerInline} from './cards/visuals';
import {Reveal} from './motion';
import data from './cards/film-real-data.json';
import templates from './cards/film-templates.json';
import './cards/cards.css';
import './cards/cards-dark.css';
import './DirectorCutV2.css';

export const DIRECTOR_CUT_V2_DURATION = 2040;
const root = data.rootPath;
const ease = (f:number, start:number, duration:number) => interpolate(f,[start,start+duration],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
const chapters = ['先看全局','结论有依据','数据逐任务','曲线随手切','结构拖进来','预览再构建'];

const Cursor:React.FC<{x:number;y:number;click?:number}> = ({x,y,click=0}) => <div className="film-cursor" style={{left:x,top:y}}>
  {click>0 && click<1 && <i style={{width:60*click,height:60*click,opacity:1-click}}/>}
  <svg width="28" height="34" viewBox="0 0 28 34"><path d="M3 2L3 27L10 21L15 32L20 30L15 19L25 18Z" fill="#fff" stroke="#151b2e" strokeWidth="2"/></svg>
</div>;

const Shell:React.FC<{chapter:number;caption:string;dock?:React.ReactNode;children:React.ReactNode}> = ({chapter,caption,dock,children}) => <AbsoluteFill className="film-v2 vfp-dark">
  <aside className="film-nav"><div className="film-brand">deepseek <small>HARNESS</small></div><div className="film-new">＋ 新会话</div><div className="film-entry">◉ VASP</div><div>▤ 任务看板</div><div>⌘ SSH</div><hr/><small>工作区</small><div>▱ test</div><div className="film-session">VASP 计算助手</div><footer>VASPFlow · 0.2</footer></aside>
  <main className="film-chat"><header><span>VASP 计算助手</span><small>对话</small></header><div className="film-card-stage">{children}</div><div className="film-compose">给智能体发消息 <span>DeepSeek　↑</span></div></main>
  <aside className="film-dock"><header>VASP <small>test</small></header><div className="film-dock-path">D:\Projects\VASPFlow\test</div>{dock || <><div className="film-dock-label">计算任务</div>{['1-NO3','2-NO','8-NO-scan','10-NO-scan'].map((x,i)=><div className="film-dock-row" key={x}>▸ {x}<small>{i<2?'完成':'未输出'}</small></div>)}<div className="film-dock-label">文件</div><div className="film-dock-row">▱ NO.vasp</div></>}</aside>
  <div className="film-chapter"><b>{String(chapter+1).padStart(2,'0')}</b>{chapters[chapter]}</div>
  <div className="film-caption">{caption}</div>
</AbsoluteFill>;

const Evidence:React.FC<{index?:number}> = ({index=0}) => {
  const row=data.collected.rows[index];
  return <div className="film-evidence"><h3>{row.relPath} <em>任务完成</em></h3><small>{root}/{row.relPath}</small><h4>状态依据</h4><div className="film-proof">OUTCAR<br/><code>reached required accuracy<br/>stopping structural energy minimisation</code></div><h4>末步结果</h4><dl><dt>自由能 F</dt><dd>{row.values.last_ionic_free_energy.value.toFixed(6)} eV</dd><dt>最大力</dt><dd>{row.values.last_max_force.value.toFixed(6)} eV/Å</dd><dt>离子步</dt><dd>{row.values.ionic_steps.value}</dd></dl><h4>输出文件</h4><div className="film-file">OUTCAR</div><div className="film-file">OSZICAR</div><div className="film-file">CONTCAR</div></div>;
};

const ScanShot:React.FC<{detail?:boolean}> = ({detail=false}) => {
  const f=useCurrentFrame(); const filtered=detail||f>110;
  return <Shell chapter={detail?1:0} caption={detail?'点开任务，查看结论依据。':f<105?'打开项目，先看全局。':'状态、类型、目录，一眼看清。'} dock={detail?<Reveal delay={25} x={40} y={0}><Evidence/></Reveal>:undefined}>
    <div className="film-user">{detail?'查看已完成的任务':'扫描当前计算目录'}</div>
    <ToolCard toolName="vasp_scan" title="扫描计算目录"><ScanOverviewView value={{...data.scan,rootPath:root}} selectedCode={filtered?'TASK_COMPLETED':undefined}/></ToolCard>
    {filtered&&<Cursor x={detail?370:570} y={detail?654:416} click={ease(f,detail?24:110,22)}/>}
  </Shell>;
};

const DataShot:React.FC = () => {
  const f=useCurrentFrame();const active=f>126?1:0;
  const row=data.collected.rows[active];
  return <Shell chapter={2} caption="能量、最大力、步数，逐任务查看。" dock={<Evidence index={active}/>}>
    <div className="film-user">统计 1-NO3 与 2-NO 的弛豫结果</div>
    <ToolCard toolName="vasp_collect_results" title="查看弛豫数据">
      <CollectedResultsView value={{...data.collected,rootPath:root}}/>
    </ToolCard>
    <Reveal delay={45} y={10}><div className="film-data-note">组成不同的任务，总能量不能直接作差。</div></Reveal>
    <Cursor x={405} y={f>126?404:356} click={ease(f,126,20)}/>
    <div className="film-source-receipt"><span>{row.relPath}/OSZICAR</span><span>{row.relPath}/OUTCAR</span></div>
  </Shell>;
};

const CurveShot:React.FC = () => {
  const f=useCurrentFrame();const active=f<140?0:1;
  return <Shell chapter={3} caption={f<140?'能量和力，同屏看收敛。':'左右切换，一个任务一个标签页。'}>
    <div className="film-user">查看这两个任务的收敛曲线</div>
    <ToolCard toolName="vasp_convergence" title="查看收敛曲线"><ResultTabs rows={data.convergence} kind="convergence" rootPath={root} active={active} delay={active?140:0}/></ToolCard>
    {f>122&&f<175&&<div className="film-key"><kbd>→</kbd><span>2-NO</span></div>}
  </Shell>;
};

const Drag:React.FC<{frame:number;start:number;label:string;toX:number;toY:number;fromY:number}> = ({frame,start,label,toX,toY,fromY}) => {
  const p=ease(frame,start,60);if(frame<start||frame>start+80)return null;
  const x=1590+(toX-1590)*p,y=fromY+(toY-fromY)*p-Math.sin(Math.PI*p)*130;
  return <><div className="film-drag" style={{left:x,top:y,transform:`rotate(${Math.sin(Math.PI*p)*-5}deg)`,opacity:frame>start+60?1-ease(frame,start+60,16):1}}>▱ {label}</div><Cursor x={x+30} y={y+28}/>{p===1&&<div className="film-drop-burst" style={{left:toX,top:toY,width:70+ease(frame,start+60,20)*80,height:70+ease(frame,start+60,20)*80,opacity:1-ease(frame,start+60,20)}}/>}</>;
};

const StructureShot:React.FC = () => {
  const f=useCurrentFrame();const added=f>=150;const active=f>=175?1:0;
  const rows=added?[data.structures[0],{...data.structures[1],userAdded:true}]:[data.structures[0]];
  const rotation=ease(f,205,85);
  return <Shell chapter={4} caption={f<95?'真实结构，直接在对话里看。':f<205?'拖入文件，新增一个黄色标签页。':'转动视角，看清原子与晶胞。'} dock={<><div className="film-dock-label">2-NO</div>{['POSCAR','CONTCAR','INCAR','KPOINTS','POTCAR'].map(x=><div key={x} className={`film-dock-row ${x==='CONTCAR'&&f>85&&f<150?'film-drag-source':''}`}>▱ {x}</div>)}</>}>
    <ToolCard toolName="vasp_structure_scene" title="查看原子结构">
      <div className="vfp-inline-tree"><PathTree items={rows} pathOf={(r:any)=>`${r.rel_path}/${r.file}`} delay={0} renderLeaf={(r:any,name:string)=><button className="vfp-visual-tree-leaf" data-user-added={r.userAdded?'':undefined}>{name}</button>}/></div>
      <div className="vfp-visual-tabs">{rows.map((r:any,i)=><button key={r.rel_path} data-user-added={r.userAdded?'':undefined} aria-selected={active===i}>{r.rel_path} / CONTCAR</button>)}</div>
      <StructureViewerInline scene={rows[active] as any} sourcePath={`${root}/${rows[active].rel_path}/CONTCAR`} height={290} delay={-60} yaw={-.4+rotation*.55} pitch={.24+rotation*.22} zoom={1.18}/>
    </ToolCard>
    <Drag frame={f} start={90} label="2-NO / CONTCAR" fromY={220} toX={750} toY={450}/>
    {added&&f<230&&<div className="film-added">＋ 已加入 2-NO / CONTCAR</div>}
  </Shell>;
};

const MaterialsShot:React.FC = () => {
  const f=useCurrentFrame();
  return <Shell chapter={5} caption="已有输入，也能继续作为模板。">
  <ToolCard toolName="vasp_discover_inputs" title="寻找构建材料">
    <div className="vfp-scan-path">搜索范围：<code>{root}</code> · 最深 1 层</div>
    <div className="vfp-discovery-heading">模板目录文件覆盖 <span>2 个候选目录</span></div>
    <div className="vfp-coverage">{['INCAR','KPOINTS','POTCAR','提交脚本'].map((file,i)=><div key={file}><span>{file}</span><div><i style={{width:`${i<3?ease(f,i*6,24)*100:0}%`}}/></div><strong>{i<3?'2':'0'}/2</strong></div>)}</div>
    <div className="vfp-discovery-heading">INCAR 参数组合 <span>1 组</span></div>
    <details className="vfp-template-group" open><summary><strong>方案 1</strong><span>2 个目录</span><span className="vfp-tree-muted">{Object.entries(templates[0].params).map(([k,v])=>`${k} ${v}`).join(' · ')}</span></summary><div className="vfp-discovery-list">{templates.map(t=><div key={t.relPath}><code>{t.relPath}</code><span>缺 提交脚本（可选）</span></div>)}</div></details>
  </ToolCard>
</Shell>;
};

const BuildShot:React.FC = () => {
  const f=useCurrentFrame();const changed=f>=110;const done=f>=215;
  return <Shell chapter={5} caption={f<110?'拖入模板，重新生成预览。':f<215?'先检查来源，再确认构建。':'确认完成，写入状态清楚可见。'} dock={<div className="film-evidence"><h3>11-NO3-demo <em>{done?'已写入':'待确认'}</em></h3><small>{root}/11-NO3-demo</small><h4>来源映射</h4><dl><dt>POSCAR</dt><dd>1-NO3 / CONTCAR</dd><dt>INCAR</dt><dd className={changed?'film-changed':''}>{changed?'1-NO3':'2-NO'} / INCAR</dd><dt>KPOINTS</dt><dd>{changed?'1-NO3':'2-NO'} / KPOINTS</dd><dt>POTCAR</dt><dd>{changed?'1-NO3':'2-NO'} / POTCAR</dd></dl><h4>模板目录</h4><div className="film-dock-row">▱ 1-NO3</div>{changed&&<div className="film-proof">来源已更新<br/>预览已重新生成</div>}</div>}>
    <div className="film-user">用优化后的结构构建一个新任务</div>
    <BuildCard value={{preview:{projectRoot:root,results:[{errors:[],warnings:[]}]}}} tasks={[{dir:'11-NO3-demo'}]} selected={[0]} focused={0} phase={done?'done':'preview'}/>
    <Drag frame={f} start={50} label="模板 1-NO3" fromY={490} toX={690} toY={343}/>
    {f>195&&f<250&&<Cursor x={1390} y={435} click={ease(f,210,20)}/>}
    {done&&<Reveal delay={216} y={12}><div className="film-written"><span>✓</span><div>构建完成<small>POSCAR · INCAR · KPOINTS · POTCAR</small></div></div></Reveal>}
  </Shell>;
};

const EndShot:React.FC = () => <AbsoluteFill className="film-end"><Reveal delay={3} y={20}><div className="film-end-mark">VASPFlow</div><h1>看懂结果，接着行动。</h1><div className="film-end-line">目录与状态　·　数据与结构　·　预览与构建</div></Reveal><div className="film-end-foot">演示数据：本地 test / 1-NO3、2-NO　｜　构建步骤为交互演示</div></AbsoluteFill>;

export const DirectorCutV2:React.FC = () => <AbsoluteFill>
  <Sequence from={0} durationInFrames={240}><ScanShot/></Sequence>
  <Sequence from={240} durationInFrames={210}><ScanShot detail/></Sequence>
  <Sequence from={450} durationInFrames={240}><DataShot/></Sequence>
  <Sequence from={690} durationInFrames={300}><CurveShot/></Sequence>
  <Sequence from={990} durationInFrames={390}><StructureShot/></Sequence>
  <Sequence from={1380} durationInFrames={150}><MaterialsShot/></Sequence>
  <Sequence from={1530} durationInFrames={330}><BuildShot/></Sequence>
  <Sequence from={1860} durationInFrames={180}><EndShot/></Sequence>
</AbsoluteFill>;
