/**
 * dsh-vaspflow client: source drill-down for the build inheritance ledger.
 *
 * Opens on a "本任务来源" row and answers two questions about the file that
 * build will write:
 *   1. the file in the task directory (目标) next to the file it is copied from
 *      (来源), line-numbered with the differing lines marked;
 *   2. where the written file comes from, as a directory tree (来源地址).
 *
 * File contents come from the existing task routes: open-by-path registers any
 * existing directory, then file-content reads one file inside it. Results are
 * cached per absolute path so reopening the same source costs nothing.
 */
import React from 'react';
import { Tree } from 'antd';
import { FileTextOutlined, FolderOutlined } from '@ant-design/icons';
import { fetchFileContent, openTaskByPath } from './api';
import { basenameOf, projectRelative, toPosix } from './inheritance';

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

function FilePane({ step, role, path, dirLabel, state, changed, missing }: {
  step: string;
  role: string;
  path: string;
  dirLabel: string;
  state?: FileState;
  changed?: boolean[];
  /** Text shown instead of the error when the file simply is not there yet. */
  missing?: string;
}) {
  const shown = state ? state.lines.slice(0, PREVIEW_LINES) : [];
  return (
    <section className="vfp-cmp-side" data-side={step === '参考来源' ? 'source' : 'target'} data-loading={!state ? '' : undefined}>
      <header>
        <span className="vfp-cmp-step">{step}</span>
        {role ? <span className="vfp-cmp-role">{role}</span> : null}
        <code className="vfp-cmp-dir" title={path}>{dirLabel}</code>
      </header>
      {!state ? <div className="vfp-cmp-empty">读取中…</div>
        : state.error ? <div className="vfp-cmp-empty" data-error={missing ? undefined : ''} title={state.error}>{missing ?? state.error}</div>
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
  originText: string;
  /** The file in this task's directory: what the build produces or already produced. */
  target: { path: string };
  /** The file it is copied from: a template's file, or one chosen for this task. */
  source: { role: string; path: string };
};

export function SourceCompare({ projectRoot, projectName, slotLabel, originText, target, source }: SourceCompareProps) {
  const [targetState, setTargetState] = React.useState<FileState>();
  const [sourceState, setSourceState] = React.useState<FileState>();
  React.useEffect(() => {
    let cancelled = false;
    void readProjectFile(projectRoot, target.path).then((value) => { if (!cancelled) setTargetState(value); });
    void readProjectFile(projectRoot, source.path).then((value) => { if (!cancelled) setSourceState(value); });
    return () => { cancelled = true; };
  }, [projectRoot, target.path, source.path]);

  const marks = React.useMemo(
    () => (targetState && sourceState && !targetState.error && !sourceState.error
      ? markDifferences(sourceState.lines.slice(0, PREVIEW_LINES), targetState.lines.slice(0, PREVIEW_LINES))
      : undefined),
    [targetState, sourceState],
  );
  const isNew = Boolean(targetState?.error);
  const same = marks ? marks.left.every((flag) => !flag) && marks.right.every((flag) => !flag) : false;
  const status = targetState && sourceState ? (isNew ? '尚未写入' : same ? '与来源一致' : '与来源不同') : '';
  const addressTree = React.useMemo(
    () => buildAddressTree(projectName, projectRoot, source.path),
    [projectName, projectRoot, source.path],
  );

  return (
    <div className="vfp-cmp vaspflow-task-popover">
      <div className="vfp-cmp-head">
        <strong>{slotLabel}</strong>
        <span className="vfp-cmp-origin">{originText}</span>
        {status ? <span className={same ? 'vfp-cmp-same' : 'vfp-cmp-diff'}>{status}</span> : null}
      </div>
      <div className="vfp-cmp-grid">
        <FilePane step="本任务文件" role="" path={target.path} dirLabel={shortPath(projectRoot, target.path)}
          state={targetState} changed={marks?.right} missing="尚未写入" />
        <FilePane step="参考来源" role={source.role} path={source.path} dirLabel={shortPath(projectRoot, source.path)}
          state={sourceState} changed={marks?.left} />
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
