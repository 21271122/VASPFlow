# dsh-vaspflow 插件功能说明

> 面向 DeepSeek Harness (DSH) 的 VASP 科研助手插件。右侧面板（任务列表 / 收敛曲线 / 3D 结构 / 文件浏览）+ 宿主 Node 数据服务 + 11 个仅由配套 `vasp` Agent 预设暴露的 `vasp_*` 工具。

## 1. 定位

本插件把 VASP 计算目录的**扫描、可视化、输入构建、校验分析**全部接入 DSH：

- **人与 Agent 共享同一数据层**：面板看到的数字 = Agent 工具返回的数字（同一个 TaskStore / 同一套解析器）；
- **面板 ↔ Agent 双向联动**：分析此任务把任务上下文预填进对话；Agent 调用 `vasp_scan` 等工具后面板自动刷新；
- **领域判定确定性优先**：SD 旗标、POTCAR 匹配、INCAR 校验等判定由工具完成，不依赖模型猜测。

## 2. 架构总览

```
浏览器（DSH Web GUI）          宿主进程（Node）                  Agent 层
┌─────────────────────┐     ┌───────────────────────┐     ┌────────────────────────┐
│ L1 右侧面板 (React)  │────▶│ L2 数据服务             │────▶│ L3 vasp Agent 预设      │
│ 任务树/表、收敛图、   │  ▶ │ /plugins/dsh-vaspflow/* │  ▶ │ persona + skills       │
│ 3D 结构、文件浏览、    │  │ │ TaskStore（内存态）      │  │ │ vasp_incar_validate   │
│ 一键分析、自动刷新    │◀──│ vasp_* × 11 个 Agent 工具│◀──│ vasp_outcar_parse      │
└─────────────────────┘     └───────────────────────┘     └────────────────────────┘
```

| 层 | 载体 | 内容 |
|------|------|------|
| L1 客户端 | `src/client/` + `lib/client.js`（bundle） | 侧边栏 VASP 入口 + 右侧 dock 面板 |
| L2 宿主 | `lib/index.js` + `lib/host/*` | HTTP 路由 + Agent 工具注册 + 数据层 |
| L3 预设 | `plugins/dsh-vaspflow/preset/vasp` | 科研助手 persona、3 个 skills；通过预设专属 bridge 注册全部 11 个工具 |

## 3. Agent 工具（11 个，均以 `vasp_` 前缀暴露）

所有工具的输出都经宿主 JSON-Schema 校验器校验（`additionalProperties` 收紧、必填字段声明），调用失败有统一形如 `{ error: "string" }` 的契约。

### 3.1 扫描与巡检

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `vasp_scan` | 扫描目录树，识别含 OUTCAR/vasprun.xml 的 VASP 任务，返回任务元数据（状态/步数/能量/晶格/INCAR 摘要）并写入 TaskStore | `rootPath` |
| `vasp_src_inspect` | **构建前源体检**：扫描 `*.vasp`/POSCAR/CONTCAR，报告物种/数量/坐标类型/SD 旗标统计/坐标行数/尾部垃圾行，并跨文件一致性比对 | `rootPath`, `maxDepth` |
| `vasp_scan_templates` | 扫描含 INCAR 的模板目录，报告文件齐备度（INCAR/KPOINTS/POTCAR/提交脚本文件名）与关键 INCAR 参数，**仅供列候选给用户确认** | `rootPath`, `maxDepth` |

### 3.2 查询任务数据

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `vasp_convergence` | 每离子步能量 + 最大力（`ion_steps/energies/max_forces`），判断收敛趋势 | `taskId` |
| `vasp_structure_scene` | 3D 结构场景 JSON（晶胞/原子/键/键族/分子式摘要），默认 CONTCAR | `taskId`, `file` |
| `vasp_task_files` | 任务目录文件/子目录清单 | `taskId` |
| `vasp_read_file` | 读取任务内文本文件（500KB 截断，`truncated` 标志） | `taskId`, `name` |

### 3.3 构建输入（批量）

**`vasp_build_inputs`** —— 批量创建结构优化输入文件主工具。

| 参数 | 必填 | 说明 |
|------|------|------|
| `projectRoot` | ❌ | 任务 `dir` 与相对源路径的基准；缺省用当前会话工作空间 |
| `tasks[]` | ✅ | 任务列表，字段见下 |
| `dryRun` | ❌ | `true` 仅预览不写盘（**默认 `false` = 真实构建**）；返回 `written/wroteCount` 供断言 |
| `linkPotcar` | ❌ | 用硬链接替代复制 POTCAR |

