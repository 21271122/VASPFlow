/**
 * dsh-vaspflow client: right-dock panel — header (path/open/refresh/stat
 * badges/search/filters/view toggle/collapse) + vertical split (task list on
 * top ~45%, detail tabs below ~55%).
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

function absoluteTaskPath(rootPath: string, relPath: string): string {
  const root = rootPath.replace(/[\\/]+$/, '');
  const relative = (relPath || '.').replace(/^[\\/]+/, '');
  return !relative || relative === '.' ? root : `${root}\\${relative.replace(/[\\/]+/g, '\\')}`;
}

function immediateParent(relPath: string): string {
  const parts = relPath.split(/[\\/]+/).filter((part) => part && part !== '.');
  return parts.length > 1 ? parts[parts.length - 2] : '';
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
    projectPath, projectId, tasks, directories, loading, scanProgress,
    selectedTask, viewTab, filterStatus, filterConverged, searchText, open,
    workspaceItems,
  } = usePanelStore();
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState('');
  const [, setInputTargetRevision] = useState(0);
  const [checkingInput, setCheckingInput] = useState(false);
  const [inputCheckError, setInputCheckError] = useState('');
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
      } catch {
        panelStore.failIncrementalScan();
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
      children: selectedTask ? <StructureViewer taskId={selectedTask.id} /> : null,
    },
    {
      key: 'files',
      label: '文件',
      disabled: !selectedTask,
      children: selectedTask ? <FileList taskId={selectedTask.id} /> : null,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <PanelResizeHandle onResize={props.onResizeWidth} getWidth={props.getPanelWidth} />
      {/* header */}
      <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px', height: 44, borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
      }}>
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>VASP</span>
        {workspaceItems.length > 0 && (
          <Select
            size="small"
            placeholder="从工作区"
            style={{ width: 92, flexShrink: 0 }}
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
          value={projectPath}
          onChange={(e) => panelStore.setProjectPath(e.target.value)}
          onPressEnter={handleOpen}
          prefix={<FolderOpenOutlined />}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Tooltip title="打开项目">
          <Button size="small" type="primary" icon={<FolderOpenOutlined />} onClick={handleOpen} loading={loading} />
        </Tooltip>
        {projectId && (
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
          </Tooltip>
        )}
        <Tooltip title={open ? '收起面板' : '展开面板'}>
          <Button size="small" icon={<CloseOutlined />} onClick={() => panelStore.toggleOpen()} />
        </Tooltip>
      </div>

      {/* toolbar: stats + list popup trigger */}
      {hasTree && (
        <div style={{
          flex: 'none', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '7px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e6eb)', fontSize: 14,
        }}>
          <span style={{ color: '#1677ff', fontWeight: 600 }}>任务 {stats.total}</span>
          <span style={{ color: '#8c8c8c' }}>目录 {directories.length}</span>
          {scanProgress && <span style={{ color: '#1677ff', fontSize: 13 }}>已扫描 {stats.total} 个任务，仍在检查 {Math.max(0, scanProgress.discoveredDirectories - scanProgress.scannedDirectories)} 个目录</span>}
          {[
            ['NO_OUTPUT_EVIDENCE', '未输出', '#faad14'],
            ['TASK_COMPLETED', '完成', '#52c41a'],
            ['RUNNING', '运行中', '#1677ff'],
            ['ERROR_DETECTED', '错误', '#ff4d4f'],
            ['UNKNOWN', '待检查', '#8c8c8c'],
          ].map(([code, label, color]) => (
            <Button key={code} type="text" size="small" style={{ color, padding: 0, height: 22, fontSize: 14 }}
              onClick={() => panelStore.setFilterStatus(filterStatus === code ? null : code)}>
              {label} {stats[code as keyof typeof stats]}
            </Button>
          ))}
          <span style={{ flex: 1 }} />
          <Popover
            trigger="click"
            placement="bottomRight"
            open={listOpen}
            onOpenChange={setListOpen}
            overlayClassName="vaspflow-task-popover"
            content={
              <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Input
                    size="small"
                    placeholder="搜索..."
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={(e) => panelStore.setSearchText(e.target.value)}
                    allowClear
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Select
                    size="small"
                    placeholder="状态"
                    style={{ width: 68 }}
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
                    style={{ width: 68 }}
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
                <div style={{ maxHeight: 'min(55vh, 480px)', overflowY: 'auto', minHeight: 120 }}>
                  {viewMode === 'tree'
                    ? <TreeView onTaskSelected={() => setListOpen(false)} />
                    : <TaskTable onTaskSelected={() => setListOpen(false)} />}
                </div>
              </div>
            }
          >
            <Button size="small" icon={<MenuOutlined />}>任务列表</Button>
          </Popover>
        </div>
      )}

      {/* body: detail fills the whole panel; the task list lives in the popup */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px' }}>
        {!selectedTask ? (
          <Empty style={{ marginTop: 30 }} description="点击「任务列表」选择任务" />
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Tooltip placement="top" title={copiedPath === selectedPath ? '已复制绝对路径' : selectedPath}>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="复制任务绝对路径"
                    onClick={() => { void copySelectedPath(); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void copySelectedPath();
                      }
                    }}
                    style={{ fontSize: 16, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 160px', cursor: 'pointer' }}
                  >
                    {selectedParent && <Text type="secondary">{selectedParent} / </Text>}
                    <Text strong>{selectedTask.label}</Text>
                  </span>
                </Tooltip>
                {selectedIsVaspTask && <StatusBadge task={selectedTask} />}
                <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
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
                </span>
              </div>
              {selectedIsVaspTask ? (
                <div style={{ display: 'flex', gap: '4px 10px', flexWrap: 'wrap', marginTop: 6, fontSize: 14 }}>
                  <Text type="secondary">体系：{selectedTask.system}</Text>
                  <Text type="secondary">类型：{selectedTask.task_type?.label ?? '—'}</Text>
                  <Text type="secondary">离子步：{selectedTask.n_ion_steps}</Text>
                  <Text type="secondary">最终能量：{selectedTask.final_energy?.toFixed(6) ?? '—'} eV</Text>
                </div>
              ) : <Text type="secondary">普通目录</Text>}
              {inputCheckError && <div style={{ marginTop: 6, color: '#ff4d4f', fontSize: 14 }}>输入检查未完成：{inputCheckError}</div>}
            </div>
            <Tabs
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
  return '未检查';
}

function inputTagColor(code?: string): string {
  if (code === 'PASS') return 'green';
  if (code === 'WARN') return 'gold';
  if (code === 'FAIL') return 'red';
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
    ? '#ff4d4f'
    : status?.code === 'TASK_COMPLETED'
      ? '#52c41a'
      : status?.code === 'RUNNING'
        ? '#1677ff'
        : status?.code === 'NO_OUTPUT_EVIDENCE'
          ? '#faad14'
          : '#8c8c8c';
  return (
    <div style={{ fontSize: 15, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
      <div style={{ padding: '12px 14px', border: '1px solid #30384d', borderLeft: `4px solid ${statusColor}`, borderRadius: 8, background: '#171f32' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <Text strong style={{ fontSize: 16 }}>{status?.label ?? '待检查'}</Text>
          <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>扫描于 {formatDateTime(status?.observedAt)}</Text>
        </div>
        <div style={{ marginTop: 5, fontSize: 16 }}>{status?.reason ?? '旧版任务记录尚无状态理由；请刷新项目。'}</div>
        {primaryEvidence?.file ? <Text type="secondary" style={{ display: 'block', marginTop: 5, fontSize: 13 }}>依据：{primaryEvidence.file}</Text> : null}
        {primaryEvidence?.excerpt ? <div style={{ marginTop: 5, padding: '5px 8px', color: '#b7c1d8', background: '#101726', borderRadius: 4, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap' }}>{primaryEvidence.excerpt}</div> : null}
        {extraEvidence.length ? <div style={{ marginTop: 7, color: '#b7c1d8', fontSize: 13 }}>其他发现：{extraEvidence.map((item) => item.message).join('；')}</div> : null}
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
