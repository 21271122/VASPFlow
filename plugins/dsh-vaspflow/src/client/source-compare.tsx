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
 * deduplicated while in flight; reopening a source reads its current content.
 */
import React from 'react';
import { Tree } from 'antd';
import { FileTextOutlined, FolderOutlined } from '@ant-design/icons';
import { loadSourceComparison } from './source-content';
import type { Compared } from './source-content';
import { markDifferences, toLines, collapseUnchanged } from './file-compare';
export { applyIncarOverrides } from '../../lib/shared/incar.js';
import { projectRelative, toPosix } from './inheritance';
import { useCompareGroup } from './compare-group';

/** Compact header path: at most two parent folders followed by the file. */
function shortPath(projectRoot: string, absolutePath: string): string {
  const parts = toPosix(projectRelative(projectRoot, absolutePath)).split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  const dirs = parts.slice(0, -1);
  if (!dirs.length) return name;
  const prefix = dirs.length <= 2 ? dirs.join('/') : `…/${dirs.slice(-2).join('/')}`;
  return `${prefix}/${name}`;
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
function FilePane({ step, path, dirLabel, lines, changed, error, showGroupChanges }: {
  step: string;
  path: string;
  dirLabel: string;
  lines?: string[];
  changed?: boolean[];
  error?: string;
  /** Template pane: highlight every line the group changes, not only its own. */
  showGroupChanges?: boolean;
}) {
  const bodyRef = React.useRef<HTMLPreElement>(null);
  const group = useCompareGroup();
  const [localGapsOpen, setLocalGapsOpen] = React.useState(false);
  const paneId = React.useId();
  const reportChanged = group?.reportChanged;
  const gapsOpen = group ? group.gapsOpen : localGapsOpen;
  const toggleGaps = group ? group.toggleGaps : () => setLocalGapsOpen((current) => !current);


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

  // Tell the group which lines this pane changes, then collapse only the lines
  // no pane in the group touches — so every pane hides the same content.
  React.useEffect(() => {
    reportChanged?.(paneId, changed);
    return () => reportChanged?.(paneId, undefined);
  }, [reportChanged, paneId, changed]);
  // A line is only collapsed when no pane in the group changes it: the template
  // reports its own marks when it has them, the tasks always report theirs, and
  // the group keeps the union. With nothing changed anywhere the file is shown
  // whole, so a template never collapses into a single placeholder.
  const hideFlags = React.useMemo(() => {
    if (!lines?.length) return undefined;
    const length = lines.length;
    const flags = new Array<boolean>(length).fill(false);
    if (changed) for (let index = 0; index < Math.min(changed.length, length); index += 1) if (changed[index]) flags[index] = true;
    if (group) for (const index of group.changed) if (index < length) flags[index] = true;
    return flags.some(Boolean) ? flags : undefined;
  }, [changed, group, lines]);


  const highlightFlags = showGroupChanges ? hideFlags : changed;

  const rows = React.useMemo(
    () => collapseUnchanged(lines, hideFlags, gapsOpen),
    [lines, hideFlags, gapsOpen],
  );

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
              <div className="vfp-cmp-body">
              {rows.map((row) => row.kind === 'gap'
                ? <span key={`gap-${row.from}`} className="vfp-cmp-gap">
                    <button type="button" onClick={toggleGaps}>隐藏 {row.count} 行 无变化</button>
                  </span>
                : <span key={row.index} className="vfp-cmp-line" data-changed={highlightFlags?.[row.index] ? '' : undefined}>
                    <i>{row.index + 1}</i>{row.text || ' '}
                  </span>)}
              </div>
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

/** A malformed file preview must not unmount the surrounding task panel. */
class SourceCompareBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('[dsh-vaspflow] file preview render failed:', error);
  }

  render() {
    if (this.state.failed) return <div className="vfp-cmp vaspflow-task-popover"><div className="vfp-cmp-empty" data-error="" role="alert">该文件暂时无法预览，请重新打开。其他文件仍可查看。</div></div>;
    return this.props.children;
  }
}

export function SourceCompare(props: SourceCompareProps) {
  const identity = JSON.stringify([props.source?.path, props.fileName, props.planId, props.taskIndex]);
  return <SourceCompareBoundary key={identity}><SourceCompareContent {...props} /></SourceCompareBoundary>;
}

function SourceCompareContent({ projectRoot, projectName, slotLabel, source, fileName, files, planId, taskIndex, incarOverrides, rewritten, note, compact, writtenLabel, hint, compareWith, variant = 'both' }: SourceCompareProps) {
  const [compared, setCompared] = React.useState<Compared>();

  React.useEffect(() => {
    let cancelled = false;
    setCompared(undefined);
    void loadSourceComparison({
      projectRoot, sourcePath: source.path, fileName, files, planId, taskIndex, incarOverrides, rewritten, variant,
    }).then((value) => { if (!cancelled) setCompared(value); })
      .catch((error) => { if (!cancelled) setCompared({ source: [], error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, [projectRoot, source.path, fileName, files, planId, taskIndex, incarOverrides, rewritten, variant]);

  const overrideCount = Object.keys(incarOverrides ?? {}).length;
  const error = compared?.error;
  const marks = React.useMemo(
    () => (compared?.written && !error && !compared.partial ? markDifferences(compared.source, compared.written) : undefined),
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
      const written = toLines(text);
      const result = markDifferences(compared.source, written);
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
        {compared?.partial ? <span className="vfp-cmp-same" data-tone="muted" title={compared.notice}>部分内容</span> : variant !== 'source' && (error
          ? <span className="vfp-cmp-same" data-tone="muted">来源不可读</span>
          : compared?.writeError ? <span className="vfp-cmp-same" data-tone="muted" title={compared.writeError}>写入内容不可用</span>
          : marks && (same
            ? <span className="vfp-cmp-same">{compact ? '相同' : '与来源相同'}</span>
            : <span className="vfp-cmp-diff">{compact ? '不同' : '与来源不同'}{delta && <em className="vfp-cmp-delta"><b>+{delta.added}</b><b>−{delta.removed}</b></em>}</span>))}
      </div>
      <div className="vfp-cmp-grid" data-single={variant === 'both' ? undefined : ''}>
        {variant !== 'written' && (
          <FilePane step={variant === 'source' ? '模板内容' : '参考来源'} path={source.path} dirLabel={shortPath(projectRoot, source.path)} showGroupChanges={variant === 'source'}
            lines={compared?.source} error={error} changed={variant === 'source' ? unionMarks : variant === 'both' ? marks?.left : undefined} />
        )}
        {variant !== 'source' && (
          <FilePane step={variant === 'written' ? '本任务写入' : '将写入'} path={source.path}
            dirLabel={writtenLabel ?? shortPath(projectRoot, source.path)}
            lines={compared?.written} changed={marks?.right} error={compared?.writeError || error} />
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
