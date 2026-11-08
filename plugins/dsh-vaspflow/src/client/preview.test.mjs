import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule(file) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const { markDifferences, collapseUnchanged, toLines } = await loadModule('./file-compare.ts');
const { readProjectFile, loadSourceComparison } = await loadModule('./source-content.ts');
const { describeSlots, buildShareIndex, groupBatchBySource, summarizeBatch } = await loadModule('./inheritance.ts');

test('preview detects and displays a changed atom beyond line 140', () => {
  const source = Array.from({ length: 300 }, (_, i) => `atom ${i} T T T`);
  const written = [...source];
  written[250] = 'atom 250 F F F';
  const marks = markDifferences(source, written);
  assert.equal(marks.right[250], true);
  assert.equal(marks.left.filter(Boolean).length, 1);
  assert.ok(collapseUnchanged(written, marks.right, false).some((row) => row.kind === 'line' && row.index === 250));
  assert.equal(collapseUnchanged(written, marks.right, true).length, 300);
});

test('large-file comparison never hides reordered rows or changed duplicate counts', () => {
  const source = Array.from({ length: 1000 }, (_, i) => `row-${i % 7}`);
  const reordered = [...source].reverse();
  assert.ok(markDifferences(source, reordered).right.some(Boolean));
  const duplicate = Array(1000).fill('same');
  const removed = markDifferences(duplicate, duplicate.slice(1));
  assert.equal(removed.left.filter(Boolean).length, 1);
  assert.equal(removed.right.filter(Boolean).length, 0);
});

test('comparison retains exact small-file additions, removals and unchanged runs', () => {
  assert.deepEqual(markDifferences(['a', 'b', 'c'], ['a', 'x', 'b', 'c']), { left: [false, false, false], right: [false, true, false, false] });
  assert.deepEqual(markDifferences(['a'], []), { left: [true], right: [] });
  const lines = Array(8).fill('unchanged');
  assert.equal(collapseUnchanged(lines, Array(8).fill(false), false).length, 8);
  assert.deepEqual(toLines('a\r\nb\r\n'), ['a', 'b']);
});

const request = { projectRoot: '/project', sourcePath: '/project/template/POSCAR', fileName: 'POSCAR' };
function sourceResponse(text, hasAfter = false) {
  return (url) => Promise.resolve(new Response(JSON.stringify(String(url).includes('open-by-path') ? { id: 1 } : { content: text, hasAfter })));
}

test('a baked plan snapshot is used for both task and template without rereading disk', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('must not fetch'); });
  const files = { POSCAR: { source: 'original\n', written: 'rewritten\n' } };
  for (const variant of ['both', 'source', 'written']) {
    const compared = await loadSourceComparison({ ...request, files, variant, rewritten: true });
    assert.deepEqual(compared, { source: ['original'], written: ['rewritten'] });
  }
});

test('missing host POSCAR bytes remain unavailable instead of being marked identical', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('build-inputs/file')
    ? new Response(JSON.stringify({ error: 'expired' }), { status: 404 })
    : sourceResponse('atom T T T\n')(url));
  const compared = await loadSourceComparison({ ...request, planId: 'expired', taskIndex: 0, rewritten: true });
  assert.deepEqual(compared.source, ['atom T T T']);
  assert.equal(compared.written, undefined);
  assert.match(compared.writeError, /未取得宿主写入内容/);
});

test('source loading deduplicates in-flight reads but refreshes reopened files', async (t) => {
  let content = 'first\n';
  let reads = 0;
  t.mock.method(globalThis, 'fetch', (url) => {
    if (String(url).includes('file-content')) reads += 1;
    return sourceResponse(content)(url);
  });
  const [a, b] = await Promise.all([readProjectFile(request.projectRoot, request.sourcePath), readProjectFile(request.projectRoot, request.sourcePath)]);
  assert.deepEqual(a.lines, ['first']);
  assert.deepEqual(b.lines, ['first']);
  assert.equal(reads, 1);
  content = 'changed\n';
  assert.deepEqual((await readProjectFile(request.projectRoot, request.sourcePath)).lines, ['changed']);
  assert.equal(reads, 2);
});

