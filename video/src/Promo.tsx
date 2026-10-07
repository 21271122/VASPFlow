/**
 * Promo.tsx — 「工具结果统一渲染」介绍宣传片。
 *
 * 分镜
 *   ① 开场       VASPFlow / VASP 科研助手
 *   ② 主张       工具结果统一渲染的四条规则（取自 docs/vaspflow-tool-rendering-plan.md）
 *   ③ 转折       同一份返回值：通用工具视图 → 结构化卡片
 *   ④ 卡片巡礼   8 类工具结果卡片，逐张登场
 *   ⑤ 交互       点击行打开右侧看板；拖拽任务到另一张卡片补标签页
 *   ⑥ 暗色       同一套卡片语法在暗色主题下
 *   ⑦ 收尾       安装命令与仓库地址
 *
 * 所有卡片都由 src/cards 下的组件渲染，样式来自插件源码的 CSS 数组，
 * 视频里不出现任何"重新设计"的卡片。
 */
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame } from 'remotion';
import './cards/cards.css';
import './cards/cards-dark.css';
import { Reveal, useProgress } from './motion';
import {
  BuildCard, CollectedResultsView, InputChecksView, InputDiscoveryView,
  ScanOverviewView, StatusInspectionView, ToolCard,
} from './cards/tool-cards';
import { ConvergenceChart, ResultTabs, StructureViewerInline } from './cards/visuals';
import {
  ROOT, buildTasks, buildValue, checkInputsValue, collectValue, convergenceValue,
  discoverValue, inspectTasksValue, scanValue, structureValue,
} from './cards/fixtures';

/* ------------------------------------------------------------------ 时间轴 */

const OPEN = { from: 0, dur: 90 };
const THESIS = { from: 90, dur: 135 };
const SHIFT = { from: 225, dur: 126 };
const GALLERY_FROM = SHIFT.from + SHIFT.dur;

interface GalleryEntry { tool: string; dur: number; action: string; quote: string; detail: string; user: string; say: string; }

const GALLERY: GalleryEntry[] = [
  {
    tool: 'vasp_scan', dur: 118, action: '扫描计算目录',
    quote: '扫描项目 · N 个任务 · 运行 X / 错误 Y',
    detail: '默认只列异常和运行中的任务，其余可展开全量树；点任务打开看板「状态」，普通目录不伪装成 VASP 任务。',
    user: '看看 D:/vasp/SiC-slab-study 里有哪些计算任务',
    say: '扫描完成：14 个 VASP 任务，1 个检测到错误，1 个还没有输出。',
  },
  {
    tool: 'vasp_inspect_tasks', dur: 110, action: '查看计算状态',
    quote: '核查任务 · 路径 · 状态',
    detail: '下一行只放导致该状态的关键证据；点开看状态依据、输出文件与先前输入检查。',
    user: '这几个任务现在都跑到哪一步了？',
    say: '读了 4 个任务的输出，状态与证据如下。',
  },
  {
    tool: 'vasp_convergence', dur: 110, action: '查看收敛曲线',
    quote: '收敛数据 · 路径 · N 个离子步 · 末步能量',
    detail: '曲线直接在对话卡片中逐任务切换；能量与最大力共用离子步轴。',
    user: '把 slab-01 和两个吸附体系的收敛曲线一起看',
    say: '三条曲线都读到了，末步最大力已经进入 0.02 以下。',
  },
  {
    tool: 'vasp_structure_scene', dur: 118, action: '查看原子结构',
    quote: '结构 · 文件名 · 化学式 · N 原子',
    detail: '结构直接在卡片内显示，可切换标签页；任务详情仍可在右侧看板查看。',
    user: '把这三个任务的 CONTCAR 结构调出来对比',
    say: '三个结构都解析成功，成键按周期边界补齐。',
  },
  {
    tool: 'vasp_check_inputs', dur: 116, action: '校验 VASP 输入',
    quote: '输入检查 · 通过 X / 警告 Y / 失败 Z · 批次一致/不一致',
    detail: '默认只列失败、警告和不一致组；检查规则名称保留，通过的任务不会淹没异常项。',
    user: '这批输入文件帮我按结构优化规则检查一遍',
    say: '6 个目录：3 个通过、1 个注意、2 个未过，还发现两套输入模式。',
  },
  {
    tool: 'vasp_collect_results', dur: 110, action: '收集计算结果',
    quote: '收集结果 · N 个任务 · 末步 F / eV',
    detail: '同一父目录共用能量轴，一行就能读出一个任务的末步能量、最大力和离子步数。',
    user: '把吸附和 Slab 的末步能量、最大力汇总成一张表',
    say: '7 个任务纳入汇总，2 个目录因为不是计算任务被排除。',
  },
  {
    tool: 'vasp_discover_inputs', dur: 110, action: '寻找构建材料',
    quote: '发现输入 · N 个结构源 / M 个模板 · 一致性状态',
    detail: '源与模板分两组，冲突项优先；候选的路径、文件完整性和关键参数在对话内展开。',
    user: '我手上哪些文件能拿来搭新任务？',
    say: '找到 6 个结构源和 5 个模板目录，归并成 2 类结构和 4 套参数。',
  },
  {
    tool: 'vasp_build_inputs', dur: 112, action: '构建任务输入',
    quote: '预览未写入 · 已写入 X/Y',
    detail: '只有预览才有勾选、取消和确认；确认、取消或失败后的状态按 planId 保持，切走再回来不会回退。',
    user: '按这两套模板批量建 6 个任务，先给我预览',
    say: '预览已生成，还没有写入磁盘。有 1 个任务缺 POTCAR。',
  },
];

