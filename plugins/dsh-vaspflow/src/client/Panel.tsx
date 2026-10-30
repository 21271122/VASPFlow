/**
 * dsh-vaspflow client: right-dock task detail with a popup task tree/table.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Input, Button, Select, Tooltip, Segmented, Tag, Typography, Tabs, Empty, Popover, Dropdown,
} from 'antd';
import {
  FolderOpenOutlined, ReloadOutlined, SearchOutlined, CloseOutlined,
  AppstoreOutlined, UnorderedListOutlined, MessageOutlined, MenuOutlined, DownOutlined,
} from '@ant-design/icons';
import { panelStore, usePanelStore } from './store';
import {
  absoluteTaskPath, basenameOf, buildShareIndex, describeSlots, originLabel,
  projectRelative, shortenPath, summarizeBatch, toPosix,
} from './inheritance';
import type { BuildBatchSummary } from './inheritance';
import { SourceCompare } from './source-compare';
import { startStructureDrag } from './structure-drag';
import type { BuildTaskDetail } from './store';
import { scanProject, scanProjectEvents, openTaskByPath, checkTaskInputs } from './api';
import { StatusBadge, TaskTable, TreeView, taskStatusCode } from './components';
import ConvergenceChart from './ConvergenceChart';
import StructureViewer from './StructureViewer';
import FileList from './FileList';
import type { Task } from './api';

const { Text } = Typography;

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function immediateParent(relPath: string): string {
  const parts = relPath.split(/[\\/]+/).filter((part) => part && part !== '.');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

function BuildInheritanceSummary({ summary }: { summary: BuildBatchSummary }) {
  const countsFor = (slot: BuildBatchSummary['slots'][number]) => {
    const parts: string[] = [];
    if (slot.inherit) parts.push(`${slot.inherit} 继承`);
    if (slot.override) parts.push(`${slot.override} 覆盖`);
    if (slot.explicit) parts.push(`${slot.explicit} 指定`);
    if (slot.missing) parts.push(`${slot.missing} 缺失`);
    return parts.join(' · ') || '无来源';
  };
  return (
    <div className="vfp-inherit-batch">
      <div className="vfp-inherit-batch-head">
        <span>本批次 · {summary.total} 个任务</span>
        <span className="vfp-inherit-templates">
          {summary.templates.map((template) => <span key={template.rel} title={template.rel}>{template.name} ×{template.count}</span>)}
          {summary.untemplated ? <span title="无模板，文件全部按任务指定">无模板 ×{summary.untemplated}</span> : null}
        </span>
      </div>
      <div className="vfp-inherit-bars">
        {summary.slots.map((slot) => {
          const total = slot.inherit + slot.override + slot.explicit + slot.missing || 1;
          return <div className="vfp-inherit-bar" key={slot.key} title={`${slot.label}：${countsFor(slot)}`}>
            <span className="vfp-inherit-bar-label">{slot.label}</span>
            <span className="vfp-inherit-bar-track">
              {slot.inherit ? <i data-origin="inherit" style={{ width: `${(slot.inherit / total) * 100}%` }} /> : null}
              {slot.override ? <i data-origin="override" style={{ width: `${(slot.override / total) * 100}%` }} /> : null}
              {slot.explicit ? <i data-origin="explicit" style={{ width: `${(slot.explicit / total) * 100}%` }} /> : null}
              {slot.missing ? <i data-origin="missing" style={{ width: `${(slot.missing / total) * 100}%` }} /> : null}
            </span>
            <span className="vfp-inherit-bar-count">{countsFor(slot)}</span>
          </div>;
        })}
      </div>
      <div className="vfp-inherit-legend" aria-hidden="true">
        <span data-origin="inherit">继承模板</span>
        <span data-origin="override">覆盖模板</span>
        <span data-origin="explicit">本任务指定</span>
        <span data-origin="missing">缺失</span>
      </div>
    </div>
  );
}

function BuildPreviewDetail({ detail }: { detail: BuildTaskDetail }) {
  const { task, result, batch } = detail;
  const projectRoot = detail.projectRoot || '';
  const status = result?.errors?.length ? '错误' : detail.phase === 'done' && result?.wrote ? '已写入' : result?.warnings?.length ? '需注意' : detail.phase === 'building' ? '构建中' : '可构建';
  const target = projectRoot ? absoluteTaskPath(projectRoot, task.dir || '.') : task.dir || '未指定';
  const crumbs = toPosix(task.dir || '.').split('/').filter((part) => part && part !== '.');
  const share = useMemo(() => buildShareIndex(batch, projectRoot), [batch, projectRoot]);
  const summary = useMemo(() => summarizeBatch(batch, projectRoot), [batch, projectRoot]);
  const slots = useMemo(() => describeSlots(task, result, projectRoot, share), [task, result, projectRoot, share]);
  const templateFullRel = task.template ? projectRelative(projectRoot, absoluteTaskPath(projectRoot, task.template)) : '';
  const templateRel = templateFullRel ? shortenPath(templateFullRel) : '';
  const templateShared = templateFullRel ? summary?.templates.find((entry) => entry.rel === templateFullRel)?.count ?? 0 : 0;
  const extras = (task.extraFiles ?? []).map((item, index) => ({
    name: item.dest || item.fromTemplate || basenameOf(item.src) || `额外文件 ${index + 1}`,
    path: (result?.sources ?? {})[item.dest || item.fromTemplate || basenameOf(item.src) || ''] as string | undefined,
  }));
  /** Hover previews; a click pins the card so it survives the pointer leaving. */
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const [pinnedSlot, setPinnedSlot] = useState<string | null>(null);
  /** Vertical shift that keeps every card centred on the panel, so it never jumps between rows. */
  const [alignOffset, setAlignOffset] = useState(0);
  /** Small grace period so moving from the row into the card does not close it. */
  const hoverTimer = useRef<number | null>(null);
  const cancelHoverClose = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);
  const scheduleHoverClose = useCallback(() => {
    cancelHoverClose();
    hoverTimer.current = window.setTimeout(() => {
      setHoverSlot(null);
      hoverTimer.current = null;
    }, 200);
  }, [cancelHoverClose]);
  useEffect(() => () => cancelHoverClose(), [cancelHoverClose]);
  /** Hover never steals focus from a pinned card. */
  const openCard = useCallback((slotKey: string, row: HTMLElement | null, force = false) => {
    if (!force && pinnedSlot && pinnedSlot !== slotKey) return;
    const rect = row?.getBoundingClientRect();
    if (rect) {
      const panel = row?.closest('[data-dsh-vaspflow-panel]') as HTMLElement | null;
      const panelRect = panel?.getBoundingClientRect();
      const centerY = panelRect ? panelRect.top + panelRect.height / 2 : window.innerHeight / 2;
      setAlignOffset(centerY - (rect.top + rect.height / 2));
    }
    cancelHoverClose();
    setHoverSlot(slotKey);
  }, [cancelHoverClose, pinnedSlot]);
  useEffect(() => { setHoverSlot(null); setPinnedSlot(null); }, [task.dir]);
  useEffect(() => {
    if (!pinnedSlot) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.vfp-cmp-popover, [data-vfp-source-row]')) return;
      setPinnedSlot(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPinnedSlot(null); };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pinnedSlot]);
  return (
    <div className="vfp-build-detail">
      <div className="vfp-build-detail-head"><strong>{basenameOf(task.dir) || '未命名任务'}</strong><Tag color={result?.errors?.length ? 'error' : result?.warnings?.length ? 'warning' : 'success'}>{status}</Tag></div>
      <div className="vfp-build-detail-path" title={target}>{[basenameOf(projectRoot) || '项目根目录', ...crumbs.slice(0, -1)].join(' › ')}</div>
      {summary && <BuildInheritanceSummary summary={summary} />}
      <div className="vfp-build-detail-section"><b>本任务来源</b>
        <div className="vfp-inherit-template">
          <span className="vfp-inherit-name">模板</span>
          {task.template
            ? <code className="vfp-inherit-path" title={absoluteTaskPath(projectRoot, task.template)}>{templateRel}</code>
            : <span className="vfp-inherit-empty">未指定模板</span>}
          {templateShared > 1 ? <span className="vfp-inherit-share">{templateShared} 个任务共用</span> : null}
        </div>
        <ul className="vfp-inherit-rows">
          {slots.map((slot) => {
            const row = <li key={slot.key} className="vfp-inherit-row" data-origin={slot.origin} data-vfp-source-row={slot.key}
              title={slot.path || slot.rel || '未提供'}>
              <span className="vfp-inherit-name">{slot.label}</span>
              <span className="vfp-inherit-badge" data-origin={slot.origin}>{originLabel(slot.origin)}</span>
              <code className="vfp-inherit-path">{slot.rel || '未提供'}</code>
              {slot.shared > 1 ? <span className="vfp-inherit-share" title={`${slot.shared} 个任务使用同一来源`}>×{slot.shared}</span> : null}
            </li>;
            if (!slot.path) return row;
            const destination = slot.key === 'submit' ? basenameOf(task.submitSrc) : slot.key;
            const diskCopy = absoluteTaskPath(projectRoot, `${toPosix(task.dir || '.')}/${destination}`);
            const afterRole = slot.origin === 'inherit' ? '继承模板' : slot.origin === 'override' ? '本任务覆盖' : '本任务指定';
            const open = hoverSlot === slot.key || pinnedSlot === slot.key;
            return <Popover
              key={slot.key}
              trigger={[]}
              open={open}
              destroyTooltipOnHide
              placement="left"
              align={{ offset: [0, alignOffset], overflow: { adjustX: true, adjustY: true } }}
              overlayClassName="vfp-cmp-popover"
              content={<div
                onMouseEnter={() => { cancelHoverClose(); }}
                onMouseLeave={scheduleHoverClose}
              >
                <SourceCompare
                  projectRoot={projectRoot}
                  projectName={basenameOf(projectRoot) || '项目'}
                  slotLabel={slot.label}
                  originText={originLabel(slot.origin)}
                  before={{ path: diskCopy }}
                  after={{ role: afterRole, path: slot.path }}
                />
              </div>}
            >
              <li
                className="vfp-inherit-row"
                data-origin={slot.origin}
                data-vfp-source-row={slot.key}
                data-pinned={pinnedSlot === slot.key ? '' : undefined}
                title={slot.path || slot.rel || '未提供'}
                onMouseEnter={(event) => openCard(slot.key, event.currentTarget)}
                onMouseLeave={scheduleHoverClose}
                onClick={(event) => {
                  openCard(slot.key, event.currentTarget, true);
                  setPinnedSlot((current) => (current === slot.key ? null : slot.key));
                }}
              >
                <span className="vfp-inherit-name">{slot.label}</span>
                <span className="vfp-inherit-badge" data-origin={slot.origin}>{originLabel(slot.origin)}</span>
                <code className="vfp-inherit-path">{slot.rel || '未提供'}</code>
                {slot.shared > 1 ? <span className="vfp-inherit-share" title={`${slot.shared} 个任务使用同一来源`}>×{slot.shared}</span> : null}
              </li>
            </Popover>;
          })}
        </ul>
        {extras.length ? <div className="vfp-inherit-extras">
          <span className="vfp-inherit-name">额外文件</span>
          <span>{extras.map((extra) => <code key={extra.name} title={extra.path || ''}>{extra.name}</code>)}</span>
        </div> : null}
        {!result && <div className="vfp-inherit-empty">尚未生成预览，来源为任务声明值，未经解析校验。</div>}
      </div>
      <div className="vfp-build-detail-section"><b>构建设置与检查</b>
        <div>Selective dynamics：{result?.sd || (task.freeAtoms?.length ? `放开原子 ${task.freeAtoms.join(', ')}` : task.fixedAtoms?.length ? `固定原子 ${task.fixedAtoms.join(', ')}` : task.sdPolicy === 'keep' ? '沿用源文件' : '待预览')}</div>
        <div>POTCAR：{result?.potcar || '待预览'} · {detail.linkPotcar ? '硬链接' : '复制'}</div>
        {task.incarOverrides && Object.keys(task.incarOverrides).length > 0 && <div>INCAR 覆盖：{Object.entries(task.incarOverrides).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}</div>}
        {task.extraFiles?.length ? <div>额外文件：{task.extraFiles.map((item) => item.dest || item.src || item.fromTemplate).join('、')}</div> : null}
        {result?.sdNotes?.map((note, index) => <div key={`sd-${index}`}>{note}</div>)}
        {result?.warnings?.map((warning, index) => <div className="vfp-build-warning" key={`warn-${index}`}>提醒：{warning}</div>)}
        {result?.errors?.map((error, index) => <div className="vfp-build-error" key={`error-${index}`}>错误：{error}</div>)}
      </div>
    </div>
  );
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器未允许复制到剪贴板');
}

