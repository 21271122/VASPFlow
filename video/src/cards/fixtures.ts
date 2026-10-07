/**
 * fixtures.ts — 宣传片里出现的工具返回值样例。
 *
 * 字段名与插件宿主返回的结构保持一致（见 lib/host/output-schema.test.mjs
 * 与 src/client/tool-rows.tsx 的读取方式），数值是编的，形状不是。
 */
import { siCScene } from './scene';

export const ROOT = 'D:/vasp/SiC-slab-study';

/** vasp_scan */
export const scanValue = {
  rootPath: ROOT,
  directories: [
    'bulk-SiC-scf', 'slab-01-relax', 'slab-02-relax', 'slab-03-relax', 'slab-04-relax',
    'slab-05-relax', 'slab-06-relax', 'slab-07-relax', 'ads-CO-relax', 'ads-OH-relax',
    'ads-H2O-relax', 'neb-diffusion', 'zpe-ads-CO', 'aimd-300K', 'slab-08-relax', 'notes',
  ],
  tasks: [
    { rel_path: 'bulk-SiC-scf', label: 'bulk-SiC-scf', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'STATIC_SCF', label: '静态 / SCF' } },
    { rel_path: 'slab-01-relax', label: 'slab-01-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-02-relax', label: 'slab-02-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-03-relax', label: 'slab-03-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-04-relax', label: 'slab-04-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-05-relax', label: 'slab-05-relax', status_record: { code: 'RUNNING', label: '运行中' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-06-relax', label: 'slab-06-relax', status_record: { code: 'RUNNING', label: '运行中' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'slab-07-relax', label: 'slab-07-relax', status_record: { code: 'ERROR_DETECTED', label: '检测到错误' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'ads-CO-relax', label: 'ads-CO-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'ads-OH-relax', label: 'ads-OH-relax', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'ads-H2O-relax', label: 'ads-H2O-relax', status_record: { code: 'NO_OUTPUT_EVIDENCE', label: '未见计算输出' }, task_type: { code: 'RELAXATION', label: '结构优化' } },
    { rel_path: 'neb-diffusion', label: 'neb-diffusion', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'NEB', label: 'NEB' } },
    { rel_path: 'zpe-ads-CO', label: 'zpe-ads-CO', status_record: { code: 'TASK_COMPLETED', label: '已完成' }, task_type: { code: 'FREQUENCY_ZPE', label: '频率 / ZPE' } },
    { rel_path: 'aimd-300K', label: 'aimd-300K', status_record: { code: 'UNKNOWN', label: '状态未知' }, task_type: { code: 'AIMD', label: 'AIMD' } },
  ],
};

/** vasp_inspect_tasks */
export const inspectTasksValue = {
  rootPath: ROOT,
  results: [
    {
      relPath: 'slab-07-relax', status: { code: 'ERROR_DETECTED', label: '检测到错误', reason: '电子步未收敛，OUTCAR 中出现 ZBRENT: fatal error' },
      evidence: [
        { file: 'OUTCAR', message: 'ZBRENT: fatal error in bracketing' },
        { file: 'OSZICAR', message: '最后一步电子步 SCF 迭代 60 次仍未收敛' },
      ],
      outputFiles: [{ path: 'OUTCAR' }, { path: 'OSZICAR' }, { path: 'CONTCAR' }],
      inputCheck: { profileId: 'structure-optimization', label: '已套规则 · 通过' }, fileCount: 12, filesListed: true,
    },
    {
      relPath: 'slab-05-relax', status: { code: 'RUNNING', label: '运行中', reason: 'OSZICAR 在 30 秒内更新，离子步仍在推进' },
      evidence: [{ file: 'OSZICAR', message: '第 42 个离子步刚写入' }],
      outputFiles: [{ path: 'OUTCAR' }, { path: 'OSZICAR' }, { path: 'XDATCAR' }],
      inputCheck: { profileId: 'structure-optimization', label: '已套规则 · 通过' }, fileCount: 12, filesListed: true,
    },
    {
      relPath: 'ads-H2O-relax', status: { code: 'NO_OUTPUT_EVIDENCE', label: '未见计算输出', reason: '目录里只有输入文件，没有 OUTCAR / OSZICAR' },
      evidence: [{ file: 'INCAR', message: '仅发现输入文件，尚无输出' }],
      outputFiles: [],
      inputCheck: { profileId: 'structure-optimization', label: '已套规则 · 注意' }, fileCount: 5, filesListed: true,
    },
    {
      relPath: 'slab-01-relax', status: { code: 'TASK_COMPLETED', label: '已完成', reason: '达到离子步收敛判据，OUTCAR 正常结束' },
      evidence: [{ file: 'OUTCAR', message: 'reached required accuracy - stopping structural energy minimisation' }],
      outputFiles: [{ path: 'OUTCAR' }, { path: 'OSZICAR' }, { path: 'CONTCAR' }],
      inputCheck: { profileId: 'structure-optimization', label: '已套规则 · 通过' }, fileCount: 12, filesListed: true,
    },
  ],
};