const GALLERY_TOTAL = GALLERY.reduce((sum, entry) => sum + entry.dur + 30, 0);
const INTERACT = { from: GALLERY_FROM + GALLERY_TOTAL, dur: 210 };
const DARK = { from: INTERACT.from + INTERACT.dur, dur: 126 };
const OUTRO = { from: DARK.from + DARK.dur, dur: 180 };
export const PROMO_DURATION = OUTRO.from + OUTRO.dur;

const galleryOffset = (index: number) => SHIFT.dur + GALLERY.slice(0, index).reduce((sum, entry) => sum + entry.dur + 30, 0);
const FPS = 30;
void FPS;

/* ------------------------------------------------------------------ 舞台 */

const FONT = '"Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace';

export const VaspIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" />
    <ellipse cx="8" cy="8" rx="7" ry="2.8" transform="rotate(-30 8 8)" />
    <path d="M8 4.8v6.4" />
  </svg>
);

const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{
    background: 'radial-gradient(1200px 820px at 18% -12%, #1c2c47 0%, rgba(12,16,24,0) 62%), radial-gradient(1000px 760px at 104% 112%, #17263a 0%, rgba(12,16,24,0) 58%), linear-gradient(158deg, #080a0f 0%, #0d1320 52%, #080a0f 100%)',
    fontFamily: FONT,
    color: '#e8eef8',
    overflow: 'hidden',
  }}>
    <AbsoluteFill style={{
      backgroundImage: 'linear-gradient(rgba(120,160,210,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(120,160,210,.055) 1px, transparent 1px)',
      backgroundSize: '72px 72px',
      maskImage: 'radial-gradient(1200px 900px at 40% 40%, #000 30%, transparent 78%)',
      WebkitMaskImage: 'radial-gradient(1200px 900px at 40% 40%, #000 30%, transparent 78%)',
    }} />
    {children}
  </AbsoluteFill>
);

/* -------------------------------------------------------------- 对话外壳 */

const ConversationShell: React.FC<{ dark?: boolean; fading?: boolean; galleryCamera?: boolean; children: React.ReactNode }> = ({ dark = false, fading = false, galleryCamera = false, children }) => {
  const frame = useCurrentFrame();
  let galleryFrame = frame - SHIFT.dur;
  let focus = 0;
  let activeGallery = -1;
  if (galleryCamera && galleryFrame >= 0) {
    for (const [index, entry] of GALLERY.entries()) {
      const length = entry.dur + 30;
      if (galleryFrame < length) {
        activeGallery = index;
        focus = interpolate(galleryFrame, [46, 72], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
        });
        break;
      }
      galleryFrame -= length;
    }
  }
  const zoom = [0.32, 0.32, 0.20, 0.12, 0.28, 0.28, 0.20, 0.22][activeGallery] ?? 0;
  const opacity = useProgress(0, fading ? 16 : 1);
  const surface = dark ? '#16181f' : '#ffffff';
  const ink = dark ? '#e6e6e6' : '#1f2329';
  const line = dark ? '#30343f' : '#eceff3';
  const vars = {
    '--dsw-font-family': FONT,
    '--dsw-alias-label-primary': ink,
    '--dsw-alias-label-secondary': dark ? '#98a4b4' : '#65746b',
    '--dsw-alias-label-tertiary': dark ? '#7c8798' : '#999999',
    '--dsw-alias-border-l2': line,
    '--dsw-alias-bg-base': surface,
    '--dsw-alias-bg-elevated': dark ? '#1d2029' : '#f5f7fa',
  } as React.CSSProperties;
  return (
    <div className={dark ? 'vfp-dark' : undefined} style={{ opacity, ...vars }}>
      <div style={{
        position: 'absolute', left: 56, top: 46, width: 1180, height: 988, borderRadius: 22,
        background: surface, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: '1px solid ' + (dark ? '#2a2f3a' : 'rgba(255,255,255,.75)'),
        boxShadow: '0 48px 140px rgba(0,0,0,.62)',
        transform: focus ? `translate(${(88 + (0.36 - zoom) * 350) * focus}px, 0) scale(${1 + zoom * focus})` : undefined,
        transformOrigin: 'top left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 26px', borderBottom: '1px solid ' + line, flex: 'none' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 9, background: 'linear-gradient(140deg,#4f8fd2,#2a6cae)', color: '#fff' }}>
            <VaspIcon size={15} />
          </span>
          <strong style={{ fontSize: 15.5, color: ink }}>VASP 计算助手</strong>
          <span style={{ fontSize: 12.5, color: dark ? '#8b96a6' : '#7b8797' }}>vasp 预设 · 8 类结果卡片</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: dark ? '#8b96a6' : '#9aa4b2', fontFamily: MONO }}>session · SiC-slab-study</span>
        </div>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '24px 30px 60px', color: ink, fontSize: 13 }}>
          {children}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 74, background: 'linear-gradient(' + (dark ? 'rgba(22,24,31,0)' : 'rgba(255,255,255,0)') + ', ' + surface + ')', pointerEvents: 'none' }} />
        </div>
      </div>
    </div>
  );
};

