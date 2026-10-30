/**
 * dsh-vaspflow client: source drill-down for the build inheritance ledger.
 *
 * The build flow is check → confirm → write, so the card has to be useful
 * *before* anything exists on disk. It therefore compares what will be written
 * against whatever is available to compare with:
 *
 *   override row        → 模板版本 (the file this task deviates from)
 *   inherit row         → 目录现有 (only when the task directory already has one)
 *   nothing to compare  → one full-width pane, marked 将新建
 *
 * File contents come from the existing task routes: open-by-path registers any
 * existing directory, then file-content reads one file inside it. Results are
 * cached per absolute path so reopening the same source costs nothing.
 */
import React from 'react';
import { Tree } from 'antd';
import { FileTextOutlined, FolderOutlined } from '@ant-design/icons';
import { fetchFileContent, openTaskByPath } from './api';
import { projectRelative, toPosix } from './inheritance';

type FileState = { text: string; lines: string[]; error?: string; truncated?: boolean };

const fileCache = new Map<string, FileState>();
const pending = new Map<string, Promise<FileState>>();

/** Read one file inside the project through the task routes (cached). */
async function readProjectFile(projectRoot: string, absolutePath: string): Promise<FileState> {
  const key = absolutePath.toLowerCase();
  const cached = fileCache.get(key);
  if (cached) return cached;
  const running = pending.get(key);
  if (running) return running;
  const job = (async (): Promise<FileState> => {
    try {
      const rel = projectRelative(projectRoot, absolutePath);
      const parts = toPosix(rel).split('/').filter(Boolean);
      const name = parts.at(-1) ?? '';
      if (!name) throw new Error('无法解析文件名');
      const dir = parts.slice(0, -1).join('/') || '.';
      const task = await openTaskByPath(projectRoot, dir);
      const response = await fetchFileContent(task.id, name, { offset: 0 });
      const text = response.content ?? '';
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      // A trailing newline is not a line of its own in a side-by-side view.
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const value: FileState = { text, lines, truncated: !!response.hasAfter };
      fileCache.set(key, value);
      return value;
    } catch (error) {
      const value: FileState = { text: '', lines: [], error: error instanceof Error ? error.message : String(error) };
      fileCache.set(key, value);
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

/** Which lines of each side have no counterpart on the other side. */
function markDifferences(left: string[], right: string[]): { left: boolean[]; right: boolean[] } {
  const n = left.length;
  const m = right.length;
  const fallback = () => {
    const setRight = new Set(right);
    const setLeft = new Set(left);
    return { left: left.map((line) => !setRight.has(line)), right: right.map((line) => !setLeft.has(line)) };
  };
  if (!n || !m || n * m > 400_000) return fallback();
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = left[i] === right[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const leftFlags = new Array<boolean>(n).fill(true);
  const rightFlags = new Array<boolean>(m).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      leftFlags[i] = false;
      rightFlags[j] = false;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { left: leftFlags, right: rightFlags };
}

const PREVIEW_LINES = 140;

/** Compact path for the header: at most two parent directories plus the file. */
function shortPath(projectRoot: string, absolutePath: string): string {
  const parts = toPosix(projectRelative(projectRoot, absolutePath)).split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  const dirs = parts.slice(0, -1);
  if (!dirs.length) return name;
  const prefix = dirs.length <= 2 ? dirs.join('/') : `…/${dirs.slice(-2).join('/')}`;
  return `${prefix}/${name}`;
}

function FilePane({ step, path, dirLabel, state, changed }: {
  step: string;
  path: string;
  dirLabel: string;
  state?: FileState;
  changed?: boolean[];
}) {
  const shown = state ? state.lines.slice(0, PREVIEW_LINES) : [];
  return (
    <section className="vfp-cmp-side" data-side={step === '将写入' ? 'write' : 'reference'} data-loading={!state ? '' : undefined}>
      <header>
        <span className="vfp-cmp-step">{step}</span>
        <code className="vfp-cmp-dir" title={path}>{dirLabel}</code>
      </header>
      {!state ? <div className="vfp-cmp-empty">读取中…</div>
        : state.error ? <div className="vfp-cmp-empty" data-error="" title={state.error}>{state.error}</div>
          : shown.length === 0 || (shown.length === 1 && shown[0] === '') ? <div className="vfp-cmp-empty">空文件</div>
            : <pre>
              {shown.map((line, index) => (
                <span key={index} className="vfp-cmp-line" data-changed={changed?.[index] ? '' : undefined}>
                  <i>{index + 1}</i>{line || ' '}
                </span>
              ))}
            </pre>}
      {state && !state.error && (state.lines.length > PREVIEW_LINES || state.truncated) && (
        <div className="vfp-cmp-more">已截断预览：共 {state.lines.length} 行{state.truncated ? '（文件更大）' : ''}</div>
      )}
    </section>
  );
}

type PathNode = { title: React.ReactNode; key: string; icon?: React.ReactNode; children?: PathNode[] };

/** Where the written file comes from: project → directories → file. */
function buildAddressTree(projectName: string, projectRoot: string, absolutePath: string): PathNode[] {
  const parts = toPosix(projectRelative(projectRoot, absolutePath)).split('/').filter(Boolean);
  const file = parts.at(-1) ?? '';
  const dirs = parts.slice(0, -1);
  const shown = dirs.length > 4
    ? [dirs[0], dirs[1], '…', dirs[dirs.length - 2], dirs[dirs.length - 1]]
    : dirs;
  const root: PathNode = { title: projectName, key: 'root', icon: <FolderOutlined />, children: [] };
  let node = root;
  shown.forEach((segment) => {
    const key = `${node.key}/${segment}`;
    const child: PathNode = {
      title: segment === '…' ? <span className="vfp-cmp-ellipsis">…</span> : segment,
      key,
      icon: segment === '…' ? undefined : <FolderOutlined />,
      children: [],
    };
    node.children = [...(node.children ?? []), child];
    node = child;
  });
  node.children = [...(node.children ?? []), { title: <span className="vfp-cmp-file">{file}</span>, key: `${node.key}/${file}`, icon: <FileTextOutlined /> }];
  return [root];
}

export type SourceCompareProps = {
  projectRoot: string;
  projectName: string;
  slotLabel: string;
  /** The file the build will write into the task directory. */
  adopted: { path: string };
  /** Template copy, when this task overrides it. */
  templatePath?: string;
  /** What already sits in the task directory, if anything. */
  diskPath: string;
};

export function SourceCompare({ projectRoot, projectName, slotLabel, adopted, templatePath, diskPath }: SourceCompareProps) {
  const [adoptedState, setAdoptedState] = React.useState<FileState>();
  const [reference, setReference] = React.useState<{ label: string; path: string; state?: FileState } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void readProjectFile(projectRoot, adopted.path).then((value) => { if (!cancelled) setAdoptedState(value); });

    // Pick the most useful thing to compare against, before anything is written:
    // the template this task deviates from, otherwise whatever is on disk.
    const choose = async () => {
      if (templatePath) {
        const template = await readProjectFile(projectRoot, templatePath);
        if (!cancelled && !template.error) { setReference({ label: '模板版本', path: templatePath, state: template }); return; }
      }
      const disk = await readProjectFile(projectRoot, diskPath);
      if (cancelled) return;
      setReference(disk.error ? { label: '', path: '', state: disk } : { label: '目录现有', path: diskPath, state: disk });
    };
    void choose();
    return () => { cancelled = true; };
  }, [projectRoot, adopted.path, templatePath, diskPath]);

  const referenceState = reference?.state;
  const usable = Boolean(reference && reference.path && referenceState && !referenceState.error);
  const marks = React.useMemo(
    () => (adoptedState && usable && referenceState && !adoptedState.error
      ? markDifferences(referenceState.lines.slice(0, PREVIEW_LINES), adoptedState.lines.slice(0, PREVIEW_LINES))
      : undefined),
    [adoptedState, referenceState, usable],
  );
  const same = marks ? marks.left.every((flag) => !flag) && marks.right.every((flag) => !flag) : false;
  const delta = marks ? { added: marks.right.filter(Boolean).length, removed: marks.left.filter(Boolean).length } : undefined;
  const addressTree = React.useMemo(
    () => buildAddressTree(projectName, projectRoot, adopted.path),
    [projectName, projectRoot, adopted.path],
  );

  return (
    <div className="vfp-cmp vaspflow-task-popover">
      <div className="vfp-cmp-head">
        <strong>{slotLabel}</strong>
        {adoptedState && reference && (usable
          ? (same
            ? <span className="vfp-cmp-same">与{reference.label}相同</span>
            : <span className="vfp-cmp-diff">与{reference.label}不同{delta && <em className="vfp-cmp-delta"><b>+{delta.added}</b><b>−{delta.removed}</b></em>}</span>)
          : <span className="vfp-cmp-note">无可对比文件，将新建</span>)}
      </div>
      <div className="vfp-cmp-grid" data-single={usable ? undefined : ''}>
        {usable && reference && (
          <FilePane step={reference.label} path={reference.path} dirLabel={shortPath(projectRoot, reference.path)}
            state={referenceState} changed={marks?.left} />
        )}
        <FilePane step="将写入" path={adopted.path} dirLabel={shortPath(projectRoot, adopted.path)}
          state={adoptedState} changed={marks?.right} />
      </div>
      <div className="vfp-cmp-address">
        <div className="vfp-cmp-address-head">来源地址</div>
        <Tree
          treeData={addressTree as any}
          defaultExpandAll
          selectable={false}
          showIcon
          style={{ fontSize: 12, background: 'transparent' }}
        />
      </div>
    </div>
  );
}
