/**
 * dsh-vaspflow client: right-dock panel — header (path/open/refresh/stat
 * badges/search/filters/view toggle/collapse) + vertical split (task list on
 * top ~45%, detail tabs below ~55%).
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Input, Button, Select, Tooltip, Segmented, Tag, Typography, Tabs, Empty, Popover,
} from 'antd';
import {
  FolderOpenOutlined, ReloadOutlined, SearchOutlined, CloseOutlined,
  AppstoreOutlined, UnorderedListOutlined, MessageOutlined, MenuOutlined,
} from '@ant-design/icons';
import { panelStore, usePanelStore } from './store';
import { scanProject, openTaskByPath } from './api';
import { TaskTable, TreeView } from './components';
import ConvergenceChart from './ConvergenceChart';
import StructureViewer from './StructureViewer';
import FileList from './FileList';
import type { Task } from './api';

const { Text } = Typography;

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
  /** S5: prefill the conversation input (provided by the entry). */
  onAnalyzeTask?: (task: Task) => void;
  /** S5: pick a workspace → set its path as the scan root. */
  onPickWorkspace?: (id: string) => void;
  /** Width drag: called with the new panel width (340–900). */
  onResizeWidth?: (width: number) => void;
  /** Current panel width (for the drag start). */
  getPanelWidth?: () => number;
}

export function Panel(props: PanelProps) {
  const {
    projectPath, projectId, tasks, directories, loading,
    selectedTask, viewTab, filterStatus, filterConverged, searchText, open,
    workspaceItems,
  } = usePanelStore();
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const handleOpen = async () => {
    if (!projectPath.trim()) return;
    panelStore.setLoading(true);
    try {
      const data = await scanProject(projectPath.trim());
      if (data?.error) {
        panelStore.setProjectId(null);
        return;
      }
      panelStore.applyScan(data);
    } catch {
      panelStore.setTasks([]);
      panelStore.setDirectories([]);
    } finally {
      panelStore.setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!projectPath.trim()) return;
    panelStore.setLoading(true);
    try {
      const data = await scanProject(projectPath.trim());
      if (data && !data.error) {
        panelStore.applyScan(data);
      }
    } catch {
      // Keep existing tree on refresh failure.
    } finally {
      panelStore.setLoading(false);
    }
  };

  const vaspTasks = tasks.filter((t) => t.is_vasp_task !== false);
  const stats = useMemo(() => ({
    total: vaspTasks.length,
    finished: vaspTasks.filter((t) => t.status === 'finished').length,
    converged: vaspTasks.filter((t) => t.is_converged).length,
    errors: vaspTasks.filter((t) => t.status === 'error').length,
  }), [vaspTasks]);

  const selectedIsVaspTask = selectedTask?.is_vasp_task !== false;

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
          if (lastVersionRef.current !== null && lastVersionRef.current !== body.version) {
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

  const handleAnalyze = useCallback((task: Task) => {
    if (props.onAnalyzeTask) {
      props.onAnalyzeTask(task);
      return;
    }
    // fallback: copy context to clipboard
    const context = buildTaskContext(task, projectPath);
    try {
      navigator.clipboard.writeText(context).then(() => {
        // eslint-disable-next-line no-alert
        window.alert('任务上下文已复制到剪贴板，粘贴到聊天输入框即可分析');
      });
    } catch {
      // ignore
    }
  }, [props.onAnalyzeTask, projectPath]);

  const hasTree = tasks.length > 0 || directories.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <PanelResizeHandle onResize={props.onResizeWidth} getWidth={props.getPanelWidth} />
      {/* header */}
      <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px', height: 44, borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>VASP</span>
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
          padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e6eb)', fontSize: 12,
        }}>
          <span style={{ color: '#1677ff', fontWeight: 600 }}>任务 {stats.total}</span>
          <span style={{ color: '#8c8c8c' }}>目录 {directories.length}</span>
          <span style={{ color: '#52c41a' }}>完成 {stats.finished}</span>
          <span style={{ color: '#13c2c2' }}>收敛 {stats.converged}</span>
          {stats.errors > 0 && <span style={{ color: '#ff4d4f' }}>错误 {stats.errors}</span>}
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
                      { value: 'finished', label: '完成' },
                      { value: 'error', label: '错误' },
                      { value: 'unknown', label: '未知' },
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
                    ? <TreeView onAnalyze={handleAnalyze} onTaskSelected={() => setListOpen(false)} />
                    : <TaskTable onAnalyze={handleAnalyze} onTaskSelected={() => setListOpen(false)} />}
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
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 14 }}>{selectedTask.label}</Text>
              {selectedIsVaspTask ? (
                <>
                  <Text type="secondary" style={{ fontSize: 12 }}>体系：{selectedTask.system}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>离子步：{selectedTask.n_ion_steps}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>E：{selectedTask.final_energy?.toFixed(6) ?? 'N/A'} eV</Text>
                  {selectedTask.lattice_consts && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      a={selectedTask.lattice_consts[0]?.toFixed(3)} b={selectedTask.lattice_consts[1]?.toFixed(3)} c={selectedTask.lattice_consts[2]?.toFixed(3)}
                    </Text>
                  )}
                </>
              ) : (
                <Text type="secondary">普通目录</Text>
              )}
              {selectedIsVaspTask && selectedTask.is_converged !== undefined && (
                <Tag color={selectedTask.is_converged ? 'green' : 'red'}>
                  {selectedTask.is_converged ? '已收敛' : '未收敛'}
                </Tag>
              )}
              {selectedIsVaspTask && selectedTask.status === 'error' && <Tag color="red">错误</Tag>}
              <Button size="small" type="primary" ghost icon={<MessageOutlined />}
                onClick={() => handleAnalyze(selectedTask)}>
                分析此任务
              </Button>
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
    `体系：${task.system} | 状态：${task.status} | 收敛：${task.is_converged}`,
    `离子步：${task.n_ion_steps} | E：${task.final_energy ?? 'N/A'} eV | Fmax：${task.final_max_force ?? 'N/A'} | 磁矩：${(task as any).magmom_total ?? 'N/A'}`,
    `晶格：${lattice}`,
    `INCAR 摘要：${incar}`,
    '请在 VASP 计算助手预设中使用 vasp_* 工具分析。',
  ].join('\n');
}
