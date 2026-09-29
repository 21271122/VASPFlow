# VASPFlow 工具优先、发言受控的 Agent 设计

> 设计基线：提交 `b058dc8`；插件 `dsh-vaspflow@0.2.4`；本机 DSH `0.1.0-rc.6`。本文是实施方案，尚未修改运行时。

## 1. 目标与边界

用户看到的常规 VASP 操作结果由工具视图直接呈现。模型不输出普通 assistant 正文；确实需要向用户发问、解释或回答非执行类问题时，必须调用专用发言工具。一次轮次以工具结果或专用发言结束，不为了形成结尾再复述工具结果。

“只许调用工具”约束的是**模型产生的 assistant 文本**。工具的结构化结果、失败信息、权限请求和宿主错误仍必须显示；不能因为静默策略隐藏警告、科学不确定性或用户需要作出的决定。仅对选用 `vasp` 预设的会话启用，普通 Agent 保持现状。

验收标准：

1. VASP 预设的成功轮次中，持久会话日志与界面均不存在未经过发言工具的非空 assistant 正文；混合“文字 + 工具调用”也不会短暂闪现文字。
2. 扫描、核查、构建预览、构建写入和检查结果均能单靠工具视图读懂状态、异常和下一步；点击结果仍可打开右侧看板。
3. 需要澄清、解释或纯问答时可正常说话；一轮只展示一份发言，没有原始工具参数或模型结果的重复卡片。
4. 预览确认与直接构建使用同一 `vasp_build_inputs` 参数；预览未写入、已写入数量、部分失败和确认后切换会话的状态均真实且持久。

## 2. 已核实的 DSH 边界

- 当前 `preset/vasp/agent.cordis.yml` 让模型在构建后“汇报”；`lib/index.js` 的 `output.render()` 还给出“建议回复”。这两处都在鼓励额外正文。客户端目前只用 CSS 隐藏紧随构建调用的 `assistant-step`，既不约束模型，也不处理其余六种工具。
- `@deepseek-ai/dsh-agent-loop@0.1.0-rc.6` 在 `ReactLoopAgent.step()` 中，**先**将每个模型分片写为 `assistant/chunk`，随后将组装后的块写为 `assistant/message`，再执行工具调用。因此事后检查完整消息或只隐藏 UI 都无法防止流式文字泄漏。
- 同一循环在没有工具调用时直接结束该轮；有工具调用时执行整个调用批次。成功工具可通过 `ToolRunContext.concludeTurn()` 标记 `concludesTurn`，循环在该批次提交后结束本轮。故终止工具应单独调用，不能与别的工具放在同一个 assistant 消息中。
- DSH 的 `GenerateOptions` 只有 `tools`，没有 `toolChoice/tool_choice`。不能把提供方“强制工具调用”当作当前版本已有能力。系统提示词是软引导；真正的约束需在宿主接受模型输出前验证。
- `llm/stream` 是可包装的 waterfall，可用于原型缓冲和检查流，但它不拥有会话事件与工具调度。正式约束应靠 Agent Loop 的输出策略扩展点；不能直接修改安装目录里的编译产物。

## 3. 推荐协议：领域工具 + 两个终止工具

领域工具仍是现有七个 `vasp_*`。新增 `vasp_say` 和 `vasp_done`，均只在 `vasp` 预设注册。`vasp_say` 用于必须说的话；`vasp_done` 表示当前工具视图已经构成交付物，无正文。不要把 `vasp_say` 设计成每次领域工具之后必调，否则只是把废话搬进工具参数，并额外增加一次模型往返。

| 当前情况 | 模型下一步 | 用户看到 |
| --- | --- | --- |
| 还需读取、分析或构建 | 调用相关领域工具 | 工具运行态及结果视图 |
| 结果已完整展示，轮次可结束 | 调用 `vasp_done`；已标记终止的工具可直接结束 | 最后一个领域工具结果 |
| 缺关键参数、需用户决定 | 单独调用 `vasp_say(kind="question")` | 一条清晰问题；本轮结束 |
| 用户问解释、判断或观点 | 必要工具后单独调用 `vasp_say(kind="answer")` | 一条答案；本轮结束 |
| 失败或结果有重大歧义 | 单独调用 `vasp_say(kind="blocker")`，或由工具错误视图直接说明 | 错误及可执行的下一步 |

建议 schema（示意，实际定义沿用 `defineTool` 的逐属性 `required` 语法）：

```js
vasp_say({
  kind: 'question' | 'answer' | 'blocker',
  text: string // 非空；常规上限 300 字，复杂解释可在用户明确要求时放宽
})
vasp_done({})
```

`vasp_say.execute(args, exec)` 校验 `kind/text`，成功后 `exec.concludeTurn()`，返回 `{ delivered: true }`；`vasp_done.execute(_, exec)` 同样终止，返回 `{ done: true }`。失败不得终止轮次。两者都不能与其他工具并列在同一 assistant 消息中：输出策略在任何工具开始执行前拒绝该批次。`vasp_done` 还要求本轮已有可见的领域工具结果，防止模型什么都没做就静默结束。它的工具行在常规聊天中不占视觉空间，但在轨迹/调试视图中可查。`vasp_say` 用 `tool.call.toolview` 将参数中的正文显示为一条普通回复，仅在工具成功结算后显示；工具结果本身只给模型简短确认，不再回显正文。持久记录保留原始工具调用和结果，切换对话后可恢复。