/**
 * The width drag handle, rendered by React on the panel's left edge so it
 * follows the column natively. rAF-throttled pointer drag; suppresses text
 * selection while dragging.
 */
const PanelResizeHandle: React.FC<{
  onResize?: (width: number) => void;
  getWidth?: () => number;
}> = ({ onResize, getWidth }) => {
  const [active, setActive] = React.useState(false);
  const rafRef = React.useRef(0);
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const stop = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    dragRef.current = null;
    setActive(false);
    document.body.style.userSelect = '';
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', stop);
  };

  function onPointerMove(ev: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !onResize) return;
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const delta = drag.startX - ev.clientX;
      onResize(drag.startWidth + delta);
    });
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    ev.preventDefault();
    if (!onResize) return;
    const startWidth = getWidth ? getWidth() : 420;
    dragRef.current = { startX: ev.clientX, startWidth };
    setActive(true);
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', stop);
  };

  React.useEffect(() => stop, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize?.(420)}
      style={{
        position: 'absolute', top: 0, bottom: 0, left: 0,
        width: 12, zIndex: 45, cursor: 'col-resize',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 3, width: 2,
        background: active ? 'var(--dsw-alias-primary,#1677ff)' : 'rgba(127,127,127,.45)',
        transition: 'background .15s',
      }} />
    </div>
  );
};

