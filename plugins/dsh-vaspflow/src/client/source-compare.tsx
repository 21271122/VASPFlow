/**
 * dsh-vaspflow client: source drill-down for the build inheritance ledger.
 *
 * Hovering a "本任务来源" row opens a card that shows two things:
 *   1. what the build replaces (the template copy, or whatever already sits in
 *      the task directory) next to the file that will actually be used;
 *   2. where that source file physically lives, as a directory tree.
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

type FileState = { text: string; lines: string[]; error?: string; truncated?: boolean; relPath?: string };

/** Project-relative display path; the absolute path stays in the tooltip. */
function relativeDisplay(projectRoot: string, absolutePath: string): string {
  return toPosix(projectRelative(projectRoot, absolutePath));
}
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
      const value: FileState = {
        text,
        lines: text.replace(/\r\n?/g, '\n').split('\n'),
        truncated: !!response.hasAfter,
      };
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

function FilePane({ step, role, path, displayPath, state, changed, soft }: {
  step: string;
  role: string;
  path: string;
  displayPath: string;
  state?: FileState;
  changed?: boolean[];
  /** A missing file is normal for the "current file on disk" side, not an error. */
  soft?: boolean;
}) {
  const shown = state ? state.lines.slice(0, PREVIEW_LINES) : [];
  return (
    <section className="vfp-cmp-side" data-loading={!state ? '' : undefined}>
      <header>
        <div className="vfp-cmp-side-head">
          <span className="vfp-cmp-step">{step}</span>
          <span className="vfp-cmp-role">{role}</span>
        </div>
        <code title={path}>{displayPath || basenameOf(path)}</code>
      </header>
      {!state ? <div className="vfp-cmp-empty">读取中…</div>
        : state.error ? <div className="vfp-cmp-empty" data-error={soft ? undefined : ''} title={state.error}>{soft ? '目录中还没有这个文件' : state.error}</div>
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

/**
 * Where the source file actually lives: project → directories → file.
 * Long chains collapse their middle, keeping the first and last two parents.
 */
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
  node.children = [...(node.children ?? []), { title: file, key: `${node.key}/${file}`, icon: <FileTextOutlined /> }];
  return [root];
}

export type SourceCompareProps = {
  projectRoot: string;
  projectName: string;
  slotLabel: string;
  originText: string;
  /** What the adopted file replaces: a template copy or the file on disk. */
  base: { role: string; path: string };
  /** The file this task will actually use. */
  adopted: { role: string; path: string };
  /** Absolute path of the adopted file, used for the address tree. */
  sourcePath: string;
};

export function SourceCompare({ projectRoot, projectName, slotLabel, originText, base, adopted, sourcePath }: SourceCompareProps) {
  const [baseState, setBaseState] = React.useState<FileState>();
  const [adoptedState, setAdoptedState] = React.useState<FileState>();
  React.useEffect(() => {
    let cancelled = false;
    void readProjectFile(projectRoot, base.path).then((value) => { if (!cancelled) setBaseState(value); });
    void readProjectFile(projectRoot, adopted.path).then((value) => { if (!cancelled) setAdoptedState(value); });
    return () => { cancelled = true; };
  }, [projectRoot, base.path, adopted.path]);

  const marks = React.useMemo(
    () => (baseState && adoptedState && !baseState.error && !adoptedState.error
      ? markDifferences(baseState.lines.slice(0, PREVIEW_LINES), adoptedState.lines.slice(0, PREVIEW_LINES))
      : undefined),
    [baseState, adoptedState],
  );
  const same = marks ? marks.left.every((flag) => !flag) && marks.right.every((flag) => !flag) : false;
  const addressTree = React.useMemo(
    () => buildAddressTree(projectName, projectRoot, sourcePath),
    [projectName, projectRoot, sourcePath],
  );

  return (
    <div className="vfp-cmp vaspflow-task-popover">
      <div className="vfp-cmp-head">
        <strong>{slotLabel}</strong>
        <span className="vfp-cmp-origin">{originText}</span>
        {marks && (same
          ? <span className="vfp-cmp-same">内容相同</span>
          : <span className="vfp-cmp-diff">有差异</span>)}
      </div>
      <div className="vfp-cmp-grid">
        <FilePane step="替换前" role={base.role} path={base.path} displayPath={relativeDisplay(projectRoot, base.path)} state={baseState} changed={marks?.left} soft={base.role !== '模板'} />
        <FilePane step="替换后" role={adopted.role} path={adopted.path} displayPath={relativeDisplay(projectRoot, adopted.path)} state={adoptedState} changed={marks?.right} />
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