const UserTurn: React.FC<{ text: string; delay?: number; dark?: boolean }> = ({ text, delay = 0, dark = false }) => (
  <Reveal delay={delay} y={10} duration={16}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
      <div style={{ maxWidth: 560, padding: '11px 16px', borderRadius: '14px 14px 5px 14px', background: dark ? 'rgba(79,143,210,.20)' : '#eaf1fb', color: dark ? '#dce8f6' : '#1f2329', fontSize: 14, lineHeight: 1.6, boxShadow: '0 1px 2px rgba(31,45,61,.06)' }}>{text}</div>
    </div>
  </Reveal>
);

const AssistantTurn: React.FC<{ text: string; delay?: number; children?: React.ReactNode }> = ({ text, delay = 0, children }) => (
  <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
    <Reveal delay={delay} y={6} duration={14} style={{ flexShrink: 0 }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(140deg,#4f8fd2,#2a6cae)', color: '#fff', flex: 'none' }}>
        <VaspIcon size={14} />
      </span>
    </Reveal>
    <div style={{ flex: 1, minWidth: 0 }}>
      <Reveal delay={delay + 3} y={8} duration={16}>
        <div data-dsh-vaspflow-tool="vasp_say" className="vfp-say" style={{ marginBottom: 8 }}>{text}</div>
      </Reveal>
      {children}
    </div>
  </div>
);

/* ---------------------------------------------------------------- 右栏解说 */

const Narrative: React.FC<{ index: number; tool: string; action: string; quote: string; detail: string; delay?: number }> = ({ index, tool, action, quote, detail, delay = 0 }) => (
  <div style={{ position: 'absolute', left: 1292, top: 132, width: 566 }}>
    <Reveal delay={delay} y={14} duration={18}>
      <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '.2em', color: '#5f7fa8' }}>{String(index).padStart(2, '0')} / 08</div>
    </Reveal>
    <Reveal delay={delay + 3} y={16} duration={20}>
      <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-.02em', marginTop: 12, color: '#f0f5ff' }}>{action}</div>
    </Reveal>
    <Reveal delay={delay + 6} y={10} duration={18}>
      <div style={{ fontFamily: MONO, fontSize: 16, color: '#7fb0e6', marginTop: 10 }}>{tool}</div>
    </Reveal>
    <Reveal delay={delay + 9} y={0} x={-14} duration={22}>
      <div style={{ width: 62, height: 3, background: 'linear-gradient(90deg,#4f8fd2,rgba(79,143,210,0))', margin: '24px 0 22px' }} />
    </Reveal>
    <Reveal delay={delay + 12} y={12} duration={18}>
      <div style={{ fontSize: 18, lineHeight: 1.72, color: '#b5c8de' }}>「{quote}」</div>
    </Reveal>
    <Reveal delay={delay + 18} y={12} duration={18}>
      <div style={{ fontSize: 15.5, lineHeight: 1.78, color: '#75879b', marginTop: 18 }}>{detail}</div>
    </Reveal>
  </div>
);

const ProgressDots: React.FC<{ index: number }> = ({ index }) => (
  <div style={{ position: 'absolute', left: 1292, bottom: 96, display: 'flex', gap: 8, alignItems: 'center' }}>
    {GALLERY.map((entry, i) => (
      <span key={entry.tool} style={{ width: i === index ? 34 : 9, height: 9, borderRadius: 5, background: i === index ? '#4f8fd2' : i < index ? 'rgba(79,143,210,.45)' : 'rgba(150,175,205,.22)' }} />
    ))}
  </div>
);