/** vasp_convergence → ResultTabs(convergence) 的 rows */
const ionSteps = Array.from({ length: 26 }, (_, i) => i + 1);
const energies = [-168.4127, -170.8831, -171.9402, -172.4188, -172.6801, -172.8264, -172.9130, -172.9672, -172.9998, -173.0191,
  -173.0306, -173.0367, -173.0400, -173.0416, -173.0424, -173.0428, -173.0430, -173.0430, -173.0431, -173.0431,
  -173.0431, -173.0431, -173.0431, -173.0431, -173.0431, -173.0431];
const maxForces = [4.812, 3.106, 1.884, 1.207, 0.842, 0.611, 0.458, 0.351, 0.274, 0.216,
  0.172, 0.138, 0.111, 0.090, 0.074, 0.061, 0.051, 0.043, 0.037, 0.031,
  0.027, 0.024, 0.021, 0.019, 0.018, 0.017];

export const convergenceValue = {
  rootPath: ROOT,
  results: [
    { rel_path: 'slab-01-relax', rootPath: ROOT, ion_steps: ionSteps, energies, max_forces: maxForces, source_path: 'slab-01-relax/OSZICAR', _source: 'OSZICAR + OUTCAR' },
    { rel_path: 'ads-CO-relax', rootPath: ROOT, ion_steps: ionSteps.slice(0, 21), energies: energies.slice(0, 21).map((v, i) => v - 2.31 + i * 0.0002), max_forces: maxForces.slice(0, 21), source_path: 'ads-CO-relax/OSZICAR', _source: 'OSZICAR + OUTCAR' },
    { rel_path: 'neb-diffusion', rootPath: ROOT, ion_steps: ionSteps.slice(0, 18), energies: energies.slice(0, 18).map((v, i) => v + 0.44 + i * 0.0003), max_forces: maxForces.slice(0, 18), source_path: 'neb-diffusion/OSZICAR', _source: 'OSZICAR + OUTCAR' },
  ],
};

/** vasp_structure_scene → ResultTabs(structure) 的 rows（每行就是一份场景） */
export const structureValue = {
  rootPath: ROOT,
  results: [
    { ...siCScene, rel_path: 'slab-01-relax', file: 'CONTCAR' },
    { ...siCScene, rel_path: 'ads-CO-relax', file: 'CONTCAR' },
    { ...siCScene, rel_path: 'bulk-SiC-scf', file: 'POSCAR' },
  ],
};

