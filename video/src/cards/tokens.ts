/**
 * tokens.ts — 与插件源码同源的颜色 / 状态表 / 半径表。
 *
 * 逐项抄自：
 *  - plugins/dsh-vaspflow/src/client/tool-rows.tsx  (scanStates / scanTypes / profileNames / 输入检查分类)
 *  - plugins/dsh-vaspflow/src/client/elementColors.ts (CPK 元素色)
 *  - plugins/dsh-vaspflow/src/client/StructureViewer.tsx (VDW_RADIUS)
 * 宣传片不重新发明配色，只有这样卡片颜色才和真实插件逐像素一致。
 */

export type ScanStateCode = 'TASK_COMPLETED' | 'RUNNING' | 'ERROR_DETECTED' | 'NO_OUTPUT_EVIDENCE' | 'UNKNOWN';
export type ScanTypeCode = 'RELAXATION' | 'STATIC_SCF' | 'NEB' | 'FREQUENCY_ZPE' | 'AIMD' | 'OTHER';

/** 计算状态：顺序与配色照抄 tool-rows.tsx 的 scanStates。 */
export const scanStates = [
  ['TASK_COMPLETED', '已完成', '#279d69'],
  ['RUNNING', '运行中', '#55a6d9'],
  ['ERROR_DETECTED', '检测到错误', '#d55750'],
  ['NO_OUTPUT_EVIDENCE', '未见计算输出', '#d9aa52'],
  ['UNKNOWN', '状态未知', '#9a91a8'],
] as const;

/** 任务类型：顺序与配色照抄 tool-rows.tsx 的 scanTypes。 */
export const scanTypes = [
  ['RELAXATION', '结构优化', '#5795d1'],
  ['STATIC_SCF', '静态 / SCF', '#53b7a5'],
  ['NEB', 'NEB', '#a490d8'],
  ['FREQUENCY_ZPE', '频率 / ZPE', '#d9b36d'],
  ['AIMD', 'AIMD', '#6eafd1'],
  ['OTHER', '其他 / 未识别', '#8c9cae'],
] as const;

/** 输入检查分类：照抄 tool-rows.tsx InputChecks 的 categories。 */
export const checkCategories = [
  ['PASS', '规则通过', '#279d69'],
  ['WARN', '注意', '#d9aa52'],
  ['RULE_FAIL', '规则未过', '#d55750'],
  ['FILE_FAIL', '文件异常', '#a8414a'],
  ['NOT_REQUESTED', '未套规则', '#9a91a8'],
] as const;

/** 检查规则档位名：照抄 tool-rows.tsx 的 profileNames。 */
export const profileNames: Record<string, string> = {
  'basic-inputs': '基础输入', 'static-scf': '静态 SCF', 'structure-optimization': '结构优化',
  'frequency-zpe': '频率 / ZPE', aimd: 'AIMD', neb: 'NEB',
};

/** 工具名 → 中文动作：照抄 tool-rows.tsx 的 titles。 */
export const titles: Record<string, string> = {
  vasp_scan: '扫描计算目录',
  vasp_inspect_task: '查看计算状态',
  vasp_inspect_tasks: '查看计算状态',
  vasp_convergence: '查看收敛曲线',
  vasp_collect_results: '查看计算数据',
  vasp_structure_scene: '查看原子结构',
  vasp_discover_inputs: '寻找构建材料',
  vasp_check_inputs: '校验 VASP 输入',
};

/** CPK 元素色，与 elementColors.ts 完全一致。 */
export const elementColors: Record<string, string> = {
  H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5',
  C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Ne: '#b3e3f5',
  Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000',
  S: '#ffff30', Cl: '#1ff01f', Ar: '#80d1e3', K: '#8f40d4', Ca: '#3dff00',
  Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7', Mn: '#9c7ac7',
  Fe: '#e06633', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0',
  Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929',
  Kr: '#5cb8d1', Rb: '#702eb0', Sr: '#00ff00', Y: '#94ffff', Zr: '#94e0e0',
  Nb: '#73c2c9', Mo: '#54b5b5', Tc: '#3b9e9e', Ru: '#248f8f', Rh: '#0a7d8c',
  Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98f', In: '#a67573', Sn: '#668080',
  Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Xe: '#429eb0', Cs: '#57178f',
  Ba: '#00c900', La: '#70d4ff', Hf: '#4dc2ff', Ta: '#4da6ff', W: '#2194d6',
  Re: '#267dab', Os: '#266696', Ir: '#175487', Pt: '#d0d0e0', Au: '#ffd123',
  Hg: '#b8b8d0', Pb: '#575961', Bi: '#9e4fb5',
};

/** 元素 → CPK 颜色（与 StructureViewer.atomColor 同一套归一化）。 */
export function atomColor(element: string): string {
  const normalized = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return elementColors[normalized] ?? '#888888';
}

/** Van der Waals 半径（Å），抄自 StructureViewer.VDW_RADIUS。 */
export const VDW_RADIUS: Record<string, number> = {
  H: 1.2, He: 1.4, Li: 1.82, Be: 1.7, B: 2.08, C: 1.95, N: 1.55, O: 1.7,
  F: 1.73, Ne: 1.54, Na: 2.27, Mg: 1.73, Al: 2.05, Si: 2.1, P: 2.08, S: 2.0,
  Cl: 1.97, Ar: 1.88, K: 2.75, Ca: 1.973, Sc: 1.7, Ti: 1.7, V: 1.7, Cr: 1.7,
  Mn: 1.7, Fe: 1.7, Co: 1.7, Ni: 1.63, Cu: 1.4, Zn: 1.39, Ga: 1.87, Ge: 1.7,
  As: 1.85, Se: 1.9, Br: 2.1, Kr: 2.02, Rb: 1.7, Sr: 1.7, Y: 1.7, Zr: 1.7,
  Nb: 1.7, Mo: 1.7, Tc: 1.7, Ru: 1.7, Rh: 1.7, Pd: 1.63, Ag: 1.72, Cd: 1.58,
  In: 1.93, Sn: 2.17, Sb: 2.2, Te: 2.06, I: 2.15, Xe: 2.16, Cs: 1.7, Ba: 1.7,
  Pt: 1.72, Au: 1.66, Hg: 1.55, Pb: 1.96, Bi: 2.02,
};

export function vdwRadiusOf(element: string): number {
  const normalized = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return VDW_RADIUS[normalized] ?? 1.7;
}

/** 卡片内数字统一等宽，避免逐帧跳动。 */
export const TABULAR = { fontVariantNumeric: 'tabular-nums' } as const;