**任务字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `dir` | ✅ | 目标目录（相对 `projectRoot`） |
| `poscarSrc` | 注 | POSCAR 源。**可选（分段构建）**：未提供时跳过 SD/POTCAR 校验，只复制其他文件并警告 |
| `template` | ❌ | **可选默认来源目录**：目录内存在的 INCAR/KPOINTS/POTCAR 自动作为来源；文件集合与位置由任务决定 |
| `incarSrc`/`kpointsSrc`/`potcarSrc` | ❌ | 各文件独立来源（可指向不同目录），优先级高于 template |
| `submitSrc` | 注 | 提交脚本（**不自动探测**；缺失仅警告 = 分段构建，稍后补充） |
| `sources` | ❌ | 文件→来源映射 `{ poscar, incar, kpoints, potcar, submit }`，每个文件可指向不同目录。优先级：`*Src` > `sources` > `template` |
| `incarOverrides` | ❌ | INCAR 参数覆盖：已有 tag 替换、缺失 tag 追加；**分号感知**（`EDIFF = 1E-5; EDIFFG = -0.02` 同行只替换目标 tag，兄弟 tag 保留） |
| `freeAtoms` | 注 | 1-indexed 放开原子（其余 F F F）；显式给出即按规则 |
| `fixedAtoms` | 注 | 1-indexed 固定原子（其余 T T T）；与 freeAtoms 互斥 |
| `sdPolicy` | ❌ | **`keep`（默认）** = 沿用源文件 SD 旗标原样；`override` = 必须显式二选一 |
| `extraFiles` | ❌ | **自定义/任意输入文件**（如 WAVECAR、CHGCAR、DOSCAR、自建势文件）：`[{ src: 显式路径（缺失→报错）, dest: 目标名（缺省=来源名）, fromTemplate: 从模板目录取（缺失→警告跳过） }]` |

> 显式给出 `freeAtoms`/`fixedAtoms` 时按显式规则；`sdPolicy: override` 且不显式 → 任务报错（绝不按元素序推断基底/吸附物）。未提供 POSCAR/提交脚本属于分段构建（警告，不中止）。

**行为契约**：

- 源坐标类型（Direct/Cartesian）与缩放因子/晶格行**原样保留**；
- POTCAR 元素与 POSCAR **等长且同序**才会 `OK`，否则任务报错不产出；
- **SD 差异反馈（`sdNotes`）**：`override` 模式下任何旗标被改写都会提示（如 `NOTE: 2 个原子旗标被改写（原子55 F F F→T T T）`），dry-run 即可见；
- 单任务错误不中断其余任务；`dryRun` 与真实构建共用同一校验路径。

### 3.4 校验输入

**`vasp_check_inputs`** —— 校验已构建（或任意）任务目录。

| 参数 | 必填 | 说明 |
|------|------|------|
| `dirs` | ✅ | 目录数组（相对 `projectRoot` 或绝对） |
| `projectRoot` | ❌ | 相对 `dirs` 的解析基准（与 build 一致，建议都传，避免路径基准漂移） |

**每目录输出**：`dir` / `resolved`（绝对路径）/ `species` / `poscarPotcar`（`OK`/`MISMATCH(长度|顺序)`/`POTCAR_MISSING`/`POTCAR_NO_TITEL`/`POTCAR_UNREADABLE`/`DIR_NOT_FOUND`）/ `sd`（F-T 统计 + `NO_SD`/`SD_DUP`/`FLAG_MISSING`/`TRAILING_LINES`/`COUNT_MISMATCH`）/ `incar`（关键参数）/ `kpoints` / `warnings` / `error`（恒为字符串，无错误为空串）。单目录异常标 `CHECK_CRASH` 不中断其余。

**顶层 `consistency`（批次一致性）**：跨目录比对 POTCAR-POSCAR / SD / K 点 / 物种 / 关键 INCAR（不含 SYSTEM）；`uniform=false` 时按模式分组列出差异目录——抓"单看都对、合起来不一致"的批次问题。

### 3.5 裸文本判定

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `vasp_incar_validate` | 校验 INCAR 文本的任务类型必需/禁用标签与常见组合矛盾；支持分号分隔的同行多标签 | `incarText`, `jobType` |
| `vasp_outcar_parse` | 解析 OUTCAR 文本的收敛标志、最新总能、离子步、常见错误签名与受力漂移 | `outcarText` |

## 4. HTTP 路由（面板数据服务，`/plugins/dsh-vaspflow/*`）

| 方法/路径 | 说明 |
|-----------|------|
| `POST /scan?root_path=` | 扫描项目 → `{project_id, tasks, directories}` |
| `GET /tasks/{id}` | 项目任务列表 |
| `POST /task/open-by-path?root_path=&rel_path=` | 单目录开任务 |
| `GET /task/{id}/convergence` | 收敛数据 |
| `GET /task/{id}/structure?file=` | 结构基础数据 |
| `GET /task/{id}/structure-scene?file=&include_connectivity=&bond_algorithm=` | 3D 场景 JSON |
| `GET /task/{id}/files` | 文件清单 |
| `GET /task/{id}/structure-files` | 结构文件清单 |
| `GET /task/{id}/file-content?name=` | 文本预览（500KB 截断） |
| `GET /version` | TaskStore 版本号（面板反向联动轮询） |
| `GET /ping` | 健康检查 |

