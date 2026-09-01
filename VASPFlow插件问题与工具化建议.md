# VASPFlow 工具链：使用问题清单与工具化建议

- 使用场景：`NO_scan_structures`（26 个 NO 吸附结构，ABN/LCBN 两组 d 扫描）批量构建 VASP 结构优化任务
- 涉及工具：`vasp_build_inputs`、`vasp_check_inputs`、`incar_validate`（及隐含的 `vasp_scan` 系列）
- 报告日期：本次会话
- 修订说明：根据操作者复核修正 P3/P4/P5/P6 的事实与定性（见各条"修订"）

---

## 一、插件内问题（请维护方处理）

### P1【高】vasp_check_inputs 相对路径基准与 build 工具不一致

- **现象**：`vasp_build_inputs` 以 `projectRoot` 为基准解析任务目录，落盘正确；但 `vasp_check_inputs` 传相对目录时被解析到工具进程 cwd（本次为 `D:\Projects\deepseek harness\`），26 个目录全部误报 `POTCAR-POSCAR: NOT_FOUND`，结果完全不可用。
- **复现**：
  1. `vasp_build_inputs(projectRoot=D:\...\NO_scan_structures, dir="ABN_d=0.0", ...)` → 构建成功；
  2. `vasp_check_inputs(dirs=["ABN_d=0.0"])` → 输出 `-> D:\Projects\deepseek harness\ABN_d=0.0 | POTCAR-POSCAR: NOT_FOUND`。
- **影响**：校验环节给出误导性失败，用户必须额外排查路径解析，批量场景下是硬伤。
- **建议**：
  - 为 `vasp_check_inputs` 增加 `projectRoot` 参数，与 build 工具统一基准；
  - 或强制要求绝对路径，且当目录不存在时显式报 `DIR_NOT_FOUND: <解析后的绝对路径>`，而不是笼统的 `NOT_FOUND`。

### P2【高】incar_validate 不支持 `;` 分隔的同行多标签

- **现象**：`EDIFF = 1E-5; EDIFFG = -0.02` 是 VASP 合法写法（`;` 作为标签分隔符），但校验器按"一行一标签"解析，报"缺少 relax 任务必需标签: EDIFFG"。
- **复现**：对含 `EDIFF = 1E-5; EDIFFG = -0.02` 的 INCAR 执行 `incar_validate(jobType="relax")`。
- **影响**：合法 INCAR 被判定为非法；工作区被迫改写文件以迎合校验器（本次将 26 个 INCAR 拆行）。校验器应当识别 VASP 语法，而不是要求文件迁就解析器。
- **建议**：每行先按 `;` 切分，再对每个片断剥离行尾 `!` 注释、匹配 `TAG = value`；确保 `EDIFF`/`EDIFFG` 等同行标签均可被检测并单独取值校验。

### P3【中|修订】freeAtoms 规则执行时缺少与源文件 SD 旗标的差异反馈

- **修订说明**：初版写作"工具静默覆盖源 SD"，表述不准确。经复核：**旗标改写完全由操作者显式传入的 `freeAtoms=[55,56]` 触发**（工具忠实执行了指令），不存在工具自作主张；真正的问题是工具执行该规则时**没有任何与源文件旗标的差异提示**，导致操作者和工具双方都没意识到 24 个任务原本"55=N 固定、56=O 放开"的人为约束被统一改写为 54F/2T。定性应为：操作失误 + 工具缺反馈机制。
- **证据**：源文件 `ABN_d=0.2.vasp` 原子 55 为 `F F F`（24/26 个任务同），构建产物 `ABN_d=0.2/POSCAR` 原子 55 变为 `T T T`；构建输出仅一行 `SD: 54F, 2T`，无任何"55 由 F→T"提示。
- **影响**：d 扫描系列的人为约束（钉住 N 高度）可能被无感知改写，曲线物理含义失真。
- **建议**：
  - 当 `freeAtoms`/`fixedAtoms` 规则与源文件 SD 旗标不一致时，输出差异明细（如 `NOTE: 原子55 由 F 改为 T（源文件为 F）`），或至少统计 `N 个原子旗标被覆盖`；
  - 提供"保留源模型 SD"的选项（如 `sdPolicy: keep|override`），默认保留源文件，仅在显式要求时覆盖。

### P4【中】vasp_check_inputs 仅做逐目录独立检查，无批次（跨目录）一致性

- **是什么**：当前 `vasp_check_inputs` 对每个目录**单独**验证（该目录内 POTCAR-POSCAR 匹配、SD 旗标、INCAR 关键参数、KPOINTS），目录之间互不比较。批次一致性检查是指在一次调用中**跨目录比对**整批任务的约束模型是否一致。
- **为什么需要**：本批 26 个任务属于同一 d 扫描系列，理应共享同一 SD 模式（同样的固定/放开原子分布）、物种序、K 点和关键 INCAR 参数。若 24 个任务为"55F/56T"、2 个任务为"55T/56T"（源文件真实情况），逐目录检查全部 `[ok]`，但作为一条 E(d) 曲线，各点的物理含义已经不一致。逐目录检查天然抓不到这类"单看都对、合起来不一致"的问题。
- **建议**：对传入的目录集合做跨目录模式比对（SD F/T 分布、物种序、K 点、关键 INCAR 标签），输出形如"24/26 目录为模式 A（55F/56T），2/26 为模式 B（55T/56T）"的告警并列出差异目录。

### P5【低|修订】POSCAR 尾部零坐标占位行：非 CONTCAR 产物，对 VASP 无害，属健壮性问题

- **修订说明**：初版定性"中"并暗示来自 CONTCAR，均不准确。经查证：**26 个 .vasp 源文件（含 zip 内原始文件）本身就带 56 行 `0.00000000E+00` 占位**，文件头注释为 `Converted by xsd2pos.py`，即转换脚本的产物，**与 CONTCAR 无关**（VASP 写出的 CONTCAR 严格只含 N 原子坐标，从不补零行）。
- **严重性**：对 VASP 计算**无害**——VASP 读 POSCAR 时按数量行（54+1+1=56）读取坐标即停止，多余行忽略；vaspkit/pymatgen 同样按数量行读取，通常也能容忍。风险仅限于：(a) 按"全部行"解析的自研脚本/文本 diff 可能困惑；(b) 人工查看文件时误导。故降为"低"，定性为**卫生/健壮性问题，非正确性问题**。
- **建议**（可选增强）：
  - `vasp_build_inputs` 增加 `cleanPoscar` 选项（默认关，改由用户启用）：拷贝后剔除数量行以外的多余坐标行、去重 SD 行；
  - `vasp_check_inputs` 可选增加 `TRAILING_LINES` 提示项（默认不报警，仅 info 级）。

### P6【中|修订】vasp_build_inputs 的 template 字段是功能缺陷（崩溃），而非体验问题

- **修订说明**：初版列为"体验建议，非缺陷断言"。本次实测确认其为**可复现的功能缺陷**。
- **复现**（dry-run 即可）：
  ```
  vasp_build_inputs(projectRoot=..., dryRun=true,
    tasks=[{dir: "_t", poscarSrc: "...vasp", template: "输入文件"}])
  → [error] TypeError: Cannot add property incarSrc, object is not extensible
  ```
  最简调用（仅 dir + poscarSrc + template）同样崩溃。原因是实现中试图在传入的 task 对象上**动态添加**由模板解析出的 `incarSrc/kpointsSrc/potcarSrc/submitSrc` 属性，而该对象不可扩展（frozen），抛 TypeError。技能文档承诺"template 自动取模板目录内 4 个文件"，实际不可用。
- **影响**：26 个任务被迫每个显式写 4 个 `_src` 字段（104 次重复路径），模板复用价值归零。
- **解决方案**：
  1. **修复实现**：解析模板时先在内部构造新对象（拷贝任务字段为新对象），再在新对象上并入模板解析出的字段，绝不原地修改传入对象；
  2. **提交脚本自动识别**：模板目录内按候选名探测（`lqf.sh`/`submit.sh`/`run.sh`/`pbs.sh`/`slurm.sh`），而非写死 `lqf.sh`；
  3. **优先级**：任务级 `_src` 覆盖 > `template`；template 目录四文件不全时给出明确报错并列缺失文件；
  4. 修复后预期用法退化为：`template: "输入文件"` + 每任务仅 `dir` + `poscarSrc`（SD 规则、SYSTEM 覆盖照旧）。

### 说明：以下问题不属于插件

- `Set-Content -Encoding utf8NoBOM` 报错 —— DSH pwsh 沙箱受限模式的限制（改用 .NET API 绕开），非插件问题。
- POSCAR 首行注释截断（`(Bi replaced fr...`） —— 源数据由 xsd2pos.py 生成时的瑕疵，VASP 忽略注释行。
- 源文件尾部零坐标 —— 源数据转换产物（见 P5），插件按输入如实处理。

---

## 二、建议工具化的步骤（基于本次实际使用流程）

### A. 改进现有工具（小改动，收益最高）

| # | 工具 | 改进内容 | 优先级 |
|---|------|---------|--------|
| A1 | `vasp_check_inputs` | 支持 `projectRoot`；`DIR_NOT_FOUND`/`POTCAR_NOT_FOUND` 语义分离；输出解析后绝对路径 | 高 |
| A2 | `incar_validate` | 支持 `;` 同行多标签 + `!` 注释剥离 | 高 |
| A3 | `vasp_build_inputs` | freeAtoms 与源 SD 差异告警（P3）；`cleanPoscar` 可选增强（P5） | 高 |
| A4 | `vasp_check_inputs` | 批次（跨目录）一致性检查（P4） | 中 |
| A5 | `vasp_build_inputs` | **修复 template 字段崩溃** + 提交脚本候选名识别（P6） | 中 |

### B. 新增工具（把本次手工步骤封装为直接调用）

| # | 工具名（建议） | 用途 | 输入 → 输出 | 对应本次手工步骤 |
|---|---------------|------|------------|-----------------|
| B1 | `vasp_src_inspect` | 结构源文件盘点/体检：批量扫描 `*.vasp`/`POSCAR`/`CONTCAR`，解析头（物种、数量、SD 旗标、坐标行数、尾部垃圾行），跨文件比对一致性 | 目录 → 每文件 {species, counts, sdFlags, nCoord, junkLines} + 批次一致性报告 | pwsh 循环解析 26 个头文件 |
| B2 | `vasp_clean_poscar` | 清洗 POSCAR：剔除超量尾行、SD 去重/补全、规范化 | 文件/目录 → 清洗后文件（可写回或输出到暂存） | 手工建 `_poscar_clean` 暂存目录 |
| B3 | `vasp_set_sd` | **对已构建任务批量重设 SD 旗标**：按 `freeAtoms`/`fixedAtoms` 规则改写，dry-run + F↔T 差异表 | 目录列表 + 规则 → 差异报告 + 改写 | "待定方案：重写 26 个 POSCAR 的 SD" |
| B4 | `vasp_patch_incar` | 对已构建任务批量应用 INCAR 修改（替换/追加/拆分标签），dry-run 预览 | 目录列表 + 补丁规则 → 应用报告 | 手工拆分 26 个 INCAR 的 EDIFF/EDIFFG |
| B5 | `vasp_scan_templates` | 扫描项目内含 INCAR/KPOINTS/POTCAR/提交脚本的模板目录，抽取关键参数（IBRION/NSW/ENCUT/ISPIN/K 点） | 目录 → 模板清单 + 参数表 | （技能侧已有 python 脚本，建议并入插件） |
| B6 | `vasp_kpoints_write` | 生成/校验 KPOINTS（方案 gamma/monkhorst + 网格，如 331/gamma） | (网格, 方案) → KPOINTS 文本 | 本次未用到（模板已含），常规流程必备项 |

### C. 后续批次工作流参考（工具链覆盖全景）

1. `vasp_src_inspect` 盘点结构源 → 2. `vasp_scan_templates` 找模板 → 3. `vasp_build_inputs`(template 修复后 + SD 差异告警) 构建 → 4. `vasp_patch_incar` 微调 → 5. `vasp_check_inputs`(projectRoot + 一致性) 校验 → 6. 提交 → 7. `vasp_scan`/`vasp_convergence`/`vasp_outcar_parse` 分析。

---

## 三、附：本次校验基线（供维护方对照）

- 26/26 任务构建成功（written=true）；
- 校验通过项：POTCAR-POSCAR 匹配（Bi_d/N/O）、SD 56 原子（当前 54F/2T，由操作者显式指定）、SYSTEM 按任务覆盖、K 点 Gamma 3×3×1、INCAR 拆分 EDIFFG 后 26 标签解析通过。