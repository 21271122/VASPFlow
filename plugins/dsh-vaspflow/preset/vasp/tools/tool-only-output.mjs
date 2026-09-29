export const name = 'vasp-tool-only-output';

const TERMINAL = new Set(['vasp_say', 'vasp_done']);

function hasDomainResultThisTurn(messages) {
  const lastUser = messages.findLastIndex((message) => message.role === 'user');
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
  if (calls.length > 1 && calls.some((call) => TERMINAL.has(call.name) || call.name === 'vasp_build_inputs')) {
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

export async function* gateStream(options, stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  validateCandidate(options, chunks);
  yield* chunks;
}

export function apply(ctx) {
  ctx.on('llm/stream', (options, next) => {
    if (!options.sessionId || !options.tools?.some((tool) => tool.name === 'vasp_say')
      || !options.tools.some((tool) => tool.name === 'vasp_done')) return next();
    return gateStream(options, next());
  }, { global: true });
}
