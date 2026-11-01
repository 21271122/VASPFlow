/**
 * dsh-vaspflow client: source drill-down for the build inheritance ledger.
 *
 * Every row resolves to one source file. What lands in the task directory is
 * that file — plus, for INCAR, the task's parameter overrides applied exactly
 * the way the host applies them before writing. The card therefore always shows
 * 参考来源 (the file on disk) next to 将写入 (that file after overrides): the
 * difference a person checks before confirming the build.
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

const INCAR_TAG_RE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*(?:[#!].*)?$/;

/**
 * Mirror of the host's applyIncarOverrides: replace tags in place (semicolon
 * aware) and append tags the file does not declare yet. Kept in step with
 * lib/host/input-builder.js so the preview matches what gets written.
 */
export function applyIncarOverrides(incarText: string, overrides?: Record<string, unknown>): string {
  const entries = Object.entries(overrides ?? {});
  if (!entries.length) return incarText;
  const escape = (value: string) => value.replace(/[.*+?^()|[\]\\]/g, '\\$&');
  const lines = incarText.split(/\r?\n/).map((line) => {
    const segments = line.split(';');
    let touched = false;
    for (let i = 0; i < segments.length; i += 1) {
      for (const [key, value] of entries) {
        const pattern = new RegExp('^\\s*' + escape(key) + '\\s*=\\s*[^\\r\\n]*');
        if (pattern.test(segments[i])) {
          segments[i] = segments[i].replace(pattern, () => `${key} = ${String(value)}`);
          touched = true;
        }
      }
    }
    return touched ? segments.join(';') : line;
  });
  let out = lines.join('\n');
  const declared = new Set<string>();
  for (const raw of out.split(/\r?\n/)) {
    for (const segment of raw.split(';')) {
      const match = INCAR_TAG_RE.exec(segment);
      if (match) declared.add(match[1]);
    }
  }
  for (const [key, value] of entries) {
    if (!declared.has(key)) out += `\n${key} = ${String(value)}\n`;
  }
  return out;
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

/** Same normalisation the loader uses: CRLF→LF and drop one trailing blank. */
function toLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
/** Thickness, in pixels, of the pinned band along each edge of a preview. */
const EDGE_BAND = 20;

/**
 * Map a pointer offset inside [0, size) onto [0, 1] with a pinned band at both
 * ends: anything within `band` of an edge reports the edge, and the rest is a
 * smooth linear ramp over the remaining span.
 */
function positionRatio(offset: number, size: number, band: number): number {
  if (size <= 0) return 0;
  if (offset <= band) return 0;
  if (offset >= size - band) return 1;
  return (offset - band) / Math.max(1, size - band * 2);
}
function FilePane({ step, path, dirLabel, lines, changed, error }: {
  step: string;
  path: string;
  dirLabel: string;
  lines?: string[];
  changed?: boolean[];
  error?: string;
}) {
  const bodyRef = React.useRef<HTMLPreElement>(null);

  // Moving the pointer inside a pane drives both scroll axes linearly: top-left
  // maps to the start of the file, bottom-right to the end. Cheaper to aim than
  // a wheel when hopping between many short previews, and it stops by itself as
  // soon as the pointer leaves the pane, because no more moves arrive.
  const mapPointer = (event: React.PointerEvent<HTMLElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // A thick border band stays pinned to the first/last line, so reaching an
    // end never means balancing on the edge of the pane — the pointer can sit
    // comfortably inside without jumping to the neighbouring preview.
    const bandX = Math.min(EDGE_BAND, rect.width * 0.25);
    const bandY = Math.min(EDGE_BAND, rect.height * 0.25);
    const ratioX = positionRatio(event.clientX - rect.left, rect.width, bandX);
    const ratioY = positionRatio(event.clientY - rect.top, rect.height, bandY);
    body.scrollTop = ratioY * (body.scrollHeight - body.clientHeight);
    body.scrollLeft = ratioX * (body.scrollWidth - body.clientWidth);
  };

  return (
    <section
      className="vfp-cmp-side"
      data-side={step === '将写入' ? 'write' : 'read'}
      data-loading={!lines && !error ? '' : undefined}
      onPointerMove={mapPointer}
      onPointerLeave={() => { const body = bodyRef.current; if (body) body.scrollLeft = 0; }}
      title="鼠标在框内移动即可定位内容"
    >
      <header>
        <span className="vfp-cmp-step">{step}</span>
        <code className="vfp-cmp-dir" title={path}>{dirLabel}</code>
      </header>
      {error ? <div className="vfp-cmp-empty" data-error="" title={error}>{error}</div>
        : !lines ? <div className="vfp-cmp-empty">读取中…</div>
          : lines.length === 0 || (lines.length === 1 && lines[0] === '') ? <div className="vfp-cmp-empty">空文件</div>
            : <pre ref={bodyRef}>
              {lines.slice(0, PREVIEW_LINES).map((line, index) => (
                <span key={index} className="vfp-cmp-line" data-changed={changed?.[index] ? '' : undefined}>
                  <i>{index + 1}</i>{line || ' '}
                </span>
              ))}
            </pre>}
    </section>
  );
}

type PathNode = { title: React.ReactNode; key: string; icon?: React.ReactNode; children?: PathNode[] };

/** Where the source file lives: project → directories → file. */
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
  /** The file the build copies from. */
  source: { path: string };
  /** Destination name inside the task directory (POSCAR, INCAR, submit.sh, …). */
  fileName: string;
  /** Bytes the host computed for this file when it built the plan. */
  files?: Record<string, { source?: string; written?: string }>;
  /** Build plan identity: lets the host recompute the exact bytes if the row has none. */
  planId?: string;
  taskIndex?: number;
  /** Fallback transform when the plan is gone (old sessions, offline preview). */
  incarOverrides?: Record<string, unknown>;
  /** The host rewrites this file on write (POSCAR flags), so a read-only fallback is not the result. */
  rewritten?: boolean;
  /** Extra transformation noted next to the title. */
  note?: string;
  /** Written texts from sibling tasks; the source pane flags every line any of them changes. */
  compareWith?: string[];
  /** Native tooltip for the whole card (usually the absolute path). */
  hint?: string;
  /** Header text for the write pane; defaults to the source path. */
  writtenLabel?: string;
  /** Embedded in a node: smaller panes, no address tree. */
  compact?: boolean;
  /** both = 参考来源 + 将写入; source = only the source; written = only the result. */
  variant?: 'both' | 'source' | 'written';
};

