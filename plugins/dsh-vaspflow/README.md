# dsh-vaspflow

面向 [DeepSeek Harness (DSH)](https://deepseek.com) 的 **VASP 科研助手插件**：右侧任务面板（任务列表、收敛曲线、3D 结构查看、文件浏览）+ 一套共享的 Node 数据服务。其 `vasp_*` 工具仅向随附的 VASP Agent 预设暴露。

> 本插件包声明 **`vasp` Agent 预设**（科研助手模式），与插件一起安装。

---

## 功能一览

| 能力 | 说明 |
|---|---|
| **VASP 任务扫描** | 给定项目根目录，严格识别同时含 `POSCAR`、`INCAR`、`KPOINTS`、`POTCAR` 的 VASP 输入目录；NEB 父目录按专门规则识别 |
| **收敛曲线** | 每个离子步的能量与最大力，图表可视化 |
| **3D 结构查看** | 可切换 `POSCAR` / `CONTCAR` / `*.vasp`，旋转、周期边界成键、原子/键/晶胞渲染、点选测距；可按 a/b/c 方向扩胞、沿晶轴观察并导出 PNG |
| **文件浏览** | 查看任务目录结构与文件内容（`INCAR` / `OUTCAR` / `CONTCAR` 等，500KB 截断预览） |
| **VASP Agent 工具** | 仅在选择“VASP 计算助手”后可用：七个领域工具加 `vasp_say`、`vasp_done`；`vasp_inspect_tasks` 一次查看一个或多个任务的计算状态与输出证据，输入正确性由 `vasp_check_inputs` 按明确规则校验。文件正文另由文件读取工具查看 |
| **一键分析** | 选中任务后「分析此任务」，把任务上下文预填进对话输入框，交由 Agent 继续分析 |

Agent 工具的路径约定：扫描、状态查看和可视化使用 `rootPath` 加任务路径列表；`vasp_structure_scene` 使用结构引用列表（每项可指定文件）；批量构建/输入检查使用 `projectRoot + tasks/dirs`。`vasp_scan` 显示扫描目录、子目录、计算状态与任务类型的扇形图；`vasp_discover_inputs` 将结构文件按结构类型和目录树归组，点击文件可由 VASPFlow 弹窗预览，并显示候选模板的文件覆盖与 INCAR 参数组合。`vasp_inspect_tasks` 在目录树中展示所选任务的计算状态与依据；`vasp_check_inputs` 逐目录展示所检查的文件、规则和依据。收敛曲线和 3D 结构在对话内按任务切换并标注数据路径；结构窗口点击后才启用滚轮缩放。右侧文件列表或结构标签中的结构文件、任务标题或任务列表中的任务可拖到聊天内的结构卡片；拖入任务时仅加入该任务直属目录的结构文件，新增标签显示为黄色。右侧任务还可拖入收敛曲线卡片，作为独立标签页，或拖入计算状态卡片，补充状态与证据。这些工具不依赖会话内临时 `taskId`。

VASP 预设采用工具输出协议：模型的每一步必须调用工具。领域结果在对话中直接呈现；需要用户回答时调用内置 `ask_user_question`，解释或说明阻碍才用 `vasp_say`，结果已足够时用 `vasp_done` 结束。连续的思考与普通工具调用在 VASP 对话中折叠为一条可展开的工作记录；VASP 结果和提问卡片保持可见。预览成功会自动停在用户确认处。插件在模型分片进入会话日志前验证完整候选；违反协议的候选不会展示或执行，并给模型一次纠错重试；重试仍不合规才显示错误。这个检查只针对 VASP 预设，会等待一次模型响应完整生成后再展示该步结果。

---

## 安装

### 兼容版本

本分支适配 **DSH `0.2.0-rc.2`**（Web 与官方 Desktop 使用相同版本的运行时）。安装器会检查 CLI 版本；其它版本需要单独验证。旧版插件已保留在 Git 标签 `vaspflow-dsh-rc6-backup-2026-10-03`。

从仓库检出版本安装到 Web profile：

```bash
node scripts/install-dsh.mjs install --profile web --package .
```

插件包的第二个 bundle patch 会注册 `vasp` 预设，无需复制文件到 `.agent-presets`。安装后重启 DSH Web GUI，在侧边栏打开 **VASP**，新建会话时选择 **VASP 计算助手**。

本分支发布到 npm 后可运行：

```bash
npx --yes dsh-vaspflow install --profile web
```

安装器调用 DSH 的插件命令登记 bundle；`--package .` 用于仓库内安装。发布前请使用上面的本地安装命令。

### 官方 Desktop

Desktop 拥有独立的 `desktop` profile。请在 Desktop 的 **插件** 页面安装本地 `plugins/dsh-vaspflow` 目录（发布后可填 npm 包名），然后重启 Desktop。也可先启动 Desktop 一次以初始化 profile，完全退出应用，再用 **Desktop 自带**的 `dsh` 命令执行 `node scripts/install-dsh.mjs install --profile desktop --package .`；npm 安装的独立 DSH CLI 不能修改 Desktop profile。预设随 bundle 注册，同样选择 **VASP 计算助手**；普通预设不会看到 `vasp_*` 工具。

本地目录安装后的 profile 有自己的插件文件副本。修改已有文件可能同步到副本，但**新增模块文件不会自动进入副本**；新增文件后应在 Desktop 插件页重新安装/更新本地目录并重启，否则插件主模块可能因缺失 import 而无法加载，VASP 入口、预设和工具卡片会同时消失。Web 与 Desktop 的安装副本需分别更新。

从旧版升级时，旧的 `$DSH_HOME/.agent-presets/vasp` 不再被 DSH 0.2 读取；保留它作为用户数据备份即可。新预设沿用 `vasp` ID，安装新版 bundle 后可继续选择该模式。

### 依赖

- **Node.js：以 DSH 0.2 的要求为准**（本地验证使用 Node.js 22.23.2）
- **pnpm**（Web CLI 的 `dsh plugin` 依赖它；官方 Desktop 自带）
- **DSH**（`dsh` CLI 在 PATH 中）

`dsh plugin` 会自动 pnpm 安装插件依赖，并将之写入 profile 的 `dsh.profile.bundles` 层。

---

## 使用

1. 打开右侧 VASP 面板；
2. 输入 **项目根目录路径**（包含 VASP 计算目录的文件夹）并点「打开」；
3. 面板自动扫描并列出任务、目录与状态统计；
4. 选中任务：
   - **收敛图表** —— 看能量/力随离子步变化；
   - **3D 结构** —— 查看/切换结构文件、旋转缩放平移；
   - **文件** —— 浏览任务文件；
5. 点「**分析此任务**」把上下文送入对话，让 Agent 协助分析。

在 **VASP 计算助手** 对话中调用 `vasp_build_inputs` 后，插件默认生成预览，构建任务直接显示为树；点击任务名称可在右侧 VASP 看板查看来源映射、SD/POTCAR 检查与提醒。可把右侧结构文件拖到指定任务，替换 POSCAR 来源；把含 INCAR 的目录拖到指定任务，替换模板及该任务单独指定的 INCAR/KPOINTS/POTCAR 来源。两种投放都重新生成预览，确认前不会写入。勾选任务并确认后，插件只执行本次预览中选中的任务；取消预览不会写入文件。确认或取消的结果按会话记录，并进入后续模型上下文，避免模型把已写入任务误认为仍待确认。选择「交给 AI 直接构建」会执行本次所选任务，并让后续调用直接写入；可在任务树或右侧看板中恢复预览确认。`dryRun` 是插件全局模式，不由 AI 填写。模式在当前插件进程内共享；重启后按插件配置重新初始化（默认预览）。

### 键盘操作（3D 结构）
- 左键拖拽：模型旋转（VESTA 式，旋转轴保持在屏幕平面）
- 右键 / `Shift` + 左键：平移
- 滚轮：缩放
- 点击结构画布后，方向键 `←` / `→` / `↑` / `↓`：旋转模型；`Shift` + 方向键：按设置步长的十分之一微调
- 点击原子：查看元素与坐标；连续点选两个原子可测量距离
- 对话卡片中的结构和收敛曲线保留目录树与独立标签栏：聚焦标签后用 `←` / `→` 切换，拖动标签可排序；目录树的根目录默认展开，点击可将整棵树收成一行
- 齿轮按钮：切换球棍/空间填充、化学键、晶胞、背景、原子大小、键粗细和方向键旋转步长；a/b/c 各可选 1–4 倍显示扩胞（默认 1×1×1，只改变视图，不修改文件，大型结构会限制倍数）；“边界外成键原子”只控制为了画跨晶胞化学键而补在视图最外侧的邻居原子，结构没有这类键时不可切换；还可沿 a/b/c 晶轴观察并导出当前视角 PNG

---

## 开发

```bash
cd plugins/dsh-vaspflow
pnpm install --frozen-lockfile
npm run build          # 构建浏览器 bundle → lib/client.js
npm test               # 运行宿主单元测试
npm run verify         # 校验发布产物
npm run install-dsh -- install --profile web --package . # 本地测试一键安装器
```

**目录结构**

```
plugins/dsh-vaspflow/
├── package.json          # 插件元信息、exports、构建脚本
├── cordis.patch.yml      # 挂载到 DSH profile 的组合补丁
├── lib/
│   ├── index.js          # 宿主插件：HTTP 路由 + 预设专属工具服务
│   ├── client.js         # 浏览器 bundle（构建产物）
│   └── host/             # 数据层：scanner / parser / structure / task-files / task-store
├── src/client/           # 前端源码（React + three.js）
├── preset/vasp/          # 随插件发布的 Agent 预设、工具与 skills
└── scripts/              # 构建 / 验证脚本
```

---

## License

MIT