const GalleryNarrative: React.FC<{ entry: GalleryEntry; index: number }> = ({ entry, index }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [48, 72], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return <div style={{ position: 'absolute', inset: 0, opacity, pointerEvents: 'none' }}>
    <Narrative index={index + 1} tool={entry.tool} action={entry.action} quote={entry.quote} detail={entry.detail} delay={2} />
    <ProgressDots index={index} />
  </div>;
};

/* -------------------------------------------------------------------- 分镜 */

const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [OPEN.dur - 16, OPEN.dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = useProgress(6, 34);
  return (
    <AbsoluteFill style={{ opacity: out, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', marginTop: -30 }}>
        <Reveal delay={4} y={0} scale={0.7} duration={26} style={{ display: 'flex', justifyContent: 'center' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 104, height: 104, borderRadius: 28, background: 'linear-gradient(150deg, rgba(79,143,210,.28), rgba(79,143,210,.06))', border: '1px solid rgba(120,175,235,.35)', color: '#9ecbff', boxShadow: '0 0 80px rgba(79,143,210,.35)' }}>
            <VaspIcon size={54} />
          </span>
        </Reveal>
        <Reveal delay={18} y={22} duration={26}>
          <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: '-.035em', marginTop: 34, color: '#f4f8ff' }}>VASPFlow</div>
        </Reveal>
        <Reveal delay={28} y={16} duration={24}>
          <div style={{ fontSize: 24, color: '#93a9c4', marginTop: 16 }}>VASP 科研助手 · DeepSeek Harness 插件</div>
        </Reveal>
        <Reveal delay={44} y={0} x={-30} duration={30}>
          <div style={{ width: 420 * ring, height: 1, background: 'linear-gradient(90deg, rgba(79,143,210,0), #4f8fd2, rgba(79,143,210,0))', margin: '40px auto 0' }} />
        </Reveal>
        <Reveal delay={52} y={14} duration={24}>
          <div style={{ fontSize: 28, marginTop: 34, color: '#dce7f5' }}>工具调用结果，不该只是一段 JSON。</div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

const RULES = [
  { title: '首行即结论', body: '工具名对应的中文动作、对象、结果状态和关键数量，一行读完。' },
  { title: '批量结果只展开有用的行', body: '默认显示异常任务和少量代表项，其余用「查看全部 N 项」展开。' },
  { title: '详情有明确归属', body: '任务详情在右侧看板；曲线与结构可直接在卡片内查看。' },
  { title: '同一视觉语法', body: '无阴影、无层层矩形框；状态用文字，颜色只作辅助。' },
];

const Thesis: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [THESIS.dur - 16, THESIS.dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out, flexDirection: 'column', padding: '132px 0 0 168px' }}>
      <Reveal delay={2} y={16} duration={20}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '.2em', color: '#5f7fa8' }}>0.3.0 · 工具结果统一渲染</div>
      </Reveal>
      <Reveal delay={6} y={20} duration={24}>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-.03em', marginTop: 16, color: '#f2f7ff' }}>八类结果，一套信息层级</div>
      </Reveal>
      <Reveal delay={12} y={14} duration={22}>
        <div style={{ fontSize: 20, color: '#8ea3bd', marginTop: 18 }}>统一的是信息层级和交互语言，不是让每种结果都长成同一张卡片。</div>
      </Reveal>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 640px)', gap: '26px 40px', marginTop: 62 }}>
        {RULES.map((rule, index) => <Reveal key={rule.title} delay={22 + index * 8} y={18} duration={20}>
          <div style={{ display: 'flex', gap: 18, padding: '20px 24px', borderRadius: 14, background: 'rgba(120,170,230,.055)', border: '1px solid rgba(120,170,230,.16)' }}>
            <span style={{ fontFamily: MONO, fontSize: 15, color: '#5f8dc4', paddingTop: 3 }}>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <div style={{ fontSize: 23, fontWeight: 650, color: '#e6eefb' }}>{rule.title}</div>
              <div style={{ fontSize: 16, lineHeight: 1.7, color: '#8397ae', marginTop: 8 }}>{rule.body}</div>
            </div>
          </div>
        </Reveal>)}
      </div>
    </AbsoluteFill>
  );
};