test('failed reads can be retried and partial reads cannot be declared identical', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', () => Promise.reject(Error('temporary outage')));
  assert.match((await readProjectFile(request.projectRoot, request.sourcePath)).error, /temporary outage/);
  mock.mock.mockImplementation(sourceResponse('head only', true));
  const compared = await loadSourceComparison(request);
  assert.deepEqual(compared.written, ['head only']);
  assert.equal(compared.partial, true);
  assert.match(compared.notice, /未对全文件进行比较/);
  mock.mock.mockImplementation(sourceResponse('recovered\n'));
  assert.deepEqual((await readProjectFile(request.projectRoot, request.sourcePath)).lines, ['recovered']);
});

test('INCAR fallback keeps the host override behavior when the plan is unavailable', async (t) => {
  t.mock.method(globalThis, 'fetch', sourceResponse('ENCUT = 400\nEDIFF = 1E-5; EDIFFG = -0.02\n'));
  const compared = await loadSourceComparison({ ...request, fileName: 'INCAR', incarOverrides: { ENCUT: 500, EDIFF: '1E-6' } });
  assert.deepEqual(compared.written, ['ENCUT = 500', 'EDIFF = 1E-6; EDIFFG = -0.02']);
});

test('large extra text reads are bounded and presented as partial content', async t => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', url => {
    fetched.push(String(url));
    return sourceResponse('<row/>\n'.repeat(1000), true)(url);
  });
  const compared = await loadSourceComparison({ ...request, fileName: 'vasprun.xml' });
  assert.equal(compared.partial, true);
  assert.equal(compared.source.length, 400);
  assert.equal(compared.written.length, 400);
  assert.ok(fetched.some(url => url.includes('length=65536')));
});

test('binary extra files never reach text rendering through snapshots or file reads', async t => {
  const binary = 'binary\x00\x01payload';
  const baked = await loadSourceComparison({ ...request, fileName: 'WAVECAR', files: { WAVECAR: { source: binary, written: binary } } });
  assert.match(baked.error, /二进制/);
  assert.deepEqual(baked.source, []);
  assert.equal(baked.written, undefined);
  t.mock.method(globalThis, 'fetch', sourceResponse(binary));
  assert.match((await loadSourceComparison({ ...request, fileName: 'WAVECAR' })).error, /二进制/);
});

test('extra template files participate in source rows, sharing, batch groups and summary', () => {
  const tasks = [
    { dir: 'one', template: 'template', extraFiles: [{ fromTemplate: 'vasprun.xml' }] },
    { dir: 'two', template: 'template', extraFiles: [{ fromTemplate: 'vasprun.xml' }] },
    { dir: 'three' },
  ];
  const results = [{ sources: { 'vasprun.xml': '/project/template/vasprun.xml' } }, { sources: { 'vasprun.xml': '/project/template/vasprun.xml' } }, {}];
  const batch = { tasks, results };
  const rows = describeSlots(tasks[0], results[0], '/project', buildShareIndex(batch, '/project'));
  const extra = rows.find(row => row.key === 'extra:vasprun.xml');
  assert.equal(extra.fileName, 'vasprun.xml');
  assert.equal(extra.origin, 'inherit');
  assert.equal(extra.shared, 2);
  const group = groupBatchBySource(batch, '/project').find(group => group.key === extra.key);
  assert.deepEqual(group.sources[0].tasks, [0, 1]);
  assert.deepEqual(group.missing, [], 'optional extras do not mark unrelated tasks as missing');
  assert.deepEqual(group.fileNames, { 0: 'vasprun.xml', 1: 'vasprun.xml' });
  assert.equal(summarizeBatch(batch, '/project').slots.find(slot => slot.key === extra.key).inherit, 2);
});

test('renamed extras use their destination for preview bytes and alias scripts stay standard', () => {
  const task = { dir: 'one', sources: { submit: 'scripts/lqf.sh' }, extraFiles: [{ src: 'assets/config.txt', dest: 'custom.conf' }] };
  const result = { sources: { 'lqf.sh': '/project/scripts/lqf.sh', 'custom.conf': '/project/assets/config.txt' } };
  const groups = groupBatchBySource({ tasks: [task], results: [result] }, '/project');
  assert.equal(groups.find(group => group.key === 'submit').fileNames[0], 'lqf.sh');
  assert.equal(groups.find(group => group.key === 'extra:custom.conf').fileNames[0], 'custom.conf');
  assert.equal(groups.filter(group => group.key === 'extra:lqf.sh').length, 0);
});
