# dsh-vaspflow

面向 [DeepSeek Harness (DSH)](https://deepseek.com) 的 **VASP 科研助手插件**：右侧任务面板（任务列表、收敛曲线、3D 结构查看、文件浏览）+ 一套共享的 Node 数据服务，并把数据服务以 `vasp_*` 工具暴露给 Agent。

> 配套的 **`vasp` Agent 预设**（科研助手模式）见 [preset-construction/build/vasp](../../preset-construction/build/vasp)，安装方法见仓库根 [README](../../README.md)。

---

## 功能一览

| 能力 | 说明 |
|---|---|
| **VASP 任务扫描** | 给定项目根目录，自动识别目录树中所有 VASP 计算任务（含 `OUTCAR` 或 `vasprun.xml`） |
| **收敛曲线** | 每个离子步的能量与最大力，图表可视化 |
| **3D 结构查看** | 可切换 `POSCAR` / `CONTCAR` / `*.vasp`，VESTA 式模型旋转、周期边界成键、原子/键/晶胞渲染 |
| **文件浏览** | 查看任务目录结构与文件内容（`INCAR` / `OUTCAR` / `CONTCAR` 等，500KB 截断预览） |
| **Agent 工具** | `vasp_scan` / `vasp_convergence` / `vasp_structure_scene` / `vasp_task_files` / `vasp_read_file`，与面板共用同一数据层 |
| **一键分析** | 选中任务后「分析此任务」，把任务上下文预填进对话输入框，交由 Agent 继续分析 |

---

## 安装

在 DSH 的 Web profile 上安装插件（`<name>` 换成目标 profile，如 `web`）：

```bash
# 方式一：从本地路径安装（克隆本仓库后）
dsh plugin --profile <name> add ./plugins/dsh-vaspflow

# 方式二：从 git 仓库安装
dsh plugin --profile <name> add https://github.com/<owner>/<repo>
```

安装后 **重启 DSH Web GUI**（不是刷新页面），在侧边栏出现 **VASP** 入口，右侧可打开任务面板。

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
npm install            # 或 pnpm install
npm run build          # 构建浏览器 bundle → lib/client.js
npm test               # 运行宿主单元测试
npm run verify         # 校验发布产物
```

**目录结构**

```
plugins/dsh-vaspflow/
├── package.json          # 插件元信息、exports、构建脚本
├── cordis.patch.yml      # 挂载到 DSH profile 的组合补丁
├── lib/
│   ├── index.js          # 宿主插件：HTTP 路由 + agent 工具
│   ├── client.js         # 浏览器 bundle（构建产物）
│   └── host/             # 数据层：scanner / parser / structure / task-files / task-store
├── src/client/           # 前端源码（React + three.js）
└── scripts/              # 构建 / 验证脚本
```

---

## License

MIT