const RAW_JSON = [
  '{',
  '  "rootPath": "D:/vasp/SiC-slab-study",',
  '  "directories": ["bulk-SiC-scf", "slab-01-relax", "slab-02-relax",',
  '                  "slab-03-relax", "slab-04-relax", "slab-05-relax", ...],',
  '  "tasks": [',
  '    { "rel_path": "bulk-SiC-scf",',
  '      "status_record": { "code": "TASK_COMPLETED", "label": "已完成" },',
  '      "task_type": { "code": "STATIC_SCF", "label": "静态 / SCF" } },',
  '    { "rel_path": "slab-01-relax",',
  '      "status_record": { "code": "TASK_COMPLETED", "label": "已完成" },',
  '      "task_type": { "code": "RELAXATION", "label": "结构优化" } },',
  '    { "rel_path": "slab-05-relax",',
  '      "status_record": { "code": "RUNNING", "label": "运行中" },',
  '      "task_type": { "code": "RELAXATION", "label": "结构优化" } },',
  '    { "rel_path": "slab-07-relax",',
  '      "status_record": { "code": "ERROR_DETECTED", "label": "检测到错误" },',
  '      "task_type": { "code": "RELAXATION", "label": "结构优化" } }',
  '  ]',
  '}',
].join('\n');

const ShiftContent: React.FC = () => {
  const frame = useCurrentFrame();
  const jsonOut = interpolate(frame, [34, 52], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const cardIn = interpolate(frame, [42, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: 'absolute', left: 6, top: 0, right: 0 }}>
      <div style={{ opacity: jsonOut, transform: 'translateY(' + ((1 - jsonOut) * -18) + 'px) scale(' + (0.985 + jsonOut * 0.015) + ')' }}>
        <div style={{ fontFamily: MONO, fontSize: 12, color: '#9aa4b2', marginBottom: 10 }}>tool call · vasp_scan · result (raw)</div>
        <pre style={{ margin: 0, padding: '18px 20px', borderRadius: 12, background: '#f6f8fa', border: '1px solid #e6e9ee', color: '#3b4657', fontFamily: MONO, fontSize: 13.5, lineHeight: 1.62, whiteSpace: 'pre', overflow: 'hidden', maxHeight: 700 }}>{RAW_JSON}</pre>
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: cardIn, transform: 'translateY(' + ((1 - cardIn) * 24) + 'px)' }}>
        <ToolCard toolName="vasp_scan" status="完成" delay={0}>
          <ScanOverviewView value={scanValue} delay={2} />
        </ToolCard>
      </div>
    </div>
  );
};

const ShiftNarrative: React.FC = () => {
  const frame = useCurrentFrame();
  const labelA = interpolate(frame, [30, 42], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const labelB = interpolate(frame, [48, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 1292, top: 300, width: 566 }}>
      <div style={{ position: 'absolute', opacity: labelA }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '.2em', color: '#5f7fa8' }}>BEFORE</div>
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 14, color: '#f0f5ff' }}>通用工具视图</div>
        <div style={{ fontSize: 16, lineHeight: 1.78, color: '#75879b', marginTop: 20 }}>同一份返回值以 JSON 文本贴进对话：字段名要自己读，数量要自己数，异常要自己找。</div>
      </div>
      <div style={{ position: 'absolute', opacity: labelB }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '.2em', color: '#5f8fd2' }}>AFTER</div>
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 14, color: '#f0f5ff' }}>结构化卡片</div>
        <div style={{ fontSize: 16, lineHeight: 1.78, color: '#96a9be', marginTop: 20 }}>同一份返回值，现在是首行结论、分组列表和能点击去处的行。数据结构没有变，读法变了。</div>
      </div>
    </div>
  );
};

/** ④ 卡片巡礼的一屏（对话内容） */
const GalleryChat: React.FC<{ entry: GalleryEntry; index: number }> = ({ entry, index }) => {
  const delay = 4;
  const card = (() => {
    if (entry.tool === 'vasp_scan') {
      return <ToolCard toolName="vasp_scan" status="完成" delay={delay}>
        <ScanOverviewView value={scanValue} delay={delay + 4} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_inspect_tasks') {
      return <ToolCard toolName="vasp_inspect_tasks" status="完成" delay={delay}>
        <StatusInspectionView value={inspectTasksValue} delay={delay + 4} openPath={['slab-07-relax']} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_convergence') {
      return <ToolCard toolName="vasp_convergence" status="完成" delay={delay}>
        <div className="vfp-result-summary">3 个任务的收敛曲线</div>
        <ResultTabs rows={convergenceValue.results} kind="convergence" rootPath={ROOT} active={0} openPath={['slab-01-relax']} delay={delay + 4} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_structure_scene') {
      return <ToolCard toolName="vasp_structure_scene" status="完成" delay={delay}>
        <div className="vfp-result-summary">3 个原始结构</div>
        <ResultTabs rows={structureValue.results} kind="structure" rootPath={ROOT} active={0} openPath={['slab-01-relax']} delay={delay + 4} structureHeight={330} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_check_inputs') {
      return <ToolCard toolName="vasp_check_inputs" status="完成" delay={delay}>
        <InputChecksView value={checkInputsValue} delay={delay + 4} expandIndex={4} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_collect_results') {
      return <ToolCard toolName="vasp_collect_results" title="查看弛豫数据" status="完成" delay={delay}>
        <CollectedResultsView value={collectValue} delay={delay + 4} openPath={['ads']} />
      </ToolCard>;
    }
    if (entry.tool === 'vasp_discover_inputs') {
      return <ToolCard toolName="vasp_discover_inputs" status="完成" delay={delay}>
        <InputDiscoveryView value={discoverValue} delay={delay + 4} openPath={['templates']} />
      </ToolCard>;
    }
    return <BuildCard value={buildValue} tasks={buildTasks} delay={delay + 2} phase="preview" selected={[0, 1, 3, 4, 5]} focused={1} />;
  })();
  return (
    <>
      <UserTurn text={entry.user} delay={0} />
      <AssistantTurn text={entry.say} delay={6}>{card}</AssistantTurn>
      {index === 0 && <div style={{ marginTop: 14, fontSize: 12, color: '#8b98a8' }}>首行即结论：动作 + 对象 + 状态 + 关键数量。</div>}
    </>
  );
};

