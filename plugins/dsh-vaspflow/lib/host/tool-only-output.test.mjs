import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, gateStream, validateCandidate } from '../../preset/vasp/tools/tool-only-output.mjs';

const tools = ['vasp_scan', 'vasp_build_inputs', 'vasp_say', 'vasp_done', 'ask_user_question'].map((name) => ({ name }));
const options = { sessionId: 'vasp-session', tools, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '扫描' }] }] };
const finish = { type: 'finish', reason: { kind: 'tool-calls' } };
const call = (name, index = 0) => ({ type: 'block-end', index, block: { type: 'tool-call', id: `call-${index}`, name, arguments: '{}' } });

async function* stream(chunks) { yield* chunks; }

test('candidate gate rejects visible text and mixed terminal batches before yielding any chunk', async () => {
  const cases = [
    [{ type: 'text-delta', index: 0, text: '正在扫描' }, call('vasp_scan', 1), finish],
    [{ type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } }, finish],
    [call('vasp_scan'), call('vasp_say', 1), finish],
    [call('vasp_build_inputs'), call('vasp_scan', 1), finish],
    [call('other_tool'), finish],
    [call('vasp_scan'), { type: 'finish', reason: { kind: 'max-tokens' } }],
  ];
  for (const chunks of cases) {
    const seen = [];
    await assert.rejects(async () => { for await (const chunk of gateStream(options, stream(chunks))) seen.push(chunk); });
    assert.deepEqual(seen, [], 'rejected content cannot reach Agent Loop or session log');
  }
});

test('done requires a VASP result since the last user message', () => {
  assert.throws(() => validateCandidate(options, [call('vasp_done'), finish]));
  const afterScan = { ...options, messages: [
    ...options.messages,
    { role: 'user', source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'AGENTS.md' }] },
    { role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'system prompt' }] },
    { role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'skills' }] },
    { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'tool-call', name: 'vasp_scan', id: 'scan-1' }] },
    { role: 'user', source: { kind: 'tool', callId: 'scan-1' }, content: [{ type: 'tool-result', toolCallId: 'scan-1' }] },
  ] };
  assert.doesNotThrow(() => validateCandidate(afterScan, [call('vasp_done'), finish]));
  const nextUser = { ...options, messages: [...afterScan.messages, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '再检查' }] }] };
  assert.throws(() => validateCandidate(nextUser, [call('vasp_done'), finish]));
});

test('questions use the built-in ask_user_question tool alone', () => {
  const sayQuestion = { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-0', name: 'vasp_say', arguments: '{"kind":"question","text":"确认吗？"}' } };
  assert.throws(() => validateCandidate(options, [sayQuestion, finish]), /ask_user_question/);
  assert.throws(() => validateCandidate(options, [call('ask_user_question'), call('vasp_scan', 1), finish]));
  assert.doesNotThrow(() => validateCandidate(options, [call('ask_user_question'), finish]));
});

test('valid tool calls pass unchanged; unrelated sessions bypass the VASP gate', async () => {
  const chunks = [call('vasp_scan'), finish];
  const seen = [];
  for await (const chunk of gateStream(options, stream(chunks))) seen.push(chunk);
  assert.deepEqual(seen, chunks);
  let listener;
  apply({ on(_event, handler, config) { listener = handler; assert.equal(config.global, true); } });
  const unrelated = { ...options, tools: [{ name: 'shell' }] };
  const plainText = [{ type: 'block-end', index: 0, block: { type: 'text', text: '普通预设允许正文' } }, { type: 'finish', reason: { kind: 'stop' } }];
  const bypass = listener(unrelated, () => stream(plainText));
  const bypassed = [];
  for await (const chunk of bypass) bypassed.push(chunk);
  assert.deepEqual(bypassed, plainText);
});

test('a rejected text candidate gets one tool-only retry without publishing the text', async () => {
  const invalid = [{ type: 'block-end', index: 0, block: { type: 'text', text: '我先构建' } }, { type: 'finish', reason: { kind: 'stop' } }];
  const repaired = [call('vasp_say'), finish];
  let attempts = 0;
  const seen = [];
  for await (const chunk of gateStream({ ...options, system: 'original' }, stream(invalid), (retryOptions) => {
    attempts++;
    assert.match(retryOptions.system, /^original\n\n.*ask_user_question/);
    assert.deepEqual(retryOptions.messages, options.messages);
    return stream(repaired);
  })) seen.push(chunk);
  assert.equal(attempts, 1);
  assert.deepEqual(seen, repaired);
});

test('an invalid retry still fails closed, and an incomplete response is not retried', async () => {
  const invalid = [{ type: 'block-end', index: 0, block: { type: 'text', text: '正文' } }, { type: 'finish', reason: { kind: 'stop' } }];
  let attempts = 0;
  const retry = () => { attempts++; return stream(invalid); };
  const seen = [];
  await assert.rejects(async () => { for await (const chunk of gateStream(options, stream(invalid), retry)) seen.push(chunk); });
  assert.equal(attempts, 1);
  assert.deepEqual(seen, []);
  await assert.rejects(async () => { for await (const chunk of gateStream(options, stream([call('vasp_scan'), { type: 'finish', reason: { kind: 'max-tokens' } }]), retry)) seen.push(chunk); });
  assert.equal(attempts, 1);
  assert.deepEqual(seen, []);
});

test('preset middleware retries through the LLM service once', async () => {
  const invalid = [{ type: 'block-end', index: 0, block: { type: 'text', text: '直接输出' } }, { type: 'finish', reason: { kind: 'stop' } }];
  let listener;
  let requests = 0;
  const llm = { stream(retryOptions) {
    requests++;
    return listener(retryOptions, () => stream([call('vasp_scan'), finish]));
  } };
  apply({ on(_event, handler) { listener = handler; }, get() { return llm; } });
  const seen = [];
  for await (const chunk of listener(options, () => stream(invalid))) seen.push(chunk);
  assert.equal(requests, 1);
  assert.deepEqual(seen, [call('vasp_scan'), finish]);
});

test('provider errors and cancellations preserve the failure and discard partial content', async () => {
  for (const kind of ['error', 'aborted']) {
    const failed = { type: 'finish', reason: { kind, failure: {
      code: kind === 'error' ? 'INVALID_CREDENTIAL' : 'ABORTED',
      message: kind === 'error' ? 'Authentication failed' : 'Request cancelled',
      details: { status: 401 },
    } } };
    const seen = [];
    let retries = 0;
    for await (const chunk of gateStream(options, stream([
      { type: 'text-delta', index: 0, text: 'partial response' }, call('vasp_scan', 1), failed,
    ]), () => { retries++; return stream([]); })) seen.push(chunk);
    assert.deepEqual(seen, [failed]);
    assert.equal(seen[0], failed);
    assert.equal(retries, 0);
  }
});

test('a provider failure during protocol recovery is also passed to DSH unchanged', async () => {
  const invalid = [{ type: 'text-delta', index: 0, text: '正文' }, { type: 'finish', reason: { kind: 'stop' } }];
  const failed = { type: 'finish', reason: { kind: 'error', failure: { code: 'NETWORK_ERROR', message: 'Connection failed' } } };
  const seen = [];
  for await (const chunk of gateStream(options, stream(invalid), () => stream([call('vasp_scan'), failed]))) seen.push(chunk);
  assert.deepEqual(seen, [failed]);
});
