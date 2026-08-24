# VASPFlow

为 [DeepSeek Harness (DSH)](https://deepseek.com) 打造的 **VASP 科研助手**：一个可安装的插件 + 配套的 Agent 预设，帮你自动识别 VASP 计算任务、可视化收敛趋势与晶体结构，并让 AI 深度参与数据处理与分析。

> **当前形态**：DSH 插件（`plugins/dsh-vaspflow`）+ `vasp` Agent 预设（科研助手模式）。仓库前身是 Electron 桌面应用，现聚焦于 DSH 插件化形态。

---

## 组成

| 模块 | 路径 | 说明 |
|---|---|---|
| **dsh-vaspflow 插件** | [`plugins/dsh-vaspflow`](plugins/dsh-vaspflow) | 右侧任务面板 + Node 数据服务 + 5 个 `vasp_*` Agent 工具 |
| **vasp Agent 预设** | [`preset-construction/build/vasp`](preset-construction/build/vasp) | "VASP 计算助手"预设：persona、专属 skills 与校验工具 |
| **设计文档** | [`docs/`](docs/) | 插件设计文档 |

---

## 功能一览

- **VASP 任务扫描** —— 输入项目根目录，自动识别所有 VASP 计算任务（含 `OUTCAR` / `vasprun.xml`）；
- **收敛趋势看板** —— 每个离子步的能量与最大力曲线；
- **晶体结构看板** —— 3D 查看 `POSCAR` / `CONTCAR` / `*.vasp`，VESTA 式旋转、周期边界成键；
- **一键 AI 分析** —— 选中任务后「分析此任务」，自动生成 AI 辅助分析提示词送入对话；
- **Agent 工具** —— `vasp_scan` / `vasp_convergence` / `vasp_structure_scene` / `vasp_task_files` / `vasp_read_file`，面板与 Agent 共用同一数据层。

---

## 快速开始

### 前置条件

- **Node.js ≥ 18**
- **pnpm**（`corepack enable` 或 `npm i -g pnpm`）
- **DSH**（`dsh` CLI 在 PATH）

### 安装插件

```bash
# 克隆本仓库
git clone https://github.com/<owner>/<repo>.git
cd <repo>

# 安装到 DSH profile（<name> 换成目标 profile，如 web）
dsh plugin --profile <name> add ./plugins/dsh-vaspflow
```

安装后 **重启 DSH Web GUI**，侧边栏出现 **VASP** 入口。

> 详细介绍见 [`plugins/dsh-vaspflow/README.md`](plugins/dsh-vaspflow/README.md)。

### 安装 vasp Agent 预设

将 [`preset-construction/build/vasp`](preset-construction/build/vasp) 目录内容复制到 DSH 的用户预设根：

```bash
# 以 vasp 为预设 id 为例
cp -r preset-construction/build/vasp "$HOME/.dsh/.agent-presets/vasp"
```

之后新建会话时选择 **VASP 计算助手** 预设即可。可将 `agent-presets.default` 设为 `vasp` 使其成为默认。

> 预设结构即 `preset-construction/build/vasp` 目录本身（`preset.yml` + `agent.cordis.yml` + `skills/` + `tools/`）。

---

## 开发

```bash
cd plugins/dsh-vaspflow
npm install
npm run build    # 构建浏览器 bundle
npm test         # 宿主单元测试
npm run verify   # 校验发布产物
```

**目录结构**

```
VASPFlow/
├── plugins/dsh-vaspflow/       # 核心插件
│   ├── lib/index.js            # 宿主：HTTP 路由 + agent 工具
│   ├── lib/client.js           # 浏览器 bundle
│   ├── lib/host/               # 数据层（scanner/parser/structure/...）
│   └── src/client/             # 前端源码（React + three.js）
├── preset-construction/        # 施工文档 + vasp Agent 预设源
└── docs/                       # 设计文档
```

---

## License

MIT