/* ⑤ 交互 */
const Cursor: React.FC<{ x: number; y: number; pressed?: boolean }> = ({ x, y, pressed }) => (
  <div style={{ position: 'absolute', left: x, top: y, zIndex: 40, pointerEvents: 'none', transform: 'scale(' + (pressed ? 0.86 : 1) + ')', transformOrigin: 'top left', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }}>
    <svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 1.6 L2 23 L7.6 17.9 L11.2 26.4 L15.2 24.6 L11.5 16.2 L19 15.2 Z" fill="#ffffff" stroke="#20242c" strokeWidth="1.4" strokeLinejoin="round" /></svg>
  </div>
);

const InteractionContent: React.FC = () => {
  const frame = useCurrentFrame();
  const pressed = frame > 24 && frame < 32;
  const cursorX = interpolate(frame, [0, 16, 26, 40], [496, 372, 258, 258], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const cursorY = interpolate(frame, [0, 16], [340, 96], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hot = frame >= 18 && frame < 36;
  const dragT = interpolate(frame, [92, 140], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const dragging = frame >= 88 && frame < 150;
  const dropHot = frame >= 128 && frame < 160;
  const newTab = useProgress(154, 18);
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0 }}>
        <ToolCard toolName="vasp_convergence" status="完成" delay={0}>
          <div className="vfp-result-summary">3 个任务的收敛曲线</div>
          <div className="vfp-result-rows">
            {[
              { path: 'slab-01-relax', note: '已完成 · 26 个离子步' },
              { path: 'ads-CO-relax', note: '已完成 · 21 个离子步' },
              { path: 'neb-diffusion', note: '已完成 · 18 个离子步' },
            ].map((row, index) => <Reveal key={row.path} delay={4 + index * 4} y={8}>
              <button type="button" className="vfp-result-row" style={{
                background: index === 0 && hot ? 'rgba(38,151,102,.19)' : undefined,
                outline: index === 0 && hot ? '2px solid rgba(79,143,210,.55)' : undefined,
              }}>
                <span>{row.path}</span><span className="vfp-tree-muted">{row.note}</span><span className="vfp-tree-status">查看</span>
              </button>
            </Reveal>)}
          </div>
        </ToolCard>
      </div>

      <div style={{ position: 'absolute', left: 0, top: 190, right: 0, outline: dropHot ? '2px dashed #d7a62d' : undefined, outlineOffset: 4, background: dropHot ? 'rgba(215,166,45,.10)' : undefined }}>
        <ToolCard toolName="vasp_structure_scene" status="完成" delay={30}>
          <div className="vfp-result-summary">3 个原始结构</div>
          {dropHot && <div className="vfp-structure-drop-hint">松开以添加结构文件标签页（任务会添加直属结构文件）</div>}
          <ResultTabs rows={structureValue.results} kind="structure" rootPath={ROOT} active={0} openPath={[]} delay={34} structureHeight={268} />
        </ToolCard>
      </div>

      {dragging && <div style={{
        position: 'absolute', zIndex: 39, left: 150 + dragT * 210, top: 96 + dragT * 548,
        padding: '5px 10px', borderRadius: 5, background: 'rgba(38,151,102,.92)', color: '#fff',
        fontSize: 12.5, fontFamily: FONT, boxShadow: '0 8px 22px rgba(0,0,0,.35)', opacity: 1 - newTab * 0.6,
      }}>slab-01-relax</div>}

      {frame > 150 && <div style={{ position: 'absolute', left: 0, top: 796, opacity: newTab, transform: 'translateY(' + ((1 - newTab) * 10) + 'px)' }}>
        <div style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 8, background: 'rgba(38,151,102,.14)', border: '1px solid rgba(38,151,102,.4)', color: '#278d67', fontSize: 13 }}>＋ 新标签页：slab-01-relax / CONTCAR</div>
      </div>}

      <Cursor x={cursorX} y={cursorY} pressed={pressed} />

    </>
  );
};

