# VASPFlow

为 [DeepSeek Harness (DSH)](https://deepseek.com) 打造的 **VASP 科研助手**：一个可安装的插件 + 配套的 Agent 预设，帮你自动识别 VASP 计算任务、可视化收敛趋势与晶体结构，并让 AI 深度参与数据处理与分析。

> **当前形态**：DSH 插件（`plugins/dsh-vaspflow`）+ `vasp` Agent 预设（科研助手模式）。仓库前身是 Electron 桌面应用，现聚焦于 DSH 插件化形态。

---

## 兼容性

当前开发和运行基线如下：

| 项目 | 已验证版本 |
|---|---|
| DSH | `0.2.0-rc.2` |
| Node.js | 以 DSH 0.2 的要求为准（本地验证使用 `22.23.2`） |
| 插件依赖安装器 | Web CLI 使用 `pnpm`；Desktop 自带运行环境 |

截至 2026-10-03，npm 发布的 DSH 最新版本为 `0.2.0-rc.2`，尚非稳定版 `0.2.0`。本分支按该版本验证；原 rc6 版本保存在 Git 标签 `vaspflow-dsh-rc6-backup-2026-10-03`。

---

## 组成

| 模块 | 路径 | 说明 |
|---|---|---|
| **dsh-vaspflow 插件** | [`plugins/dsh-vaspflow`](plugins/dsh-vaspflow) | 右侧任务面板 + Node 数据服务；不向普通 Agent 暴露 VASP 工具 |
| **vasp Agent 预设** | [`plugins/dsh-vaspflow/preset/vasp`](plugins/dsh-vaspflow/preset/vasp) | 随插件发布的“VASP 计算助手”预设：persona、专属 skills 与全部 `vasp_*` 工具 |
| **设计文档** | [`docs/`](docs/) | 插件设计文档 |

---

## 功能一览

- **VASP 任务扫描** —— 输入项目根目录，识别含 `POSCAR`、`INCAR`、`KPOINTS`、`POTCAR` 的计算任务及 NEB 目录；
- **收敛趋势看板** —— 每个离子步的能量与最大力曲线；
- **晶体结构看板** —— 3D 查看 `POSCAR` / `CONTCAR` / `*.vasp`，VESTA 式旋转、周期边界成键；
- **一键 AI 分析** —— 选中任务后「分析此任务」，自动生成 AI 辅助分析提示词送入对话；
- **VASP Agent 工具** —— 仅选择“VASP 计算助手”预设后可用：扫描、状态查看、收敛、结构、输入来源发现、构建与校验；面板与 Agent 共用同一数据层。

---

## 快速开始

> 以下步骤面向第一次接触 DSH 和本插件的用户。

### 1. 前置条件

- **Node.js** —— 版本满足 DSH 0.2 的要求；
- **pnpm** —— Web CLI 安装插件依赖时使用；
- **DSH（DeepSeek Harness）`0.2.0-rc.2`** —— 已安装。安装器优先使用 PATH 中的 `dsh`；Windows 上也能找到 npm npx 缓存里的该版本。

### 2. 克隆并安装插件

```bash
git clone https://github.com/21271122/VASPFlow.git
cd VASPFlow

# 安装包含 VASP 预设的插件 bundle。web 是 Web GUI 的 profile 名。
node ./plugins/dsh-vaspflow/scripts/install-dsh.mjs install --profile web --package ./plugins/dsh-vaspflow
```

这条命令会先确认 DSH 是已验证的 `0.2.0-rc.2`，再安装插件。VASP Agent 预设由 bundle 声明并注册，不再单独复制到 `.agent-presets`。安装后完整重启 DSH Web GUI。

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

**官方 Desktop** 使用独立的 `desktop` profile。请在 Desktop 的插件页面安装本地 `plugins/dsh-vaspflow` 目录，重启后打开 VASP 面板并选择 **VASP 计算助手** 预设。也可先启动 Desktop 一次、完全退出，再使用 Desktop 自带的 `dsh` 命令和上述安装器指定 `--profile desktop`；npm 安装的独立 CLI 不能修改 Desktop profile。

### 4. 使用

1. 在面板顶部输入 **项目根目录路径**（包含 VASP 计算目录的文件夹），点「**打开**」；
2. 面板自动扫描并列出任务/目录/状态统计；
3. 选中任务：
   - **收敛图表** —— 看能量 / 最大力随离子步变化；
   - **3D 结构** —— 查看并切换 `POSCAR` / `CONTCAR` / `*.vasp`，拖拽旋转、缩放、平移；
   - **文件** —— 浏览任务目录与文件内容；
4. 点「**分析此任务**」把任务上下文送入对话，让 Agent 协助分析。

### 5. 使用 VASP Agent 预设

安装插件 bundle 后，新建会话时选择 **VASP 计算助手** 预设即可；只有该预设会显示和调用全部 `vasp_*` 工具。旧版 `$DSH_HOME/.agent-presets/vasp` 不再由 DSH 0.2 读取，可保留作为备份。

### 常见问题

| 现象 | 处理 |
|---|---|
| `dsh` 命令不存在 | 确认 DSH 已安装、`dsh` 加入 PATH；或使用 DSH 的完整路径调用 |
| 提示 `pnpm is not recognized` | 先 `corepack enable` 或 `npm i -g pnpm` |
| 侧边栏没有 VASP 入口 | 确认是**完整重启** DSH（非仅刷新）；`dsh plugin --profile <name> list` 看插件是否在列 |
| 面板打开了但扫不出任务 | 确认任务目录同时含 `POSCAR`、`INCAR`、`KPOINTS`、`POTCAR`；路径指向其上级项目目录 |
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