export interface PanelProps {
  /** S5: put a visible collaboration draft into the conversation input. */
  onAnalyzeTask?: (task: Task, draft?: string) => void;
  /** S5: pick a workspace → set its path as the scan root. */
  onPickWorkspace?: (id: string) => void;
  /** Width drag: called with the new panel width (340–900). */
  onResizeWidth?: (width: number) => void;
  /** Current panel width (for the drag start). */
  getPanelWidth?: () => number;
}

export function Panel(props: PanelProps) {
  const {
    projectPath, projectId, tasks, directories, loading, scanProgress, scanError,
    selectedTask, selectedBuildTask, buildDryRun, buildModeError, viewTab, filterStatus, filterConverged, searchText, open,
    workspaceItems,
  } = usePanelStore();
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState('');
  const [, setInputTargetRevision] = useState(0);
  const [checkingInput, setCheckingInput] = useState(false);
  const [inputCheckError, setInputCheckError] = useState('');
  const [modeActionError, setModeActionError] = useState('');
  const closeScanRef = useRef<(() => void) | null>(null);

  const startIncrementalScan = () => {
    if (!projectPath.trim()) return;
    closeScanRef.current?.();
    const pendingBatchId = `pending-${Date.now()}`;
    panelStore.beginIncrementalScan(pendingBatchId);
    let closeStream: (() => void) | null = null;
    let started = false;
    let fallbackStarted = false;
    let fallbackTimer = 0;
    const fallbackToCompleteScan = async () => {
      if (started || fallbackStarted) return;
      fallbackStarted = true;
      closeStream?.();
      try {
        const data = await scanProject(projectPath.trim());
        if (data && !data.error) panelStore.applyScan(data);
        else panelStore.failIncrementalScan(undefined, data?.error);
      } catch (error) {
        panelStore.failIncrementalScan(undefined, error instanceof Error ? error.message : String(error));
      } finally {
        panelStore.setLoading(false);
        if (closeScanRef.current === closeStream) closeScanRef.current = null;
      }
    };
    try {
      closeStream = scanProjectEvents(projectPath.trim(), {
        onStart: (event) => {
          started = true;
          window.clearTimeout(fallbackTimer);
          panelStore.beginIncrementalScan(event.batchId);
        },
        onEvent: (type, event) => {
          panelStore.recordScanEvent(type, event);
          if (type === 'scan-complete' || type === 'scan-failed') {
            closeStream?.();
            if (closeScanRef.current === closeStream) closeScanRef.current = null;
          }
        },
        onError: () => {
          if (!started) void fallbackToCompleteScan();
          else if (panelStore.getSnapshot().scanProgress) panelStore.failIncrementalScan();
        },
      });
      closeScanRef.current = closeStream;
      // Some embedded browser shells allow fetch but suppress EventSource
      // callbacks. The complete-scan route is a safe compatibility fallback.
      fallbackTimer = window.setTimeout(() => { void fallbackToCompleteScan(); }, 2000);
    } catch {
      void fallbackToCompleteScan();
    }
  };

  const handleOpen = startIncrementalScan;
  const handleRefresh = startIncrementalScan;

  useEffect(() => () => closeScanRef.current?.(), []);

  const vaspTasks = tasks.filter((t) => t.is_vasp_task !== false);
  const stats = useMemo(() => ({
    total: vaspTasks.length,
    NO_OUTPUT_EVIDENCE: vaspTasks.filter((t) => taskStatusCode(t) === 'NO_OUTPUT_EVIDENCE').length,
    TASK_COMPLETED: vaspTasks.filter((t) => taskStatusCode(t) === 'TASK_COMPLETED').length,
    ERROR_DETECTED: vaspTasks.filter((t) => taskStatusCode(t) === 'ERROR_DETECTED').length,
    RUNNING: vaspTasks.filter((t) => taskStatusCode(t) === 'RUNNING').length,
    UNKNOWN: vaspTasks.filter((t) => taskStatusCode(t) === 'UNKNOWN').length,
  }), [vaspTasks]);

  const selectedIsVaspTask = selectedTask?.is_vasp_task !== false;
  const selectedPath = selectedTask ? absoluteTaskPath(projectPath, selectedTask.rel_path) : '';
  const selectedParent = selectedTask ? immediateParent(selectedTask.rel_path) : '';
  const selectedInputTarget = selectedTask
    ? declaredInputTarget(projectPath, selectedTask.rel_path)
    : null;
  const inferredInputProfile = selectedTask ? inputFeatureProfile(selectedTask) : 'basic-inputs';
  const activeInputProfile = selectedInputTarget?.profileId ?? inferredInputProfile;
  const inputProfileIsAutomatic = !selectedInputTarget;

  useEffect(() => {
    setCheckingInput(false);
    setInputCheckError('');
  }, [selectedTask?.id]);

  const copySelectedPath = async () => {
    if (!selectedPath) return;
    try {
      await copyText(selectedPath);
      setCopiedPath(selectedPath);
      window.setTimeout(() => setCopiedPath((value) => value === selectedPath ? '' : value), 1600);
    } catch {
      setCopiedPath('复制失败');
    }
  };

  const runInputCheck = async (profileId: string) => {
    if (!selectedTask || !selectedIsVaspTask) return;
    setCheckingInput(true);
    setInputCheckError('');
    try {
      const result = await checkTaskInputs(selectedTask.id, profileId);
      panelStore.setTaskInputCheck(selectedTask.id, result.input_check);
    } catch (error) {
      setInputCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingInput(false);
    }
  };

  const handleInputMenu = (key: string) => {
    if (!selectedTask || !selectedIsVaspTask) return;
    if (key === 'basic') {
      void runInputCheck('basic-inputs');
      return;
    }
    if (key === 'inferred') {
      void runInputCheck(inferredInputProfile);
      return;
    }
    if (key === 'clear-target') {
      writeInputTarget(projectPath, 'task', selectedTask.rel_path, null);
      setInputTargetRevision((revision) => revision + 1);
      return;
    }
    const [scope, profileId] = key.split(':');
    if ((scope !== 'task' && scope !== 'folder') || !INPUT_CHECK_OPTIONS.some((option) => option.value === profileId)) return;
    writeInputTarget(projectPath, scope, selectedTask.rel_path, profileId);
    setInputTargetRevision((revision) => revision + 1);
    void runInputCheck(profileId);
  };

  // --- S5 reverse linkage: agent tool → panel auto refresh ------------------
  // The host TaskStore version bumps on every scan; poll while the panel is
  // open and re-scan the current root when it changes (so an agent's
  // vasp_scan result appears without a manual refresh).
  const lastVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!projectId || !projectPath.trim()) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const response = await fetch('/plugins/dsh-vaspflow/version', { cache: 'no-store' });
        const body = await response.json();
        if (body && typeof body.version === 'number') {
          if (!closeScanRef.current && lastVersionRef.current !== null && lastVersionRef.current !== body.version) {
            // store changed (likely an agent tool): refresh quietly, keeping
            // the current selection so the detail pane is not interrupted.
            try {
              const data = await scanProject(projectPath.trim());
              if (data && !data.error) panelStore.applyScan(data, true);
            } catch {
              // keep current data on failure
            }
          }
          lastVersionRef.current = body.version;
        }
      } catch {
        // host unreachable: stop polling
        return;
      }
    };
    const timer = window.setInterval(tick, 2000);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, projectPath]);

  useEffect(() => {
    // Ordinary directories (not VASP tasks) can still show structures, so no
    // forced jump to the files tab anymore — the disabled state of the
    // "收敛图表" tab already guides the user.
    if (selectedTask && !selectedIsVaspTask && viewTab === 'chart') {
      panelStore.setViewTab('structure');
    }
  }, [selectedTask, selectedIsVaspTask, viewTab]);

  const tabItems = [
    {
      key: 'status',
      label: '状态',
      disabled: !selectedTask || !selectedIsVaspTask,
      children: selectedTask && selectedIsVaspTask ? <TaskStatusEvidence task={selectedTask} /> : null,
    },
    {
      key: 'chart',
      label: '收敛图表',
      disabled: !selectedTask || !selectedIsVaspTask,
      children: selectedTask && selectedIsVaspTask ? <ConvergenceChart taskId={selectedTask.id} /> : null,
    },
    {
      key: 'structure',
      label: '3D 结构',
      // Available for ANY selected entry: ordinary directories (no OUTCAR /
      // vasprun.xml — not "VASP tasks") still hold structure files that the
      // viewer can render. Only the convergence chart needs a real task.
      disabled: !selectedTask,
      children: selectedTask ? <StructureViewer taskId={selectedTask.id} rootPath={projectPath} relPath={selectedTask.rel_path} /> : null,
    },
    {
      key: 'files',
      label: '文件',
      disabled: !selectedTask,
      children: selectedTask ? <FileList taskId={selectedTask.id} rootPath={projectPath} relPath={selectedTask.rel_path} /> : null,
    },
  ];

  const handleAiAction = useCallback((task: Task, instruction: string) => {
    const draft = `${buildTaskContext(task, projectPath)}\n\n[协作请求]\n${instruction}`;
    if (props.onAnalyzeTask) {
      props.onAnalyzeTask(task, draft);
      return;
    }
    // Fallback for a host without a conversation prefill bridge.
    copyText(draft).then(() => {
        // eslint-disable-next-line no-alert
        window.alert('协作请求已复制到剪贴板，粘贴到聊天输入框即可继续。');
    }).catch(() => {});
  }, [props.onAnalyzeTask, projectPath]);

  const inputMenuItems = [
    { key: 'inferred', label: `按输入特征检查：${inputProfileLabel(inferredInputProfile)}` },
    { key: 'basic', label: '仅做基础自检（四个输入文件）' },
    { type: 'divider' as const },
    {
      key: 'task-target', label: '改为其他类型（仅此任务）',
      children: INPUT_CHECK_OPTIONS.map((option) => ({ key: `task:${option.value}`, label: option.label })),
    },
    {
      key: 'folder-target', label: '设为本目录默认类型',
      children: INPUT_CHECK_OPTIONS.map((option) => ({ key: `folder:${option.value}`, label: option.label })),
    },
    ...(selectedInputTarget?.scope === 'task' ? [{ type: 'divider' as const }, { key: 'clear-target', label: '清除本任务的检查目标' }] : []),
  ];

  const aiMenuItems = [
    {
      type: 'group' as const, label: '当前任务', children: [
        { key: 'diagnose', label: '诊断异常与排查' },
        { key: 'report', label: '生成可读汇报' },
      ],
    },
    {
      type: 'group' as const, label: '当前目录', children: [
        { key: 'batch-check', label: '批量巡检任务状态' },
      ],
    },
    {
      type: 'group' as const, label: '检查标准', children: [
        { key: 'draft-check-plan', label: '起草输入检查标准' },
      ],
    },
  ];

  const handleAiMenu = (key: string) => {
    if (!selectedTask) return;
    const path = absoluteTaskPath(projectPath, selectedTask.rel_path);
    const instructions: Record<string, string> = {
      diagnose: '请读取与当前状态相关的 VASP 输出和日志，诊断异常原因。先区分确定性证据与需要人工判断的部分，再给出可执行的排查顺序。',
      'batch-check': `请扫描并巡检目录“${path}”及其子目录中的 VASP 任务；汇总状态、确定性错误和需要人工复核的项目。`,
      report: '请把现有任务信息整理成一份面向研究者的简洁汇报：进展、关键数据、风险和下一步。不要重新诊断未读取的文件。',
      'draft-check-plan': '请根据此任务的输入特征和研究目的，起草一份输入检查标准。先说明假设，再列出可由程序确定性执行的规则；不要直接修改任何规则。',
    };
    const targetNote = selectedInputTarget
      ? `用户已设置的输入检查目标：${inputProfileLabel(selectedInputTarget.profileId)}（${selectedInputTarget.scope === 'folder' ? '继承目录默认' : '本任务设置'}）。`
      : `程序按输入特征暂选检查类型：${inputProfileLabel(inferredInputProfile)}；这不是用户已确认的研究意图。`;
    if (instructions[key]) handleAiAction(selectedTask, `${targetNote}\n\n${instructions[key]}`);
  };

  const hasTree = tasks.length > 0 || directories.length > 0 || Boolean(scanProgress);
  const taskListControl = hasTree ? (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={listOpen}
      onOpenChange={setListOpen}
      overlayClassName="vaspflow-task-popover"
      content={
        <div className="vfp-task-popup">
          <div className="vfp-task-search">
            <Input
              size="small"
              placeholder="搜索..."
              aria-label="搜索任务"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => panelStore.setSearchText(e.target.value)}
              allowClear
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <div className="vfp-task-filters">
            <Select
              size="small"
              placeholder="状态"
              aria-label="状态筛选"
              style={{ width: 94 }}
              allowClear
              value={filterStatus}
              onChange={(v) => panelStore.setFilterStatus(v ?? null)}
              options={[
                { value: 'NO_OUTPUT_EVIDENCE', label: '未输出' },
                { value: 'TASK_COMPLETED', label: '完成' },
                { value: 'RUNNING', label: '运行中' },
                { value: 'ERROR_DETECTED', label: '错误' },
                { value: 'UNKNOWN', label: '待检查' },
              ]}
            />
            <Select
              size="small"
              placeholder="收敛"
              aria-label="收敛筛选"
              style={{ width: 94 }}
              allowClear
              value={filterConverged}
              onChange={(v) => panelStore.setFilterConverged(v ?? null)}
              options={[
                { value: true, label: '收敛' },
                { value: false, label: '未收敛' },
              ]}
            />
            <Segmented
              size="small"
              value={viewMode}
              onChange={(v) => setViewMode(v as 'tree' | 'table')}
              options={[
                { value: 'tree', icon: <AppstoreOutlined />, title: '树视图' },
                { value: 'table', icon: <UnorderedListOutlined />, title: '表视图' },
              ]}
            />
          </div>
          <div className="vfp-task-popup-list">
            {viewMode === 'tree'
              ? <TreeView onTaskSelected={() => setListOpen(false)} />
              : <TaskTable onTaskSelected={() => setListOpen(false)} />}
          </div>
        </div>
      }
    >
      <Button size="small" className="vfp-task-list-trigger" icon={<MenuOutlined />} aria-expanded={listOpen}>任务列表</Button>
    </Popover>
  ) : null;

  return (
    <div className="vfp-panel">
      <PanelResizeHandle onResize={props.onResizeWidth} getWidth={props.getPanelWidth} />
      {/* header */}
      <header className="vfp-panel-header">
        <div className="vfp-panel-brand">
          <span>VASP</span>
          {hasTree && (
            <div className="vfp-header-statistics">
              <span className="vfp-stat-total">任务 {stats.total}</span>
              <span className="vfp-stat-directory">目录 {directories.length}</span>
              {scanProgress && <span className="vfp-scan-progress">已扫描 {stats.total} 个任务，仍在检查 {Math.max(0, scanProgress.discoveredDirectories - scanProgress.scannedDirectories)} 个目录</span>}
              <div className="vfp-stat-states">
                {[
                  ['NO_OUTPUT_EVIDENCE', '未输出', 'var(--vfp-warning)'],
                  ['TASK_COMPLETED', '完成', 'var(--vfp-success)'],
                  ['RUNNING', '运行中', 'var(--vfp-accent)'],
                  ['ERROR_DETECTED', '错误', 'var(--vfp-error)'],
                  ['UNKNOWN', '待检查', 'var(--vfp-muted)'],
                ].map(([code, label, color]) => (
                  <Button key={code} className="vfp-stat-filter" type="text" size="small" style={{ color }}
                    data-status={code} data-count={stats[code as keyof typeof stats]}
                    aria-pressed={filterStatus === code}
                    onClick={() => panelStore.setFilterStatus(filterStatus === code ? null : code)}>
                    {label} {stats[code as keyof typeof stats]}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Tooltip title={open ? '收起面板' : '展开面板'}>
            <Button size="small" type="text" icon={<CloseOutlined />} aria-label="收起面板" onClick={() => panelStore.toggleOpen()} />
          </Tooltip>
        </div>
        <div className="vfp-project-controls">
          {workspaceItems.length > 0 && (
            <Select
              size="small"
              placeholder="从工作区"
              className="vfp-workspace-picker"
              aria-label="从工作区选择"
              open={workspaceOpen}
              onDropdownVisibleChange={setWorkspaceOpen}
              onChange={(id) => {
                setWorkspaceOpen(false);
                props.onPickWorkspace?.(String(id));
              }}
              options={workspaceItems}
            />
          )}
          <Input
            size="small"
            placeholder="项目根目录路径..."
            aria-label="项目根目录路径"
            value={projectPath}
            onChange={(e) => panelStore.setProjectPath(e.target.value)}
            onPressEnter={handleOpen}
            prefix={<FolderOpenOutlined />}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Tooltip title="打开项目">
            <Button size="small" type="primary" icon={<FolderOpenOutlined />} aria-label="打开项目" onClick={handleOpen} loading={loading} />
          </Tooltip>
          {projectId && (
            <Tooltip title="刷新">
              <Button size="small" icon={<ReloadOutlined />} aria-label="刷新项目" onClick={handleRefresh} loading={loading} />
            </Tooltip>
          )}
        </div>
      </header>

      {buildModeError && <div style={{ flex: 'none', padding: '6px 10px', background: 'rgba(196,65,54,.11)', color: '#c44136', fontSize: 12 }}>{buildModeError}</div>}

      {buildDryRun === false && <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '3px 10px', background: 'rgba(38,151,102,.09)', fontSize: 12 }}>
        <span>AI 直接构建已开启</span>
        <Button size="small" type="link" style={{ padding: 0, height: 22, fontSize: 12 }} onClick={async () => {
          try {
            const response = await fetch('/plugins/dsh-vaspflow/build-inputs/mode', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '切换失败');
            panelStore.setBuildDryRun(true);
            setModeActionError('');
          } catch (error) {
            setModeActionError(error instanceof Error ? error.message : String(error));
          }
        }}>恢复预览确认</Button>
        {modeActionError && <span style={{ color: '#c44136' }}>{modeActionError}</span>}
      </div>}

      {/* body: detail fills the whole panel; the task list lives in the popup */}
      <div className={`vfp-panel-body${selectedBuildTask ? ' vfp-panel-body-build' : ''}`}>
        {(selectedBuildTask || !selectedTask) && taskListControl && <div className="vfp-task-navigation-standby">{taskListControl}</div>}
        {selectedBuildTask ? (
          <BuildPreviewDetail detail={selectedBuildTask} />
        ) : !selectedTask ? (
          <Empty style={{ marginTop: 30 }} description={
            scanError ? <span style={{ color: '#ff4d4f' }}>{scanError}</span>
              : loading ? '正在扫描目录…'
                : projectId !== null && tasks.length === 0 ? (
                  <span>
                    未发现 VASP 任务<br />
                    <Text type="secondary" style={{ fontSize: 12 }}>已检查当前目录及其子目录。请选择包含 POSCAR、INCAR、KPOINTS、POTCAR 的计算目录。</Text>
                  </span>
                ) : hasTree ? '点击「任务列表」选择任务' : '输入目录路径并点击蓝色按钮扫描'
          } />
        ) : (
          <>
            <div className="vfp-task-summary">
              <div className="vfp-task-overview">
                <div className="vfp-task-identity">
                <div className="vfp-task-path" title={selectedPath}>{selectedPath}</div>
                  <div className="vfp-task-title">
                    <Tooltip placement="top" title={copiedPath === selectedPath ? '已复制绝对路径' : `${selectedPath} · 可拖至结构卡片`}>
                      <span
                        role="button"
                        tabIndex={0}
                        draggable
                        aria-label="复制任务绝对路径"
                        onDragStart={(event) => { startStructureDrag(event.dataTransfer, { kind: 'task', rootPath: projectPath, relPath: selectedTask.rel_path }); }}
                        onClick={() => { void copySelectedPath(); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void copySelectedPath();
                          }
                        }}
                        className="vfp-task-name"
                      >
                        {selectedParent && <Text type="secondary">{selectedParent} / </Text>}
                        <Text strong>{selectedTask.label}</Text>
                      </span>
                    </Tooltip>
                  </div>
                </div>
                {selectedIsVaspTask ? (
                  <div className="vfp-task-facts">
                    <div><span>体系</span><strong>{selectedTask.system || '—'}</strong></div>
                    <div><span>类型</span><strong>{selectedTask.task_type?.label ?? '—'}</strong></div>
                    <div><span>离子步</span><strong className="vfp-number">{selectedTask.n_ion_steps}</strong></div>
                    <div><span>最终能量</span><strong className="vfp-number">{selectedTask.final_energy?.toFixed(6) ?? '—'} <small>eV</small></strong></div>
                  </div>
                ) : <Text type="secondary">普通目录</Text>}
                <div className="vfp-task-status">
                  {taskListControl}
                  {selectedIsVaspTask && <StatusBadge task={selectedTask} />}
                </div>
              </div>
              <div className="vfp-task-actions">
                {selectedIsVaspTask && (
                  <Tooltip title={selectedTask.input_check?.profileId
                    ? `上次按“${inputProfileLabel(selectedTask.input_check.profileId)}”检查`
                    : `${inputProfileIsAutomatic ? '按输入特征自动选择' : selectedInputTarget?.scope === 'folder' ? '继承目录默认类型' : '本任务设置'}：${inputProfileLabel(activeInputProfile)}`}>
                    <Dropdown.Button
                      size="small"
                      icon={<DownOutlined />}
                      loading={checkingInput}
                      menu={{ items: inputMenuItems, onClick: ({ key }) => handleInputMenu(String(key)) }}
                      onClick={() => { void runInputCheck(activeInputProfile); }}
                    >
                      {selectedTask.input_check?.profileId
                        ? `输入检查 · ${compactInputCheckLabel(selectedTask.input_check.code)}`
                        : `输入检查 · ${inputProfileLabel(activeInputProfile)}`}
                    </Dropdown.Button>
                  </Tooltip>
                )}
                <Dropdown menu={{ items: aiMenuItems, onClick: ({ key }) => handleAiMenu(String(key)) }}>
                  <Button size="small" type="primary" ghost icon={<MessageOutlined />} aria-label="AI 操作">
                    AI <DownOutlined />
                  </Button>
                </Dropdown>
              </div>
              {inputCheckError && <div style={{ marginTop: 6, color: '#ff4d4f', fontSize: 14 }}>输入检查未完成：{inputCheckError}</div>}
            </div>
            <Tabs
              className="vfp-detail-tabs"
              size="small"
              activeKey={viewTab}
              onChange={(key) => panelStore.setViewTab(key as any)}
              items={tabItems}
              style={{ marginBottom: 0 }}
            />
          </>
        )}
      </div>
    </div>
  );
}

const INPUT_CHECK_OPTIONS = [
  { value: 'basic-inputs', label: '基础 VASP 输入' },
  { value: 'static-scf', label: '静态单点 / SCF' },
  { value: 'structure-optimization', label: '结构优化' },
  { value: 'frequency-zpe', label: '频率 / ZPE' },
  { value: 'aimd', label: 'AIMD' },
  { value: 'neb', label: 'NEB / CI-NEB' },
];

type InputTarget = { profileId: string; scope: 'task' | 'folder' };

const inputTargetMemory = new Map<string, InputTarget>();
const INPUT_TARGET_STORAGE_PREFIX = 'dsh-vaspflow:input-target:';

function normalizedRelPath(relPath: string): string {
  return relPath.split(/[\\/]+/).filter((part) => part && part !== '.').join('/');
}

function inputTargetKey(rootPath: string, scope: InputTarget['scope'], relPath: string): string {
  return `${INPUT_TARGET_STORAGE_PREFIX}${rootPath.toLowerCase()}|${scope}|${normalizedRelPath(relPath).toLowerCase()}`;
}

function readStoredInputTarget(key: string): InputTarget | null {
  const memory = inputTargetMemory.get(key);
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InputTarget;
    if (!INPUT_CHECK_OPTIONS.some((option) => option.value === parsed.profileId)) return null;
    if (parsed.scope !== 'task' && parsed.scope !== 'folder') return null;
    inputTargetMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeInputTarget(rootPath: string, scope: InputTarget['scope'], relPath: string, profileId: string | null): void {
  const key = inputTargetKey(rootPath, scope, relPath);
  if (!profileId) {
    inputTargetMemory.delete(key);
    try { window.localStorage.removeItem(key); } catch { /* keep the in-memory removal */ }
    return;
  }
  const target: InputTarget = { profileId, scope };
  inputTargetMemory.set(key, target);
  try { window.localStorage.setItem(key, JSON.stringify(target)); } catch { /* memory is enough for this session */ }
}

function declaredInputTarget(rootPath: string, relPath: string): InputTarget | null {
  const own = readStoredInputTarget(inputTargetKey(rootPath, 'task', relPath));
  if (own) return own;
  const parts = normalizedRelPath(relPath).split('/').filter(Boolean);
  for (let length = parts.length; length >= 0; length -= 1) {
    const folder = readStoredInputTarget(inputTargetKey(rootPath, 'folder', parts.slice(0, length).join('/')));
    if (folder) return folder;
  }
  return null;
}

function inputProfileLabel(profileId?: string): string {
  return INPUT_CHECK_OPTIONS.find((option) => option.value === profileId)?.label ?? '基础 VASP 输入';
}

function inputFeatureProfile(task: Task): string {
  switch (task.task_type?.code) {
    case 'RELAXATION': return 'structure-optimization';
    case 'FREQUENCY_ZPE': return 'frequency-zpe';
    case 'AIMD': return 'aimd';
    case 'NEB': return 'neb';
    case 'STATIC_SCF': return 'static-scf';
    default: return 'basic-inputs';
  }
}

function compactInputCheckLabel(code?: string): string {
  if (code === 'PASS') return '通过';
  if (code === 'WARN') return '注意';
  if (code === 'FAIL') return '未通过';
  if (code === 'STALE') return '已过期';
  return '未检查';
}

function inputTagColor(code?: string): string {
  if (code === 'PASS') return 'green';
  if (code === 'WARN') return 'gold';
  if (code === 'FAIL') return 'red';
  if (code === 'STALE') return 'orange';
  return 'default';
}

/** B1 detail-first view: keep status and its reasons together. */
function TaskStatusEvidence({ task }: { task: Task }) {
  const status = task.status_record;
  const input = task.input_check;
  const inputEvidence = input?.evidence ?? [];
  const statusEvidence = status?.evidence ?? [];
  const primaryEvidence = statusEvidence.find((item) => item.severity === 'error') ?? statusEvidence[0];
  const extraEvidence = statusEvidence.filter((item) => item !== primaryEvidence && item.message !== status?.reason);
  const statusColor = status?.code === 'ERROR_DETECTED'
    ? 'var(--vfp-error)'
    : status?.code === 'TASK_COMPLETED'
      ? 'var(--vfp-success)'
      : status?.code === 'RUNNING'
        ? 'var(--vfp-accent)'
        : status?.code === 'NO_OUTPUT_EVIDENCE'
          ? 'var(--vfp-warning)'
          : 'var(--vfp-muted)';
  return (
    <div className="vfp-status-evidence">
      <div className="vfp-status-card" style={{ borderLeftColor: statusColor }}>
        <div className="vfp-status-card-head">
          <Text strong>{status?.label ?? '待检查'}</Text>
          <Text type="secondary">扫描于 {formatDateTime(status?.observedAt)}</Text>
        </div>
        <div className="vfp-status-reason">{status?.reason ?? '旧版任务记录尚无状态理由；请刷新项目。'}</div>
        {primaryEvidence?.file ? <Text type="secondary" className="vfp-status-source">依据：{primaryEvidence.file}</Text> : null}
        {primaryEvidence?.excerpt ? <div className="vfp-status-excerpt">{primaryEvidence.excerpt}</div> : null}
        {extraEvidence.length ? <div className="vfp-status-extra">其他发现：{extraEvidence.map((item) => item.message).join('；')}</div> : null}
      </div>
      {input?.profileId ? (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', padding: '2px 2px 0' }}>
          <Text type="secondary">输入检查</Text>
          <Tag color={inputTagColor(input.code)}>{inputProfileLabel(input.profileId)} · {compactInputCheckLabel(input.code)}</Tag>
          <Text type="secondary" style={{ fontSize: 13 }}>{formatDateTime(input.observedAt)}</Text>
          {input.code !== 'PASS' && inputEvidence.length ? <Text style={{ width: '100%', fontSize: 14 }}>发现：{inputEvidence.map((item) => item.message).join('；')}</Text> : null}
        </div>
      ) : null}
    </div>
  );
}

/** S5: build the task-context template for conversation prefill. */
export function buildTaskContext(task: Task, projectPath: string): string {
  const lattice = task.lattice_consts ? `a=${task.lattice_consts[0]?.toFixed(3)} b=${task.lattice_consts[1]?.toFixed(3)} c=${task.lattice_consts[2]?.toFixed(3)}` : '-';
  const incar = task.incar_summary
    ? Object.entries(task.incar_summary).slice(0, 8)
        .map(([k, v]) => `${k}=${v}`).join(', ')
    : '-';
  return [
    '[VASP 任务上下文]',
    `路径：${projectPath}/${task.rel_path}`,
    `体系：${task.system} | 任务类型：${task.task_type?.label ?? '-'} | 状态：${task.status_record?.label ?? task.status}`,
    `状态理由：${task.status_record?.reason ?? '-'} | 最近观察：${task.status_record?.observedAt ?? '-'}`,
    `输入检查：${task.input_check?.label ?? '未指定检查规则'}${task.input_check?.profileId ? `（${task.input_check.profileId}@${task.input_check.profileVersion}）` : ''}`,
    `离子步：${task.n_ion_steps} | E：${task.final_energy ?? 'N/A'} eV | Fmax：${task.final_max_force ?? 'N/A'} | 磁矩：${(task as any).magmom_total ?? 'N/A'}`,
    `晶格：${lattice}`,
    `INCAR 摘要：${incar}`,
    '请在 VASP 计算助手预设中使用 vasp_* 工具分析。',
  ].join('\n');
}