const Dock: React.FC<{ tab: number }> = ({ tab }) => {
  const slide = useProgress(0, 22);
  const tabs = ['状态', '收敛', '结构', '文件'];
  const vars = {
    '--dsw-font-family': FONT,
    '--dsw-alias-bg-elevated': '#f5f7fa',
    '--dsw-alias-border-l2': '#eceff3',
    '--dsw-alias-label-secondary': '#65746b',
    '--dsw-alias-label-tertiary': '#999999',
  } as React.CSSProperties;
  return (
    <div style={{
      position: 'absolute', left: 1268, top: 46, width: 596, height: 988, borderRadius: 20,
      background: '#ffffff', color: '#1f2329', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      border: '1px solid rgba(255,255,255,.75)', boxShadow: '0 48px 140px rgba(0,0,0,.6)',
      transform: 'translateX(' + ((1 - slide) * 90) + 'px)', opacity: slide, fontFamily: FONT, ...vars,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 22px', borderBottom: '1px solid #eceff3' }}>
        <VaspIcon size={15} />
        <strong style={{ fontSize: 15.5 }}>任务详情</strong>
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: '#7b8797' }}>slab-01-relax</span>
        <span style={{ marginLeft: 'auto', fontSize: 18, color: '#9aa4b2' }}>×</span>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '10px 22px 0', borderBottom: '1px solid #eceff3' }}>
        {tabs.map((label, index) => <span key={label} style={{
          padding: '8px 14px', fontSize: 14, fontWeight: index === tab ? 600 : 400,
          color: index === tab ? '#278d67' : '#5c6675',
          borderBottom: index === tab ? '2px solid #39a579' : '2px solid transparent',
        }}>{label}</span>)}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '18px 22px', fontSize: 13 }}>
        {tab === 1 ? <div>
          <ConvergenceChart series={convergenceValue.results[0]} width={520} height={300} delay={8} />
          <Reveal delay={70} y={14}>
            <div style={{ marginTop: 18, padding: '15px 17px', borderRadius: 10, background: '#f5f8fb', border: '1px solid #e6edf5', fontSize: 13.5, lineHeight: 1.75, color: '#5b6b7d' }}>
              点历史结果只切换右侧看板的任务与页签：不重新执行工具，也不写文件。
              <br />拖拽结构或任务到另一张卡片，即可给那张卡片补一个标签页。
            </div>
          </Reveal>
        </div> : null}
        {tab === 2 ? <StructureViewerInline scene={structureValue.results[0] as never} sourcePath={ROOT + '/slab-01-relax/CONTCAR'} delay={8} height={330} /> : null}
        {tab === 0 ? <div>
          {[['状态', '已完成'], ['状态依据', 'OUTCAR：reached required accuracy'], ['离子步', '26'], ['末步能量', '-173.043100 eV'], ['末步最大力', '0.017 eV/Å'], ['输入检查', 'structure-optimization · 通过'], ['输出文件', 'OUTCAR、OSZICAR、CONTCAR']].map(([k, v], index) => (
            <Reveal key={k} delay={6 + index * 3} y={8}><div style={{ display: 'flex', gap: 16, justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0f2f5', fontVariantNumeric: 'tabular-nums' }}><span style={{ color: '#75808f' }}>{k}</span><span>{v}</span></div></Reveal>
          ))}
        </div> : null}
        {tab === 3 ? <div>
          {['INCAR', 'KPOINTS', 'POSCAR', 'POTCAR', 'CONTCAR', 'OUTCAR', 'OSZICAR', 'XDATCAR', 'lqf.sh'].map((name, index) => (
            <Reveal key={name} delay={6 + index * 2} y={7}><div className="vfp-result-row" style={{ margin: '2px 0' }}><span>{name}</span><span className="vfp-tree-muted" /></div></Reveal>
          ))}
        </div> : null}
      </div>
    </div>
  );
};