/** vasp_check_inputs */
export const checkInputsValue = {
  rootPath: ROOT,
  profileId: 'structure-optimization',
  results: [
    { resolved: `${ROOT}/slab-01-relax`, poscarPotcar: 'OK', species: ['Si', 'C', 'H'], sd: '已设置：28 固定 / 6 放开', kpoints: '4×4×1 · Gamma 中心', incar: { ENCUT: 520, EDIFF: '1E-05', ISIF: 2, NSW: 200 }, input_check: { code: 'PASS', evidence: [] }, warnings: [] },
    { resolved: `${ROOT}/slab-02-relax`, poscarPotcar: 'OK', species: ['Si', 'C', 'H'], sd: '已设置：28 固定 / 6 放开', kpoints: '4×4×1 · Gamma 中心', incar: { ENCUT: 520, EDIFF: '1E-05', ISIF: 2, NSW: 200 }, input_check: { code: 'PASS', evidence: [] }, warnings: [] },
    { resolved: `${ROOT}/slab-05-relax`, poscarPotcar: 'OK', species: ['Si', 'C', 'H'], sd: '未设置 Selective dynamics', kpoints: '4×4×1 · Gamma 中心', incar: { ENCUT: 520, EDIFF: '1E-05', ISIF: 3, NSW: 200 }, input_check: { code: 'WARN', evidence: [{ message: 'ISIF=3 会改变晶胞，与固定基底的意图不一致' }] }, warnings: ['ISIF=3 与 Selective dynamics 同时出现'] },
    { resolved: `${ROOT}/slab-07-relax`, poscarPotcar: 'OK', species: ['Si', 'C', 'H'], sd: '已设置：28 固定 / 6 放开', kpoints: '4×4×1 · Gamma 中心', incar: { ENCUT: 520, EDIFF: '1E-05', ISIF: 2, NSW: 200 }, input_check: { code: 'FAIL', evidence: [{ message: '结构优化任务建议 EDIFF ≤ 1E-05，当前 1E-04' }] }, warnings: [] },
    { resolved: `${ROOT}/ads-H2O-relax`, poscarPotcar: 'COUNT_MISMATCH：POSCAR 18 个原子 / POTCAR 元素顺序 Si C H → C Si H', species: ['C', 'Si', 'H'], sd: '已设置：14 固定 / 4 放开', kpoints: 'MISSING', incar: 'PARSE_ERROR', input_check: { code: 'FAIL', evidence: [{ message: 'POSCAR 与 POTCAR 元素顺序不一致，VASP 会算错' }] }, warnings: [] },
    { resolved: `${ROOT}/zpe-ads-CO`, poscarPotcar: 'OK', species: ['Si', 'C', 'O'], sd: '已设置：32 固定 / 4 放开', kpoints: 'Gamma 单点', incar: { IBRION: 5, NSW: 1, NFREE: 2, POTIM: 0.015 }, input_check: { code: 'PASS', evidence: [] }, warnings: [] },
  ],
  consistency: { uniform: false, groups: [{ label: 'ENCUT=520' }, { label: 'ENCUT=400' }] },
};

/** vasp_collect_results（弛豫能量） */
export const collectValue = {
  rootPath: ROOT,
  query: { calculationType: 'RELAXATION', metrics: ['last_ionic_free_energy', 'last_max_force', 'ionic_steps'], scope: { subtrees: [{ relPath: 'ads', maxDepth: 2 }], taskPaths: ['slab-01-relax', 'slab-02-relax', 'slab-03-relax', 'slab-04-relax'] } },
  rows: [
    { relPath: 'slab-01-relax', composition: 'SiC', values: { last_ionic_free_energy: { status: 'ok', value: -173.0431 }, last_max_force: { status: 'ok', value: 0.017 }, ionic_steps: { status: 'ok', value: 26 } } },
    { relPath: 'slab-02-relax', composition: 'SiC', values: { last_ionic_free_energy: { status: 'ok', value: -172.9844 }, last_max_force: { status: 'ok', value: 0.021 }, ionic_steps: { status: 'ok', value: 24 } } },
    { relPath: 'slab-03-relax', composition: 'SiC', values: { last_ionic_free_energy: { status: 'ok', value: -172.9052 }, last_max_force: { status: 'ok', value: 0.024 }, ionic_steps: { status: 'ok', value: 31 } } },
    { relPath: 'slab-04-relax', composition: 'SiC', values: { last_ionic_free_energy: { status: 'ok', value: -172.8708 }, last_max_force: { status: 'ok', value: 0.030 }, ionic_steps: { status: 'ok', value: 28 } } },
    { relPath: 'ads/ads-CO-relax', composition: 'SiC-CO', values: { last_ionic_free_energy: { status: 'ok', value: -175.3620 }, last_max_force: { status: 'ok', value: 0.044 }, ionic_steps: { status: 'ok', value: 33 } } },
    { relPath: 'ads/ads-OH-relax', composition: 'SiC-OH', values: { last_ionic_free_energy: { status: 'ok', value: -174.9115 }, last_max_force: { status: 'ok', value: 0.038 }, ionic_steps: { status: 'ok', value: 37 } } },
    { relPath: 'ads/ads-H2O-relax', composition: 'SiC-H2O', values: { last_ionic_free_energy: { status: 'missing', value: null }, last_max_force: { status: 'missing', value: null }, ionic_steps: { status: 'missing', value: null } } },
  ],
  excluded: [{ relPath: 'notes', reason: '不是计算任务' }, { relPath: 'neb-diffusion', reason: '任务类型不符（NEB）' }],
  summary: { included: 7 },
};

