export const name = 'vasp-tool-only-output';

const TERMINAL = new Set(['vasp_say', 'vasp_done']);
const RECOVERY = Symbol('vasp-tool-only-recovery');
const RECOVERY_INSTRUCTION = '上一候选未遵守 VASP 工具输出协议，已被丢弃，任何工具都未执行。现在只调用一个当前可用工具：需要操作就调用对应工具；需要用户回答就调用 ask_user_question；仅需解释或说明阻碍才调用 vasp_say。不要输出普通 assistant 正文。';

function hasDomainResultThisTurn(messages) {
  // DSH represents tool results as user-role messages. Only an actual user
  // message starts a new turn; injected context and tool replies do not.
  const lastUser = messages.findLastIndex((message) => message.role === 'user' && message.source?.kind === 'user');
  if (lastUser < 0) return false;
  return messages.slice(lastUser + 1).some((message) =>
    message.role === 'assistant' && message.content?.some((block) =>
      block.type === 'tool-call' && block.name.startsWith('vasp_') && !TERMINAL.has(block.name)));
}

function assembleCandidate(chunks) {
  const partials = new Map();
  let finish;
  for (const chunk of chunks) {
    if (chunk.type === 'finish') { finish = chunk.reason; continue; }
    if (!Number.isInteger(chunk.index)) continue;
    const partial = partials.get(chunk.index) ?? { type: '', text: '', name: '', arguments: '' };
    if (chunk.type === 'block-start') partial.type = chunk.blockType;
    if (chunk.type === 'text-delta') { partial.type = 'text'; partial.text += chunk.text; }
    if (chunk.type === 'reasoning-delta') partial.type = 'reasoning';
    if (chunk.type === 'tool-call-delta') {
      partial.type = 'tool-call';
      partial.name = chunk.name ?? partial.name;
      partial.arguments += chunk.argumentsDelta;
    }
    if (chunk.type === 'block-end') partial.block = chunk.block;
    partials.set(chunk.index, partial);
  }
  return { finish, blocks: [...partials.values()].map((partial) => partial.block ?? partial) };
}

export function validateCandidate(options, chunks) {
  const { finish, blocks } = assembleCandidate(chunks);
  if (finish?.kind !== 'stop' && finish?.kind !== 'tool-calls') throw new Error(`VASP 工具输出协议：模型响应未完整结束（${finish?.kind ?? 'missing-finish'}），未发布任何内容。`);
  const calls = blocks.filter((block) => block.type === 'tool-call');
  const allowed = new Set(options.tools.map((tool) => tool.name));
  if (calls.length === 0 || blocks.some((block) => block.type !== 'tool-call' && block.type !== 'reasoning' && (block.type !== 'text' || block.text.trim()))
    || calls.some((call) => !allowed.has(call.name) || !call.arguments || !isJsonObject(call.arguments))) {
    throw new Error('VASP 工具输出协议：模型必须只调用当前可用工具，不能直接输出正文；本次候选未发布或执行。');
  }
  if (calls.some((call) => call.name === 'vasp_say' && JSON.parse(call.arguments).kind === 'question')) {
    throw new Error('VASP 工具输出协议：需要用户回答的问题必须使用 ask_user_question。');
  }
  if (calls.length > 1 && calls.some((call) => TERMINAL.has(call.name) || call.name === 'vasp_build_inputs' || call.name === 'ask_user_question')) {
    throw new Error('VASP 工具输出协议：发言、结束和构建工具必须独占一步；本次候选未执行。');
  }
  if (calls[0].name === 'vasp_done' && !hasDomainResultThisTurn(options.messages)) {
    throw new Error('VASP 工具输出协议：本轮尚无 VASP 工具结果，不能静默结束。');
  }
}

function isJsonObject(raw) {
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch { return false; }
}

export async function* gateStream(options, stream, retry) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  try {
    validateCandidate(options, chunks);
  } catch (error) {
    const finish = chunks.findLast((chunk) => chunk.type === 'finish')?.reason;
    if (!retry || options.signal?.aborted || (finish?.kind !== 'stop' && finish?.kind !== 'tool-calls')) throw error;
    const retryOptions = { ...options, system: `${options.system ?? ''}\n\n${RECOVERY_INSTRUCTION}`, [RECOVERY]: true };
    const retried = [];
    for await (const chunk of retry(retryOptions)) retried.push(chunk);
    validateCandidate(retryOptions, retried);
    yield* retried;
    return;
  }
  yield* chunks;
}

export function apply(ctx) {
  ctx.on('llm/stream', (options, next) => {
    if (!options.sessionId || !options.tools?.some((tool) => tool.name === 'vasp_say')
      || !options.tools.some((tool) => tool.name === 'vasp_done')) return next();
    const llm = ctx.get?.('llm') ?? ctx.llm;
    const retry = options[RECOVERY] || !llm ? undefined : (retryOptions) => llm.stream(retryOptions);
    return gateStream(options, next(), retry);
  }, { global: true });
}