const DarkScene: React.FC = () => (
  <>
    <ConversationShell dark fading>
      <UserTurn dark text="结构优化跑到一半，明暗主题都看得清吗？" delay={4} />
      <AssistantTurn text="看板的表格和卡片共用一套状态文字，暗色下同样可读。" delay={10}>
        <ToolCard toolName="vasp_structure_scene" status="完成" delay={16}>
          <div className="vfp-result-summary">3 个原始结构</div>
          <ResultTabs rows={structureValue.results} kind="structure" rootPath={ROOT} active={0} openPath={['slab-01-relax']} delay={20} structureHeight={330} />
        </ToolCard>
      </AssistantTurn>
    </ConversationShell>
    <div style={{ position: 'absolute', left: 1292, top: 320, width: 566 }}>
      <Reveal delay={6} y={16} duration={20}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '.2em', color: '#5f7fa8' }}>THEME</div>
      </Reveal>
      <Reveal delay={10} y={18} duration={22}>
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-.02em', marginTop: 12, color: '#f0f5ff' }}>明暗同一套语法</div>
      </Reveal>
      <Reveal delay={16} y={14} duration={20}>
        <div style={{ fontSize: 17, lineHeight: 1.78, color: '#8497ad', marginTop: 22 }}>状态用文字表达，颜色只作辅助；错误紧贴对应行，不依赖色觉。暗色主题只换底色，不换信息结构。</div>
      </Reveal>
    </div>
  </>
);

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14, OUTRO.dur - 14, OUTRO.dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', marginTop: -20 }}>
        <Reveal delay={4} y={16} duration={22}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 62, height: 62, borderRadius: 18, background: 'linear-gradient(150deg, rgba(79,143,210,.3), rgba(79,143,210,.06))', border: '1px solid rgba(120,175,235,.35)', color: '#9ecbff' }}>
              <VaspIcon size={32} />
            </span>
            <span style={{ fontSize: 62, fontWeight: 800, letterSpacing: '-.035em', color: '#f4f8ff' }}>VASPFlow</span>
            <span style={{ fontFamily: MONO, fontSize: 16, color: '#5f8fd2', alignSelf: 'flex-end', paddingBottom: 12 }}>v0.3.0</span>
          </div>
        </Reveal>
        <Reveal delay={12} y={14} duration={22}>
          <div style={{ fontSize: 22, color: '#93a9c4', marginTop: 26 }}>工具结果统一渲染 · 8 类结果卡片 · 右侧任务看板</div>
        </Reveal>
        <Reveal delay={20} y={16} duration={22}>
          <div style={{ marginTop: 44, display: 'inline-flex', alignItems: 'center', gap: 16, padding: '16px 26px', borderRadius: 12, background: 'rgba(10,16,26,.72)', border: '1px solid rgba(120,170,230,.22)', fontFamily: MONO, fontSize: 18, color: '#cfe0f2' }}>
            <span style={{ color: '#5f8fd2' }}>$</span>
            <span>npx --yes dsh-vaspflow install --profile web</span>
          </div>
        </Reveal>
        <Reveal delay={30} y={14} duration={22}>
          <div style={{ fontSize: 19, color: '#7c90a8', marginTop: 34 }}>github.com/21271122/VASPFlow</div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------- 组装 */

const SHELL_TOTAL = SHIFT.dur + GALLERY_TOTAL + INTERACT.dur;

export const Promo: React.FC = () => (
  <Stage>
    <Sequence style={{ flexDirection: 'column' }} from={OPEN.from} durationInFrames={OPEN.dur}><Opening /></Sequence>
    <Sequence style={{ flexDirection: 'column' }} from={THESIS.from} durationInFrames={THESIS.dur}><Thesis /></Sequence>

    <Sequence style={{ flexDirection: 'column' }} from={SHIFT.from} durationInFrames={SHELL_TOTAL}>
      <ConversationShell galleryCamera>
        <Sequence style={{ flexDirection: 'column' }} from={0} durationInFrames={SHIFT.dur}><ShiftContent /></Sequence>
        {GALLERY.map((entry, index) => (
          <Sequence style={{ flexDirection: 'column' }} key={entry.tool} from={galleryOffset(index)} durationInFrames={entry.dur + 30}>
            <GalleryChat entry={entry} index={index} />
          </Sequence>
        ))}
        <Sequence style={{ flexDirection: 'column' }} from={galleryOffset(GALLERY.length)} durationInFrames={INTERACT.dur}>
          <InteractionContent />
        </Sequence>
      </ConversationShell>
    </Sequence>

    <Sequence style={{ flexDirection: 'column' }} from={SHIFT.from} durationInFrames={SHIFT.dur}><ShiftNarrative /></Sequence>
    {GALLERY.map((entry, index) => (
      <Sequence style={{ flexDirection: 'column' }} key={entry.tool} from={GALLERY_FROM + galleryOffset(index) - SHIFT.dur} durationInFrames={entry.dur + 30}>
        <GalleryNarrative entry={entry} index={index} />
      </Sequence>
    ))}

    <Sequence style={{ flexDirection: 'column' }} from={INTERACT.from + 26} durationInFrames={INTERACT.dur - 26}><Dock tab={1} /></Sequence>

    <Sequence style={{ flexDirection: 'column' }} from={DARK.from} durationInFrames={DARK.dur}><DarkScene /></Sequence>
    <Sequence style={{ flexDirection: 'column' }} from={OUTRO.from} durationInFrames={OUTRO.dur}><Outro /></Sequence>
  </Stage>
);