构建预览有明确的“等待用户点按钮”边界：`vasp_build_inputs` 成功返回 `dryRun: true` 与 `planId` 时可直接调用 `exec.concludeTurn()`，省掉额外的 `vasp_done`。直接构建不能自动终止，因为当前工作流可能还需 `vasp_check_inputs`。为避免同批次其他调用越过预览边界，输出策略要求 `vasp_build_inputs` 独占一个 assistant 消息。

## 4. 系统提示词草案

替换现有 persona 的“回复风格/构建回复”段，保留科研判断与文件安全规则。以下文案应作为一个稳定段落注入，而不是在工具结果中重复“建议回复”：

```text
你是 VASP 计算助手。当前会话采用工具输出协议。

输出协议：
1. 每一步只产生工具调用；不得直接输出 assistant 正文、前言、过程播报或结语。
2. 用户所需信息若已由工具结果视图表达，停止进一步分析，并调用 vasp_done 结束本轮；不要用 vasp_say 复述计数、路径、任务树或看板内容。
3. 仅在缺少关键输入需要追问、用户明确要求解释/建议、或工具结果无法充分说明阻碍时，单独调用 vasp_say。问题只问当前动作必需的信息；答案先给结论，再给关键依据。
4. vasp_say 与 vasp_done 必须是该步唯一的工具调用。不得把文字放在其他工具的参数里绕过发言规则。
5. 每轮只调用完成用户请求所需的最小工具链；同一证据不要重复读取。工具报错时不猜测成功，不隐藏异常。

构建协议：
- vasp_build_inputs 只表达构建意图，不传 dryRun。以该次结果的 dryRun、planId、wroteCount、count 为准。
- dryRun=true 且有 planId：界面显示“计划构建、尚未写入”与确认按钮；本轮到此结束。不要再次调用构建工具来确认，也不要检查尚不存在的目标目录。
- dryRun=false：界面显示实际写入数量及失败项。若用户要求构建并检查，再调用 vasp_check_inputs；之后用 vasp_done 结束。
- 用户点击界面的“确认构建”不会自动开启新的模型轮次；不要声称已经看见用户确认后的检查结果。

科学与安全：
- 状态和结论必须来自工具证据；输入规则通过不等于科学设置合理或作业已完成。
- 保留关键错误、约束冲突、物种顺序问题和不确定性。需要用户决定时使用 vasp_say(kind="question")。
```

如果宿主暂时未启用硬约束，提示词可先减少正文，但**不能**作为“不允许文本”的验收依据。

## 5. 工具调用结果与界面

结果分三层，保持数据来源清楚：

1. **Canonical value**：工具 `execute()` 返回完整结构化事实。包含路径、状态、证据、错误、构建计数与 `planId`；不能靠文案反向解析。
2. **模型可读结果**：`output.render()` 给下一步模型足够判断的信息，重点是异常、实际写入状态和下一步是否等待用户。去掉“建议回复”“请向用户复述”等提示；可以明确 `awaitUser: true`，但不能谎称按钮已被点击。
3. **用户视图**：`presentationMeta` 只承载重放和渲染所需字段；`tool.call.toolview` 直接呈现中文动作、对象、状态、紧凑任务行与异常。详情在右侧看板。所有七种工具采用 `docs/vaspflow-tool-rendering-plan.md` 的映射，避免一个塞满分支的巨型组件。

| 工具 | 对话默认结果 | 何时需要 `vasp_say` |
| --- | --- | --- |
| `vasp_scan` | 总量、运行/错误数、异常任务行 | 用户要求解释特定错误原因时 |
| `vasp_inspect_task` | 单任务状态与关键证据 | 证据矛盾或用户要诊断时 |
| `vasp_convergence` | 步数、末步能量，曲线进看板 | 用户要求物理趋势解释时 |
| `vasp_structure_scene` | 文件、化学式、原子数，3D 进看板 | 结构含义不能仅由视图表达时 |
| `vasp_discover_inputs` | 结构源、模板候选与冲突 | 候选有多个且用户尚未指定时，提一个选择问题 |
| `vasp_build_inputs` | 预览任务树或实际写入数；按钮由状态决定 | 只有预览失败或来源歧义无法由行内错误说明时 |
| `vasp_check_inputs` | 通过/警告/失败数与批次不一致 | 用户问检查规则或科学解释时 |

预览、确认、取消的 UI 状态继续以 `planId` 和保存的 outcome 为准；普通会话切换不得重新生成确认按钮。模型可读快照与看板当前磁盘状态需要分别标注。错误行必须保留文字，不靠颜色。工具失败、超时、权限拒绝使用现有宿主错误/审批视图，不能被“静默”吞掉。

## 6. Harness 代码级改造

### 6.1 插件仓库内

