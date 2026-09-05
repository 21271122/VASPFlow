# dsh-vaspflow

面向 [DeepSeek Harness (DSH)](https://deepseek.com) 的 **VASP 科研助手插件**：右侧任务面板（任务列表、收敛曲线、3D 结构查看、文件浏览）+ 一套共享的 Node 数据服务。其 `vasp_*` 工具仅向随附的 VASP Agent 预设暴露。

> 本插件包内含可选的 **`vasp` Agent 预设**（科研助手模式），位于 [preset/vasp](preset/vasp)。安装方法见下文。

---

## 功能一览

| 能力 | 说明 |
|---|---|
| **VASP 任务扫描** | 给定项目根目录，自动识别目录树中所有 VASP 计算任务（含 `OUTCAR` 或 `vasprun.xml`） |
| **收敛曲线** | 每个离子步的能量与最大力，图表可视化 |
| **3D 结构查看** | 可切换 `POSCAR` / `CONTCAR` / `*.vasp`，VESTA 式模型旋转、周期边界成键、原子/键/晶胞渲染 |
| **文件浏览** | 查看任务目录结构与文件内容（`INCAR` / `OUTCAR` / `CONTCAR` 等，500KB 截断预览） |
| **VASP Agent 工具** | 仅在选择“VASP 计算助手”后可用：`vasp_scan` / `vasp_convergence` / `vasp_structure_scene` / `vasp_task_files` / `vasp_read_file` / `vasp_build_inputs` / `vasp_check_inputs` / `vasp_src_inspect` / `vasp_scan_templates` / `vasp_incar_validate` / `vasp_outcar_parse`；与面板共用同一数据层 |
| **一键分析** | 选中任务后「分析此任务」，把任务上下文预填进对话输入框，交由 Agent 继续分析 |

---

## 安装

### 兼容版本

当前唯一允许安装的 DSH 版本为 `0.1.0-rc.6`，且 `dsh` 命令必须在 PATH 中。安装器会先执行 `dsh --version`，检测到其他版本即停止，不会留下半安装状态。本插件尚未适配 DSH `0.1.2-rc.1` 的新版客户端模块体系。

从仓库检出版本安装时，在 DSH 的 Web profile 上执行下面这一条命令。它会同时安装插件和随附预设；`web` 是最常见的 profile 名：

```bash
node scripts/install-dsh.mjs install --profile web --package .
```

安装后 **重启 DSH Web GUI**（不是刷新页面），在侧边栏出现 **VASP** 入口，右侧可打开任务面板。

发布到 npm 后，普通用户可不下载仓库，直接运行：

```bash
npx --yes dsh-vaspflow install --profile web
```

安装器会调用 DSH 自己的插件命令来登记 bundle，再安装 VASP 预设；若找不到 `dsh` 命令，它会提示先安装 DSH。`--package .` 只用于仓库内本地测试，普通用户无需填写。

### 安装随附的 VASP Agent 预设

插件与预设属于同一个 VASPFlow 发布包，但 DSH 会把预设按会话加载。上述一键安装器会将 `preset/vasp` 复制到 DSH 的用户预设目录，默认不覆盖已有预设。重启 DSH 后，新建会话时选择 **VASP 计算助手**；只有该预设会注册全部 `vasp_*` 工具，普通预设不会看到它们。

若明确需要用插件包内的版本替换本地预设：

```bash
npx --yes dsh-vaspflow install --profile web --replace
```

旧预设会被保留为带时间戳的备份目录。

> 从 `0.1.x` 升级到 `0.2.0` 时，请务必执行一次 `node scripts/install-preset.mjs --replace`。新版将全部 `vasp_*` 工具限制为 VASP 计算助手预设；旧预设不能加载这套工具。

### 依赖

- **Node.js ≥ 18**
- **pnpm**（`dsh plugin` 依赖它；可用 `corepack enable` 或 `npm i -g pnpm` 安装）
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

### 键盘操作（3D 结构）
- 左键拖拽：模型旋转（VESTA 式，旋转轴保持在屏幕平面）
- 右键 / `Shift` + 左键：平移
- 滚轮：缩放
- 方向键 `←` / `→`：切换结构文件（需先聚焦 Tab 栏）

---

## 开发

```bash
cd plugins/dsh-vaspflow
pnpm install --frozen-lockfile
npm run build          # 构建浏览器 bundle → lib/client.js
npm test               # 运行宿主单元测试
npm run verify         # 校验发布产物
npm run install-preset # 安装随插件发布的 vasp Agent 预设
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