type Compared = { source: string[]; written: string[]; error?: string; notice?: string };

export function SourceCompare({ projectRoot, projectName, slotLabel, source, fileName, files, planId, taskIndex, incarOverrides, rewritten, note, compact, writtenLabel, hint, compareWith, variant = 'both' }: SourceCompareProps) {
  const [compared, setCompared] = React.useState<Compared>();

  React.useEffect(() => {
    let cancelled = false;
    setCompared(undefined);
    let hostStale = false;
    const splitLines = (text: string) => {
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      return lines;
    };
    const load = async () => {
      // 1) Bytes the host computed for this exact plan — authoritative.
      const baked = files?.[fileName];
      if (baked && typeof baked.source === 'string' && typeof baked.written === 'string') {
        if (!cancelled) setCompared({ source: splitLines(baked.source), written: splitLines(baked.written) });
        return;
      }
      // Preferred: the host runs the same builder it uses for the real write,
      // so POSCAR flag rewrites and INCAR overrides are reflected exactly.
      if (variant !== 'source' && planId && taskIndex !== undefined) {
        try {
          const url = `/plugins/dsh-vaspflow/build-inputs/file?planId=${encodeURIComponent(planId)}`
            + `&taskIndex=${taskIndex}&name=${encodeURIComponent(fileName)}`;
          const response = await fetch(url);
          if (response.status === 404) hostStale = true;
          if (response.ok) {
            const payload = await response.json() as { source?: string; written?: string };
            if (typeof payload.source === 'string' && typeof payload.written === 'string') {
              if (!cancelled) setCompared({ source: splitLines(payload.source), written: splitLines(payload.written) });
              return;
            }
          }
        } catch { /* fall back to reading the file directly */ }
      }
      const state = await readProjectFile(projectRoot, source.path);
      if (cancelled) return;
      if (state.error) { setCompared({ source: [], written: [], error: state.error }); return; }
      const written = Object.keys(incarOverrides ?? {}).length
        ? splitLines(applyIncarOverrides(state.text, incarOverrides))
        : state.lines;
      const notice = hostStale
        ? '宿主版本过旧，未提供写入内容（重启 DSH 后生效）'
        : rewritten ? '未取得宿主写入内容，此处仅为来源' : undefined;
      setCompared({ source: state.lines, written, notice });
    };
    void load();
    return () => { cancelled = true; };
  }, [projectRoot, source.path, fileName, files, planId, taskIndex, incarOverrides, rewritten, variant]);

  const overrideCount = Object.keys(incarOverrides ?? {}).length;
  const error = compared?.error;
  const marks = React.useMemo(
    () => (compared && !error ? markDifferences(compared.source.slice(0, PREVIEW_LINES), compared.written.slice(0, PREVIEW_LINES)) : undefined),
    [compared, error],
  );
  const same = marks ? marks.left.every((flag) => !flag) && marks.right.every((flag) => !flag) : false;
  const delta = marks ? { added: marks.right.filter(Boolean).length, removed: marks.left.filter(Boolean).length } : undefined;
  // A template tile serves several tasks: flag a line if *any* of them changes
  // it, so the reference shows which lines get rewritten at all.
  const unionMarks = React.useMemo(() => {
    if (variant !== 'source' || !compareWith?.length || !compared?.source?.length) return undefined;
    const flags = new Array(compared.source.length).fill(false);
    for (const text of compareWith) {
      const written = toLines(text).slice(0, PREVIEW_LINES);
      const result = markDifferences(compared.source.slice(0, PREVIEW_LINES), written);
      result.left.forEach((flag, index) => { if (flag) flags[index] = true; });
    }
    return flags;
  }, [variant, compareWith, compared]);
  const addressTree = React.useMemo(
    () => buildAddressTree(projectName, projectRoot, source.path),
    [projectName, projectRoot, source.path],
  );

  return (
    <div className="vfp-cmp vaspflow-task-popover" data-compact={compact ? '' : undefined} data-variant={variant} title={hint}>
      <div className="vfp-cmp-head">
        <strong className="vfp-cmp-title">{slotLabel || '模板'}</strong>
        {!compact && (note || compared?.notice || overrideCount > 0) && (
          <div className="vfp-cmp-notes">
            {note ? <span className="vfp-cmp-note">{note}</span> : null}
            {compared?.notice && variant !== 'source' ? <span className="vfp-cmp-note">{compared.notice}</span> : null}
            {overrideCount > 0 && variant !== 'source'
              ? <span className="vfp-cmp-chip">覆盖 {overrideCount} 项</span>
              : null}
          </div>
        )}
        {variant !== 'source' && (error
          ? <span className="vfp-cmp-same" data-tone="muted">来源不可读</span>
          : marks && (same
            ? <span className="vfp-cmp-same">{compact ? '相同' : '与来源相同'}</span>
            : <span className="vfp-cmp-diff">{compact ? '不同' : '与来源不同'}{delta && <em className="vfp-cmp-delta"><b>+{delta.added}</b><b>−{delta.removed}</b></em>}</span>))}
      </div>
      <div className="vfp-cmp-grid" data-single={variant === 'both' ? undefined : ''}>
        {variant !== 'written' && (
          <FilePane step={variant === 'source' ? '模板内容' : '参考来源'} path={source.path} dirLabel={shortPath(projectRoot, source.path)}
            lines={compared?.source} error={error} changed={variant === 'source' ? unionMarks : variant === 'both' ? marks?.left : undefined} />
        )}
        {variant !== 'source' && (
          <FilePane step={variant === 'written' ? '本任务写入' : '将写入'} path={source.path}
            dirLabel={writtenLabel ?? shortPath(projectRoot, source.path)}
            lines={compared?.written} changed={marks?.right} />
        )}
      </div>
      <div className="vfp-cmp-address" hidden={compact}>
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