| 文件 | 改动 |
| --- | --- |
| `plugins/dsh-vaspflow/preset/vasp/agent.cordis.yml` | 按 §4 替换回复段；保留工具边界与科学规则。 |
| `plugins/dsh-vaspflow/lib/index.js` | 在 `registerVaspTools()` 注册两个终止工具；构建预览成功时标记终止；`output.render()` 移除建议回复，补充结构化等待/写入事实。 |
| `plugins/dsh-vaspflow/src/client/index.tsx` | 给 `vasp_say` 注册独立 `tool.call.toolview`；扩展其余六种工具行；删除针对 `assistant-step` 的 CSS 隐藏规则。 |
| `plugins/dsh-vaspflow/lib/host/*.test.mjs` | 断言终止标记、schema、预览状态、持久重放和模型结果不含建议回复。 |

工具体示意：

```js
async execute(args, exec) {
  const text = validateSpeech(args); // 拒绝空白、超限、未知 kind
  exec.concludeTurn();              // 仅在成功校验后调用
  return { delivered: true };
}
```

### 6.2 DSH 上游 Agent Loop：强约束所必需

目标是 `packages/core/agent-loop` 的 `ReactLoopAgent.step()`，不是改本机 `node_modules`。新增由 agent scope 提供的 `assistantOutputPolicy` 服务或等价能力（默认关闭；`vasp` 预设设为 `tool-only`），由当前 agent 的 scope 解析，不能从全局开关误伤其他预设。在 **session append 之前** 验证一次完整模型候选：

```js
// tool-only 会话暂存当前请求的 chunks；不向 session/event 发布文本增量。
const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
const candidate = assemble(chunks);
if (candidate.finish.kind === 'error') return failWithoutPublishingCandidate(candidate);
if (candidate.finish.kind === 'max-tokens') return failWithoutPublishingCandidate(candidate);

const blocks = candidate.blocks;
const calls = blocks.filter(b => b.type === 'tool-call');
const visibleText = blocks.some(b => b.type === 'text' && b.text.trim());
if (visibleText || calls.length === 0 || invalidTerminalBatch(calls)
    || calls.some(c => c.name === 'vasp_done') && !hasVisibleDomainResultThisTurn()) {
  throw new AssistantOutputPolicyError('TOOL_ONLY_OUTPUT_REQUIRED');
}

// 通过后，按原顺序追加 assistant/chunk 与 assistant/message，随后调度工具。
commitCandidate(chunks, blocks);
return executeToolCalls(calls);
```

检查必须覆盖：只有文字、文字与工具混合、空成功响应、伪造/未知工具、无可见结果却调用 `vasp_done`、终止工具和其他工具混用、构建工具与其他调用混用。无效候选以及失败或截断的部分候选不写入用户可见的 `assistant/chunk` 或 `assistant/message`，也不执行任何工具。记录不含原始正文的政策诊断事件，给用户一个明确的宿主错误；保留原有取消、max-tokens、提供方错误及工具权限流程的终止语义。首版采用**失败即停**，避免在没有规范重试边界时隐式再向模型请求。若错误率影响可用性，再在 Agent Loop 增加一次有界重试，并为重试建立可回放的尝试事件。

当前 `GenerateOptions` 没有 `toolChoice`。未来可以在 LLM 接口和支持它的适配器加入 `toolChoice: 'required'` 以减少违约；它只是模型侧优化，不能替代上述接收端验证。`llm/stream` 包装器可作为独立原型先做“缓冲后拒绝”，但须通过 scoped-session 集成测试证明只影响 `vasp` 会话；未证明前不把它当正式隔离边界。

### 6.3 执行顺序与门槛

1. 先给七个工具补齐自描述的结果视图，再移除“建议回复”。验证：只看工具行和看板就能判断成功、异常和下一步。
2. 注册并测试 `vasp_say`、`vasp_done` 与 persona。验证：纯问答、澄清、预览、直接构建四类轮次都能正常结束。
3. 在 DSH 上游加入 scoped 输出策略与持久事件测试。验证：无效文本从未进入会话日志或流式 UI，也不会触发同批工具。
4. 通过真实模型的回归对话逐步启用，记录违约率、额外模型步数、首结果延迟与无声失败率；只有无障碍结果可读且违约率可接受时，才默认开启 `vasp` 的工具输出协议。旧会话的历史正文保留原样；新协议只约束启用后的新轮次。

回归样例至少包括：纯问答；缺模板选择；扫描后核查；构建预览后切换对话再确认；直接构建后输入检查；部分写入失败；工具超时/权限拒绝；模型混合正文与工具；模型只输出正文；取消与恢复会话。普通预设须确认行为不变。

## 7. 主要取舍

- **收益**：工具结果成为单一事实来源，聊天不再重复任务树；预览/写入的措辞由状态数据决定，减少模型猜测。
- **成本**：`vasp_done` 通常多一个模型步骤；严格模式若完整缓冲候选，会推迟工具调用的流式展示。预览成功自动终止可抵消部分成本。
- **风险**：仅有提示词或 `vasp_say` 工具会让模型仍可直接说话；仅在客户端隐藏会留下持久文本并可能漏出流式片段。因此硬保证必须落在接收模型输出的 harness 边界。
