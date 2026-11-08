import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Render our real components and hooks. Replace only Ant Design's DOM/portal
// transport so mouse-enter behavior can run under Node without a browser.
const antd = `
const React = require('react');
const Wrap = (props) => React.createElement('div', null, props.children);
exports.Tag = Wrap;
exports.Typography = { Text: Wrap };
exports.Popover = (props) => React.createElement('div', null, props.children, props.open ? props.content : null);
exports.Tree = ({ treeData }) => React.createElement('ul', null, treeData.map(node => React.createElement('li', {key: node.key}, node.title)));
for (const name of ['Input', 'Button', 'Select', 'Tooltip', 'Segmented', 'Tabs', 'Empty', 'Dropdown']) exports[name] = Wrap;
`;
const bundle = await build({
  stdin: {
    contents: "export { SourceCompare } from './source-compare'; export { BuildPreviewDetail } from './Panel'; export { BatchCompare } from './batch-compare';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'tsx',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  plugins: [{ name: 'preview-dom-transport', setup(builder) {
    builder.onResolve({ filter: /^antd$/ }, () => ({ path: 'antd', namespace: 'test-antd' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-antd' }, () => ({ contents: antd, loader: 'js' }));
    builder.onLoad({ filter: /[\\/]Panel\.tsx$/ }, ({ path }) => ({ contents: `${readFileSync(path, 'utf8')}\nexport { BuildPreviewDetail };`, loader: 'tsx' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SourceCompare, BuildPreviewDetail, BatchCompare } = module.exports;

const projectRoot = 'D:/project';
const sources = Object.fromEntries(['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR', 'submit.sh', 'vasprun.xml'].map(name => [name, `${projectRoot}/template/${name}`]));
const files = Object.fromEntries(Object.keys(sources).map(name => [name, { source: `${name} original\n`, written: `${name} written\n` }]));
const props = { projectRoot, projectName: 'project', slotLabel: 'vasprun.xml', fileName: 'vasprun.xml', source: { path: sources['vasprun.xml'] }, files };
const alerts = renderer => renderer.root.findAll(node => node.props.role === 'alert');

test('normal and extra files mount every comparison variant without blanking the preview', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('snapshot must avoid disk requests'); });
  for (const fileName of Object.keys(files)) {
    for (const variant of ['both', 'source', 'written']) {
      let renderer;
      await act(async () => {
        renderer = create(React.createElement(SourceCompare, { ...props, fileName, source: { path: sources[fileName] }, variant }));
      });
      assert.equal(alerts(renderer).length, 0, `${fileName}/${variant} must not reach the error boundary`);
      assert.equal(renderer.root.findAllByType('pre').length, variant === 'both' ? 2 : 1);
      assert.ok(renderer.root.findAll(node => node.type === 'code' && node.children.join('') === `template/${fileName}`).length > 0);
      await act(async () => renderer.unmount());
    }
  }
});

test('hovering task sources with an extra template file keeps the right panel mounted', async t => {
  const oldWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, innerHeight: 900 };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const task = { dir: 'out', template: 'template', poscarSrc: 'template/POSCAR', submitSrc: 'template/submit.sh', extraFiles: [{ fromTemplate: 'vasprun.xml' }] };
  const result = { sources, files, warnings: [], errors: [] };
  let renderer;
  await act(async () => { renderer = create(React.createElement(BuildPreviewDetail, { detail: {
    projectRoot, task, result, phase: 'preview', linkPotcar: false, batch: { tasks: [task], results: [result] },
  } })); });
  for (const slot of ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR', 'submit', 'extra:vasprun.xml']) {
    const row = renderer.root.findAll(node => node.type === 'li' && node.props['data-vfp-source-row'] === slot && node.props.onMouseEnter)[0];
    await act(async () => row.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 900, top: 0, height: 20 }), closest: () => null } }));
    assert.equal(alerts(renderer).length, 0, `${slot} hover must render successfully`);
    assert.equal(renderer.root.findAllByType('pre').length, 2);
    assert.ok(renderer.root.findAll(node => node.props.className === 'vfp-build-detail').length === 1);
  }
  assert.ok(renderer.root.findAll(node => node.props['data-vfp-source-row'] === 'extra:vasprun.xml').length > 0);
  await act(async () => renderer.unmount());
});

test('a failed preview is isolated from siblings and recovers when another file opens', async t => {
  t.mock.method(console, 'error', () => {});
  const render = source => React.createElement('section', null,
    React.createElement(SourceCompare, { ...props, source }),
    React.createElement(SourceCompare, { ...props, fileName: 'INCAR', source: { path: sources.INCAR } }));
  let renderer;
  await act(async () => { renderer = create(render({ path: 42 })); });
  assert.equal(alerts(renderer).length, 1);
  assert.equal(renderer.root.findAllByType('pre').length, 2, 'the valid sibling remains visible');
  await act(async () => renderer.update(render(props.source)));
  assert.equal(alerts(renderer).length, 0);
  assert.equal(renderer.root.findAllByType('pre').length, 4);
  await act(async () => renderer.unmount());
});

test('extra files open in whole-batch comparisons using the existing file group layout', async () => {
  const tasks = ['one', 'two'].map(dir => ({ dir, submitSrc: 'template/submit.sh', extraFiles: [{ fromTemplate: 'vasprun.xml' }] }));
  let renderer;
  await act(async () => { renderer = create(React.createElement(BatchCompare, {
    projectRoot, projectName: 'project', batch: { tasks, results: tasks.map(() => ({ sources, files })) },
  })); });
  const toggles = () => renderer.root.findAll(node => node.type === 'button' && node.props.className === 'vfp-batch-group-toggle');
  assert.equal(toggles().length, 6);
  const extra = toggles().find(node => node.findByType('strong').children.includes('vasprun.xml'));
  await act(async () => extra.props.onClick());
  assert.equal(alerts(renderer).length, 0);
  assert.equal(renderer.root.findAllByType('pre').length, 3, 'one template and two tasks are previewed');
  await act(async () => toggles()[0].props.onClick());
  assert.equal(alerts(renderer).length, 0, 'switching groups preserves a working comparison');
  await act(async () => renderer.unmount());
});
