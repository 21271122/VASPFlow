# VASPFlow

为 [DeepSeek Harness (DSH)](https://deepseek.com) 打造的 **VASP 科研助手**：一个可安装的插件 + 配套的 Agent 预设，帮你自动识别 VASP 计算任务、可视化收敛趋势与晶体结构，并让 AI 深度参与数据处理与分析。

> **当前形态**：DSH 插件（`plugins/dsh-vaspflow`）+ `vasp` Agent 预设（科研助手模式）。仓库前身是 Electron 桌面应用，现聚焦于 DSH 插件化形态。

---

## 兼容性

当前开发和运行基线如下：

| 项目 | 已验证版本 |
|---|---|
| DSH | `0.1.0-rc.6` |
| Node.js | `18` 或更高版本 |
| 插件依赖安装器 | `pnpm` |

本插件尚未适配 DSH `0.1.2-rc.1` 的新版客户端模块体系。开发时请保持 DSH `0.1.0-rc.6`，并使用 `pnpm install --frozen-lockfile`，不要直接执行依赖升级命令。

---

## 组成

| 模块 | 路径 | 说明 |
|---|---|---|
| **dsh-vaspflow 插件** | [`plugins/dsh-vaspflow`](plugins/dsh-vaspflow) | 右侧任务面板 + Node 数据服务；不向普通 Agent 暴露 VASP 工具 |
| **vasp Agent 预设** | [`plugins/dsh-vaspflow/preset/vasp`](plugins/dsh-vaspflow/preset/vasp) | 随插件发布的“VASP 计算助手”预设：persona、专属 skills 与全部 `vasp_*` 工具 |
| **设计文档** | [`docs/`](docs/) | 插件设计文档 |

---

## 功能一览

- **VASP 任务扫描** —— 输入项目根目录，自动识别所有 VASP 计算任务（含 `OUTCAR` / `vasprun.xml`）；
- **收敛趋势看板** —— 每个离子步的能量与最大力曲线；
- **晶体结构看板** —— 3D 查看 `POSCAR` / `CONTCAR` / `*.vasp`，VESTA 式旋转、周期边界成键；
- **一键 AI 分析** —— 选中任务后「分析此任务」，自动生成 AI 辅助分析提示词送入对话；
- **VASP Agent 工具** —— 仅选择“VASP 计算助手”预设后可用：扫描、收敛、结构、文件、输入构建与校验，以及 `vasp_incar_validate` / `vasp_outcar_parse`；面板与 Agent 共用同一数据层。

---

## 快速开始

> 以下步骤面向"第一次接触 DSH + 本插件"的用户，从零开始，大约 5 分钟。

### 1. 前置条件

- **Node.js ≥ 18** —— 官网 [nodejs.org](https://nodejs.org) 下载安装；
- **pnpm** —— 在终端执行 `corepack enable`（Node 自带）；若不行则 `npm i -g pnpm`；
- **DSH（DeepSeek Harness）`0.1.0-rc.6`** —— 已安装。安装器优先使用 PATH 中的 `dsh`；Windows 上也能自动使用 npm npx 缓存里的该版本；
- **一个运行中的 DSH Web GUI**（后续面板加载目标）。

### 2. 克隆并安装插件

```bash
git clone https://github.com/21271122/VASPFlow.git
cd VASPFlow

# 一次安装插件和预设。web 是 DSH 最常用的 profile 名。
node ./plugins/dsh-vaspflow/scripts/install-dsh.mjs install --profile web --package ./plugins/dsh-vaspflow
```

这条命令会先确认 DSH 是已验证的 `0.1.0-rc.6`，再安装插件；只有成功后才复制 VASP Agent 预设。Windows 用户不必手动把 `dsh` 加入 PATH：若 DSH 是通过 npx 缓存启动的，安装器会自动找到它。已有预设默认不会被覆盖。

> **npm 发布后的更简短用法**：用户无需克隆仓库，直接运行：
>
> ```bash
> npx --yes dsh-vaspflow install --profile web
> ```

### 3. 重启并打开面板

1. **完整重启 DSH Web GUI**（不是刷新页面）；
2. 刷新浏览器；
3. 侧边栏出现 **VASP** 入口，点击后在右侧打开任务面板。

> 若侧边栏没有入口，或面板未出现，见下方「常见问题」。

### 4. 使用

1. 在面板顶部输入 **项目根目录路径**（包含 VASP 计算目录的文件夹），点「**打开**」；
2. 面板自动扫描并列出任务/目录/状态统计；
3. 选中任务：
   - **收敛图表** —— 看能量 / 最大力随离子步变化；
   - **3D 结构** —— 查看并切换 `POSCAR` / `CONTCAR` / `*.vasp`，拖拽旋转、缩放、平移；
   - **文件** —— 浏览任务目录与文件内容；
4. 点「**分析此任务**」把任务上下文送入对话，让 Agent 协助分析。

### 5. 使用 VASP Agent 预设

上一步的安装器会将随插件发布的 `vasp` 预设放入 DSH 用户预设目录，且默认不覆盖已有文件。重启 DSH 后，新建会话时选择 **VASP 计算助手** 预设即可；只有该预设会显示和调用全部 `vasp_*` 工具。

若你已修改本地预设，并希望用仓库版本替换它，可显式执行：

```bash
node ./plugins/dsh-vaspflow/scripts/install-dsh.mjs install --profile web --package ./plugins/dsh-vaspflow --replace
```

脚本会把旧预设重命名为带时间戳的备份目录，而不是直接删除。

> 从 VASPFlow `0.1.x` 升级到 `0.2.0` 时，必须执行一次带 `--replace` 的命令。`0.2.0` 起全部 `vasp_*` 工具只由新版 VASP 预设注册；旧预设不能启用它们。

### 常见问题

| 现象 | 处理 |
|---|---|
| `dsh` 命令不存在 | 确认 DSH 已安装、`dsh` 加入 PATH；或使用 DSH 的完整路径调用 |
| 提示 `pnpm is not recognized` | 先 `corepack enable` 或 `npm i -g pnpm` |
| 侧边栏没有 VASP 入口 | 确认是**完整重启** DSH（非仅刷新）；`dsh plugin --profile <name> list` 看插件是否在列 |
| 面板打开了但扫不出任务 | 确认目标目录确实含 `OUTCAR` 或 `vasprun.xml`；路径写的是**根目录** |
| Push/拉取报认证 | GitHub 走 HTTPS 需 Personal Access Token 或 SSH key，见插件 README |

> 更多细节见 [`plugins/dsh-vaspflow/README.md`](plugins/dsh-vaspflow/README.md)。

---

## 开发

```bash
cd plugins/dsh-vaspflow
pnpm install --frozen-lockfile
npm run build    # 构建浏览器 bundle
npm test         # 宿主单元测试
npm run verify   # 校验发布产物
npm run install-dsh -- install --profile web --package . # 本地测试一键安装器
```

**目录结构**

```
VASPFlow/
├── plugins/dsh-vaspflow/       # 核心插件
│   ├── lib/index.js            # 宿主：HTTP 路由 + agent 工具
│   ├── lib/client.js           # 浏览器 bundle
│   ├── lib/host/               # 数据层（scanner/parser/structure/...）
│   ├── lib/types/              # TypeScript 声明
│   ├── src/client/             # 前端源码（React + three.js）
│   └── preset/vasp/            # 随插件发布的 vasp Agent 预设
└── docs/                       # 设计文档
```

---

## License

MIT