/** vasp_discover_inputs */
export const discoverValue = {
  rootPath: ROOT,
  sources: {
    files: [
      { path: `${ROOT}/templates/POSCAR_SiC_2x2`, elements: ['Si', 'C'], coordType: 'Direct', hasSd: true, fFlags: 28, tFlags: 6, nAtoms: 34 },
      { path: `${ROOT}/templates/POSCAR_SiC_2x2_b`, elements: ['Si', 'C'], coordType: 'Direct', hasSd: true, fFlags: 28, tFlags: 6, nAtoms: 34 },
      { path: `${ROOT}/templates/POSCAR_SiC_3x3`, elements: ['Si', 'C'], coordType: 'Direct', hasSd: true, fFlags: 28, tFlags: 6, nAtoms: 34 },
      { path: `${ROOT}/bulk/bulk-SiC.vasp`, elements: ['Si', 'C'], coordType: 'Direct', hasSd: false, fFlags: 0, tFlags: 0, nAtoms: 8 },
      { path: `${ROOT}/bulk/bulk-SiC-scf/CONTCAR`, elements: ['Si', 'C'], coordType: 'Direct', hasSd: false, fFlags: 0, tFlags: 0, nAtoms: 8 },
      { path: `${ROOT}/ads/ads-CO-relax/CONTCAR`, elements: ['Si', 'C', 'O'], coordType: 'Direct', hasSd: true, fFlags: 32, tFlags: 4, nAtoms: 36 },
    ],
  },
  templates: [
    { dir: `${ROOT}/templates/incar-relax-520`, relPath: 'templates/incar-relax-520', params: { ENCUT: 520, EDIFF: '1E-05', ISIF: 2, NSW: 200, IBRION: 2 }, files: ['INCAR', 'KPOINTS', 'POTCAR'], missing: [], submit: 'lqf.sh' },
    { dir: `${ROOT}/templates/incar-relax-520-b`, relPath: 'templates/incar-relax-520-b', params: { ENCUT: 520, EDIFF: '1E-05', ISIF: 2, NSW: 200, IBRION: 2 }, files: ['INCAR', 'KPOINTS', 'POTCAR'], missing: [], submit: 'lqf.sh' },
    { dir: `${ROOT}/templates/incar-static`, relPath: 'templates/incar-static', params: { ENCUT: 520, EDIFF: '1E-06', ISIF: 2, NSW: 0, IBRION: -1 }, files: ['INCAR', 'KPOINTS', 'POTCAR'], missing: [], submit: 'lqf.sh' },
    { dir: `${ROOT}/templates/incar-zpe`, relPath: 'templates/incar-zpe', params: { ENCUT: 520, IBRION: 5, NSW: 1, NFREE: 2, POTIM: 0.015 }, files: ['INCAR', 'KPOINTS'], missing: ['POTCAR'], submit: null },
    { dir: `${ROOT}/templates/incar-old`, relPath: 'templates/incar-old', params: { ENCUT: 400, EDIFF: '1E-04', ISIF: 2, NSW: 100 }, files: ['INCAR', 'KPOINTS', 'POTCAR'], missing: [], submit: null },
  ],
};

/** vasp_build_inputs（预览态） */
export const buildValue = {
  projectRoot: ROOT,
  preview: {
    projectRoot: ROOT,
    planId: 'plan-2026-10-03-8f31',
    revision: 3,
    results: [
      { wrote: false, warnings: [] },
      { wrote: false, warnings: [] },
      { wrote: false, errors: ['POTCAR 缺失：templates/incar-zpe 下没有 POTCAR'] },
      { wrote: false, warnings: ['ISIF=3 会改变晶胞'] },
      { wrote: false, warnings: [] },
      { wrote: false, warnings: [] },
    ],
  },
};

export const buildTasks = [
  { dir: 'slab-08-relax', template: 'templates/incar-relax-520', source: 'templates/POSCAR_SiC_2x2' },
  { dir: 'slab-09-relax', template: 'templates/incar-relax-520', source: 'templates/POSCAR_SiC_2x2' },
  { dir: 'zpe-ads-OH', template: 'templates/incar-zpe', source: 'ads/ads-OH-relax/CONTCAR' },
  { dir: 'scf-slab-08', template: 'templates/incar-static', source: 'slab-08-relax/CONTCAR' },
  { dir: 'ads/ads-CO-2', template: 'templates/incar-relax-520', source: 'ads/ads-CO-relax/CONTCAR' },
  { dir: 'ads/ads-H2O-2', template: 'templates/incar-relax-520', source: 'templates/POSCAR_SiC_2x2_b' },
];
