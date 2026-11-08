# DSH 0.2.2-rc.1 升级评估

核查日期：2026-11-09。结论：可以安排迁移，但当前 VASPFlow 不能仅修改版本号后直接覆盖升级。应先修复提示词上下文与工作目录接入，在独立运行环境验收，再切换日常环境。

## 版本与核查范围

- 官方 npm `@deepseek-ai/dsh` 的 `latest`、`next` 均为 **0.2.2-rc.1**，`alpha` 为 0.2.2-alpha.3；0.2.2-rc.1 于 2026-11-04 发布，GitHub 仍标为预发布。
- 项目实际依赖、安装器与启动脚本锁定 **0.2.0-rc.2**。此次查询官方 npm 的精确 `@deepseek-ai/dsh@0.2.0` 返回 404，因此本文按项目真实基线比较，不将 rc.2 等同于正式 0.2.0。
- 新版运行时要求 **Node.js >=24.9.0**；当前终端为 **22.23.2**。VASPFlow 自身清单的 `node >=18` 不代表新版 DSH 能在 Node 18/22 运行。
- 特别注意：核查时 `@deepseek-ai/dsh-tools` 的 `latest` 指向 **0.0.1-rc.1**，而 `next` 才指向 0.2.2-rc.1。升级接口包应写精确版本，不能直接安装 tools@latest。

已下载两个版本的官方 npm 包、校验归档 SHA-512，并对照类型声明与发布源码；缓存位于被 Git 忽略的 `output/dsh-upgrade-audit/`。未安装新版宿主、未修改现有 DSH_HOME、未运行新版 Desktop，也未改动插件代码。

## 相对旧版的主要更新

0.2.1 系列增加或完善上下文压缩、SDK 会话恢复、工作目录切换、SSH helper、插件发现与热重载、开发者工具，以及模型配置能力。[官方 0.2.1 汇总](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)

0.2.2 系列进一步改善移动端和窄屏、文件预览目录树、引用与会话导出、插件更新恢复、工作树与代码审查、调试统计、历史会话与滚动恢复；底层同时更新了运行时、工具执行和会话 API。[官方 0.2.2 汇总](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)

配置层另有凭据读取优先级调整、Azure provider 改名，以及自定义 profile 重建会替换插件与设置等变更；是否需要处理取决于当前配置。[官方配置变更说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.3)

## 与 VASPFlow 有关的接口变化

| 接入点 | 比对结论 | 迁移工作 |
|---|---|---|
| `system-prompt/assemble` | **确定需要修改**。回调从完整 `PromptAssembly` 改为 `PromptPresentation`，不含 tools；工具列表在回调结束后由宿主附回 | 替换 `lib/index.js` 中依赖 `assembly.tools` 的判断。优先在 VASP 作用域注册 `systemPrompt.context`，按 `scope`、`toolSet` 查询当前工具；构建状态作为必要运行上下文处理 |
| 会话工作目录 | **切换目录场景确定有风险**。新版由 `workingDirectory` 服务维护有效目录；`session.header.cwd` 保留创建时的原项目 | 将 `workspaceOf()` 改成异步读取有效目录，有 Agent 时使用 `workingDirectory.ensure(agent, signal)`；显式传入的 projectRoot/rootPath 继续优先。旧版无该服务时才回退旧接口 |
| `defineTool`、注册与输出 | 当前用到的 `execute(args, exec)`、`output.schema/render/presentationMeta`、`presentCall/presentResult`、`concludeTurn()` 均仍存在 | 保留 VASP 数据层，升级依赖后用新版真实工具执行管线重新验收；不能只跑旧依赖下的 mock 测试 |
| 工具准入与 PTC | 新增按步骤解析的工具集合，Native/PTC executor 拆分；旧 tools.mode、DSH_TOOLS_MODE 需迁移 | 现有 VASP 工具未直接调用旧 resolve API，但预设与 PTC 配置需对照新版默认组合重新核对；先验收原生调用，再验收 PTC |
| `llm/stream` | 保留流式 hook 与辅助请求 purpose。普通 Agent 请求的系统提示位于 messages 中，不能假定 options.system 是完整提示词 | 保留内部摘要/标题放行规则；核对恢复重试如何保留原系统消息，补真实请求形态测试，区分 Agent、摘要、标题及自动审核 |
| 浏览器工具卡片 | `tool.call.toolview`、keyed 注册、phase/block 仍存在；不能据此认定全部 UI 无需验证 | 保留卡片和业务组件，检查准备中、执行中、完成、刷新历史、部分确认及重新预览各状态 |
| 工作区选择器 | `workspaces.list.getSnapshot/subscribe` 仍存在 | 不是已发现的破坏性变化；核对注入声明与换工作区后的实际路径即可 |
| 右侧面板 | 宿主仍有 frame grid，但 VASPFlow 直接改 DOM/grid，并兼容第三方面板，不属于稳定布局契约 | 在新版 Desktop/Web 检查拖宽、折叠、窄屏、侧栏与第三方面板并存。不能把现有布局单测通过视为新版视觉验收通过 |
| HTTP 路由 | `webServer.register({kind,path,handler})` 仍支持；新增资源响应、TLS 等能力 | 现有路由无须为了升级重写为新资源 API；Web 绑定地址配置若用通配地址需按新版规则调整 |
| 打包、安装与启动 | tools 的 peer/dev 版本、安装器精确版本检查，以及 Desktop 路径都仍指向 rc.2 | 在迁移版本里更新依赖、锁文件、受支持版本列表，添加已验证的 engines.dsh；启动脚本接收独立的新 Home/Exe，不覆写旧设置 |

