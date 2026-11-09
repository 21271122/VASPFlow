# DSH 0.2.2-rc.1 适配

本分支的 VASPFlow 为 0.4.0，精确支持 DSH 0.2.2-rc.1，Node >=24.9.0。截至 2026-11-09，这也是 npm 的 latest / next，仍为预发布版。升级前的修复已推送到 `codex/publish-non-video`，提交 `7ae93c7`；不包含本地视频和录制演示素材。

## 安装和启动

使用 Node >=24.9.0、pnpm 和 DSH 0.2.2-rc.1，按 [README 的安装步骤](../README.md#快速开始)构建并安装插件，再运行 `dsh web`。如果要保留旧版环境，先将 `DSH_HOME` 指向一个新的目录，再初始化 Web profile 并安装插件。

官方 Desktop 使用独立的 `desktop` profile。请安装同版本 Desktop，再从插件页安装 VASPFlow。旧版 Desktop 的开发链接如果仍指向本目录，请将它改到升级前的副本。

## 接口改动

- 构建确认结果改用预设作用域的 `systemPrompt.context()`。新版 `system-prompt/assemble` waterfall 中尚无工具表，旧的 `assembly.tools` 检查会让确认结果不再进入后续提示词。新上下文保留在 VASP 预设内，不泄漏到普通预设。
- 未显式给出项目目录时，工具通过 `workingDirectory.ensure(agent, signal)` 获取会话已提交的当前目录。会话头的 cwd 只表示原始目录，切换工作目录后不再可靠。
- 工具输出协议的自动重试，向新版 messages 中的 system 消息追加恢复要求，保留原始消息；仍只重试一次，保留提供方错误和取消信息。
- VASP 预设以新版官方 Standard 配置重建，保留 `vasp` id、科研 persona、随附技能和专属工具；更新子代理配置，去掉旧版独立 list-agents 等条目。
- 精确锁定 dsh-tools 0.2.2-rc.1、schemastery 3.19，并声明 `engines.dsh`。不要使用 `@deepseek-ai/dsh-tools@latest`：该包的 latest 标签并未指向当前运行时版本。
- 右侧面板、卡片和对比预览的 CSS 与布局实现未变更，额外模板文件预览修复保留。

## 验证

使用 Node 24.22.2：

```powershell
cd plugins/dsh-vaspflow
pnpm install --frozen-lockfile
node --test lib/host/*.test.mjs src/client/*.test.mjs
node scripts/build-client.mjs
node scripts/verify.mjs
```

127 项回归测试全部通过，包含实际 React 预览组件的悬浮/额外文件/异常隔离测试；构建和发布产物检查通过。

真实 DSH 验证脚本可重复运行（全程使用临时 DSH_HOME，不请求模型 API）：

```powershell
# 在仓库根目录，使用准备好的 Node 24
$runtime = Join-Path $PWD 'output/dsh-upgrade-runtime'
$nodeExe = (Get-Content (Join-Path $runtime 'node-path.txt') -Raw).Trim()
$env:PATH = (Split-Path $nodeExe) + ';' + $env:PATH
$env:DSH_RUNTIME_ROOT = Join-Path $runtime 'host'
& $nodeExe plugins/dsh-vaspflow/scripts/verify-dsh-runtime.mjs
```

已通过官方插件安装、预设激活、10 个 VASP 工具作用域隔离、原生执行器、切换工作目录后的默认路径、额外文本文件预览、HTTP 确认写入及确认结果注入后续提示词。浏览器回归已验证 VASP 面板右侧停靠、拖动宽度、关闭重开和窗口缩放。本次未进行收费模型对话或 Electron UI 人工验收。

## 回退

停止新版服务，使用升级前副本和旧版 DSH_HOME。新环境与旧环境的数据目录独立；不要将新 profile 的整个配置覆盖回旧环境。当前插件声明的精确版本范围会拒绝不兼容运行时，不要添加版本豁免绕过它。