数据层要点：OUTCAR 尾部 64KB 二进制读、OSZICAR 流式解析、按 (name,size,mtimeNs) 签名的元数据缓存、POTCAR TITEL 提取按 (size,mtime) 缓存并在收集满期望元素后提前终止。

## 5. 客户端面板（L1）

- **入口**：侧边栏 VASP 按钮（DOM 自愈挂载）；
- **形态**：右侧 dock 面板（与聊天并排，宽 340–1200px 可拖、宽度/折叠持久化）；
- **任务列表**：树视图（状态点：绿=收敛 / 青=未收敛 / 红=错误 / 橙=未知）+ 表视图（排序/筛选/分页）；
- **详情 Tabs**：收敛图表（能量 + 最大力双序列）、3D 结构（VESTA 式旋转、周期边界成键）、文件浏览（文本预览 + 截断提示）；
- **一键分析**：任务行「分析此任务」→ 任务上下文预填聊天输入框（可编辑）并聚焦；
- **反向联动**：Agent 调用 `vasp_scan` 等工具后面板自动刷新（TaskStore 版本轮询）。

## 6. 配套 vasp Agent 预设（L3，`plugins/dsh-vaspflow/preset/vasp`）

| 部件 | 内容 |
|------|------|------|
| persona | VASP 计算助手身份 + 硬规则（建作业前校验 INCAR/POTCAR 顺序、不覆盖 CONTCAR/WAVECAR、收敛判定与 VASP 错误签名识别、优先用 `vasp_*` 工具；构建用 `vasp_build_inputs`/`vasp_check_inputs`，不按元素序推断 SD，不自动探测模板/提交脚本） |
| skills | `vasp-structure-opt`（工具驱动协议：源体检→模板候选→dry-run→构建→校验→汇报）、`vasp-zpe-setup`（Plan 模式五节点确认→执行→验证）、`vesta-view` |
| 工具 bridge | 仅在该预设作用域注册全部 `vasp_*` 工具；其中 `vasp_incar_validate` 和 `vasp_outcar_parse` 处理裸文本 |

职责分工：宿主插件持有任务数据和全部工具实现；预设只在选择“VASP 计算助手”的会话中注册工具。这样普通 Agent 不会得到 VASP 工具，而面板和 VASP Agent 始终共用同一 TaskStore。

## 7. 关键设计决策（约定）

1. **SD 保持优先**：`sdPolicy` 默认 `keep`（沿源文件旗标原样：源无 SD 行 → 原样复制 + 警告；源有 SD 行但坐标缺旗标 → 报错）；显式 `freeAtoms`/`fixedAtoms` 按显式规则；`override` 且不显式 → 报错。绝不按元素序推断。
2. **提交脚本显式（可分段）**：`submitSrc` 不自动探测；缺失仅警告（分段构建，稍后补充），Agent 可询问用户。POSCAR/其他输入同理可分段提供。
3. **模板由用户决定**：Agent 最多用 `vasp_scan_templates` 列候选供确认；`template` 只是默认来源目录。
4. **输出契约**：输出必须过宿主校验器；`error` 恒为字符串；dry-run/真跑可区分（`dryRun/written/wroteCount` + `[dry-run]` 渲染前缀）。
5. **确定性判定**：POTCAR 等长同序、分号感知 INCAR、F/T 差异反馈、批次一致性比对均由工具完成。
6. **性能**：大文件只读尾部/流式、POTCAR 缓存 + 提前终止、元数据签名缓存；`--linkPotcar` 硬链接。

## 8. 安装 / 构建 / 测试 / 验证

```bash
# 从源码安装插件与预设（仅支持 DSH 0.1.0-rc.6）
node scripts/install-dsh.mjs install --profile web --package .

# 开发
cd plugins/dsh-vaspflow
pnpm install --frozen-lockfile
npm run build      # 构建浏览器 bundle → lib/client.js
npm test           # 宿主单元 + schema 校验测试（52 项）
npm run verify     # 产物一致性检查
```

生效方式：host 代码改动需**重启 DSH profile + 刷新浏览器**；`npm test` 覆盖工具注册、输出过校验器、sources/sdPolicy/一致性等契约。

## 9. 与历史形态的差异

- 原 `check_all_inputs.py`/`batch_build_dirs.py`/`scan_templates.py` 等 Python 脚本已**移除**，逻辑由宿主 JS 工具（`vasp_build_inputs`/`vasp_check_inputs`/`vasp_scan_templates`）取代；
- 原 `get_directory_structure.py`（勘察）由通用工具/`vasp_scan` 取代；
- 提交脚本不再自动探测、SD 不再按元素序推断（较旧 Python 版行为收紧）。