接口依据：[提示词源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/core/system-prompt/src/index.ts)、[有效工作目录服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/session/working-directory/src/index.ts)、[工具接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/core/tools/src/contracts.ts)、[LLM 请求接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/llm/llm/src/types.ts)。

### 已复现的兼容问题

当前 `lib/index.js` 的构建状态注入以 `assembly.tools?.some(...)` 为前提。用同一构建计划分别调用当前 hook：旧版形态含 tools 时输出 1 段状态上下文，新版 PromptPresentation 形态不含 tools 时输出 0 段。风险是用户已在界面确认后，模型下一轮收不到确认记录。

这是对实际插件 hook 的最小契约复现，不是完整新版宿主测试。提示词迁移必须覆盖预览待确认、已确认、已取消、失效、重启恢复，并验证普通预设不收到 VASP 专属上下文。

## 安全升级顺序

1. **保存当前基线。** 当前工作树有上一轮审查的未提交修复。先保存这些改动、当前插件发布包及原版本依赖锁，再建立升级分支；不要通过清空工作树开始迁移。
2. **保留旧环境。** 完全退出 DSH 后，备份实际使用的完整 DSH_HOME（配置、profiles、会话、凭据、vaspflow 状态）和原 Desktop 安装目录。备份放在仓库外，不能提交到 Git。
3. **并行准备新版。** 独立安装 Node >=24.9 或使用新版 Desktop 自带运行时；使用全新的测试 DSH_HOME 与 profile。第一阶段用全新数据，不让新版打开日常 Home，也不让旧版读取新版已写入的数据。
4. **在隔离副本适配。** 优先修提示词上下文、有效目录，再更新精确依赖与安装器、核对预设。保留旧版适配分支；不要简单移除版本检查或使用强制豁免来假装兼容。
5. **分层验收。** 先在旧版跑当前回归，再在新版实际依赖和真实宿主运行同等测试。检查扫描、结构/超胞、收敛、文件读取；批量预览不落盘；确认后只写所选任务；重复确认不重复写；拖换来源与失效；重启恢复；普通预设隔离；切换 cwd/worktree 后写入正确目录；长对话压缩和标题不受输出门禁干扰。
6. **单独验收布局。** 两个运行环境使用相同窗口尺寸、同一份项目副本，对比浅/深色、宽/窄窗口、右侧拖宽与折叠、工具卡片和第三方面板共存。先保留现有 CSS 与组件布局，避免同时做设计调整。
7. **切换与回滚。** 所有门槛通过后，再用关闭状态下复制的旧 Home 做迁移演练，最后切换正式入口。回滚时启动旧程序配原封保留的旧 Home；不对新版已迁移的目录做原地降级。

已有的 118 项测试只证明当前依赖环境的回归基线，不证明 0.2.2-rc.1 兼容。

## 隔离启动命令示例（供实施阶段使用，本次未执行）

先确保执行这些命令的 Node 已达到 24.9，并确认下列测试 Home 是新目录。此命令只是启动独立新版宿主，尚不表示当前 VASPFlow 已适配：

```powershell
$env:DSH_HOME = 'D:\Apps\DeepSeekHarness-0.2.2-rc.1-test\home'
npx --yes @deepseek-ai/dsh@0.2.2-rc.1 --profile vaspflow-upgrade --from-default-profile web
```

首次初始化并退出后，后续启动使用同一命令但去掉 `--from-default-profile web`。该选项用于重建，不应在已有测试 profile 上反复使用。实际安装适配后的插件时，使用新版自身的插件管理命令与同一测试 Home。

Desktop 验收使用独立 Desktop 安装和 Home；独立 npm CLI 不能管理 Electron 专属 desktop profile。[官方 CLI 与配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/cli/README.md)
