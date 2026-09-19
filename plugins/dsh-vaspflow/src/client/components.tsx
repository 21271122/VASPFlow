/**
 * dsh-vaspflow client: list views — TaskTable (port of TaskTable.tsx) and the
 * directory tree (port of Sidebar.tsx tree logic), both reading the panel
 * store and driving selection.
 */
import React from 'react';
import { Tag, Table, Tooltip, Button, Space, Tree } from 'antd';
import {
  LineChartOutlined,
  EyeOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  FileOutlined,
  LoadingOutlined,
  QuestionCircleFilled,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TreeDataNode } from 'antd';
import { panelStore, usePanelStore } from './store';
import type { Task } from './api';

const STATUS_META = {
  NO_OUTPUT_EVIDENCE: { label: '未发现计算输出', color: '#faad14', tag: 'gold', icon: FileOutlined },
  TASK_COMPLETED: { label: '任务完成', color: '#52c41a', tag: 'green', icon: CheckCircleFilled },
  ERROR_DETECTED: { label: '检测到错误', color: '#ff4d4f', tag: 'red', icon: CloseCircleFilled },
  RUNNING: { label: '正在运行', color: '#1677ff', tag: 'blue', icon: LoadingOutlined },
  UNKNOWN: { label: '待检查', color: '#8c8c8c', tag: 'default', icon: QuestionCircleFilled },
} as const;

export function taskStatusCode(task: Task): keyof typeof STATUS_META {
  if (task.status_record?.code && task.status_record.code in STATUS_META) return task.status_record.code as keyof typeof STATUS_META;
  if (task.status === 'finished') return 'TASK_COMPLETED';
  if (task.status === 'error') return 'ERROR_DETECTED';
  return 'UNKNOWN';
}

export function StatusBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  const code = taskStatusCode(task);
  const meta = STATUS_META[code];
  const Icon = meta.icon;
  const title = task.status_record?.reason || meta.label;
  if (compact) {
    return (
      <Tooltip title={`${meta.label}：${title}`} mouseEnterDelay={0.4}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: meta.color }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color }} />
          <Icon spin={code === 'RUNNING'} style={{ fontSize: 12 }} />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={title} mouseEnterDelay={0.4}>
      <Tag color={meta.tag} style={{ marginInlineEnd: 0 }} icon={<Icon spin={code === 'RUNNING'} />}>
        {meta.label}
      </Tag>
    </Tooltip>
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.';
}

function pathParts(path: string): string[] {
  const normalized = normalizePath(path);
  return normalized === '.' ? ['.'] : normalized.split('/').filter(Boolean);
}

type VaspTreeNode = TreeDataNode & {
  __task?: Task;
  __rel_path?: string;
  __pending?: boolean;
  __failedReason?: string;
};

function sortNodes(nodes: VaspTreeNode[]): VaspTreeNode[] {
  return nodes.sort((a, b) => {
    const aTask = Boolean(a.__task?.is_vasp_task !== false && a.__task);
    const bTask = Boolean(b.__task?.is_vasp_task !== false && b.__task);
    if (!aTask && bTask) return -1;
    if (aTask && !bTask) return 1;
    return String(a.title).localeCompare(String(b.title));
  }).map((node) => ({
    ...node,
    children: node.children ? sortNodes(node.children as VaspTreeNode[]) : undefined,
  }));
}

export function buildProjectTree(directories: any[], tasks: Task[], pendingDirectories: any[] = [], failedDirectories: any[] = []): VaspTreeNode[] {
  const nodeMap = new Map<string, VaspTreeNode>();
  const roots: VaspTreeNode[] = [];

  const ensureDir = (relPath: string, label?: string): VaspTreeNode => {
    const parts = pathParts(relPath);
    let currentPath = '';
    let parent: VaspTreeNode | undefined;

    for (let i = 0; i < parts.length; i += 1) {
      currentPath = parts[i] === '.' ? '.' : currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      let node = nodeMap.get(currentPath);
      if (!node) {
        node = {
          title: i === parts.length - 1 && label ? label : parts[i],
          key: `dir:${currentPath}`,
          icon: <FolderOutlined style={{ color: '#faad14' }} />,
          children: [],
          __rel_path: currentPath,
        };
        nodeMap.set(currentPath, node);
        if (parent) {
          parent.children = [...(parent.children || []), node];
        } else {
          roots.push(node);
        }
      }
      parent = node;
    }
    return parent!;
  };

  directories.forEach((dir) => ensureDir(dir.rel_path, dir.label));
  tasks.forEach((task) => {
    const node = ensureDir(task.rel_path, task.label);
    node.title = task.label;
    node.__task = task;
    node.__rel_path = normalizePath(task.rel_path);
    node.icon = task.is_vasp_task === false
      ? <FolderOutlined style={{ color: '#8c8c8c' }} />
      : <StatusBadge task={task} compact />;
  });

  pendingDirectories.forEach((dir) => {
    const node = ensureDir(dir.rel_path, dir.label);
    if (node.__task) return;
    node.__pending = true;
    node.title = `正在检查目录 ${dir.label}`;
    node.icon = <LoadingOutlined spin style={{ color: '#1677ff' }} />;
  });

  failedDirectories.forEach((dir) => {
    const node = ensureDir(dir.rel_path, dir.label);
    if (node.__task) return;
    node.__pending = false;
    node.__failedReason = dir.reason || '无法读取目录';
    node.title = `无法扫描目录 ${dir.label}`;
    node.icon = <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
  });

  return sortNodes(roots);
}

function filterTaskTree(
  nodes: VaspTreeNode[],
  filterStatus: string | null,
  filterConverged: boolean | null,
  searchText: string,
): VaspTreeNode[] {
  const kw = searchText.trim().toLowerCase();
  if (!filterStatus && filterConverged === null && !kw) return nodes;

  const taskMatches = (task: Task): boolean => {
    if (task.is_vasp_task === false) return !filterStatus && filterConverged === null;
    if (filterStatus && taskStatusCode(task) !== filterStatus) return false;
    if (filterConverged !== null && task.is_converged !== filterConverged) return false;
    if (kw) {
      return (
        task.label.toLowerCase().includes(kw) ||
        task.system.toLowerCase().includes(kw) ||
        task.rel_path.toLowerCase().includes(kw)
      );
    }
    return true;
  };

  const walk = (items: VaspTreeNode[]): VaspTreeNode[] => {
    const result: VaspTreeNode[] = [];
    for (const node of items) {
      const task = node.__task;
      const children = node.children ? walk(node.children as VaspTreeNode[]) : [];
      const selfMatchesSearch = !kw || String(node.title).toLowerCase().includes(kw) || (node.__rel_path || '').toLowerCase().includes(kw);
      const selfMatches = node.__pending
        ? !filterStatus && filterConverged === null && !kw
        : task ? taskMatches(task) : selfMatchesSearch && !filterStatus && filterConverged === null;
      if (selfMatches || children.length > 0) {
        result.push({ ...node, children });
      }
    }
    return result;
  };
  return walk(nodes);
}

function collectKeys(nodes: VaspTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: VaspTreeNode[]) => {
    items.forEach((node) => {
      keys.push(String(node.key));
      if (node.children) walk(node.children as VaspTreeNode[]);
    });
  };
  walk(nodes);
  return keys;
}

/** Table view (port of TaskTable.tsx, without the drawer). */
export function TaskTable({ onTaskSelected }: {
  /** Called when a task row is selected (used to auto-close the popup). */
  onTaskSelected?: (task: Task) => void;
}) {
  const { tasks, loading, filterStatus, filterConverged, searchText, selectedTask } = usePanelStore();

  const filteredTasks = React.useMemo(() => {
    let result = tasks;
    if (filterStatus) result = result.filter((t) => taskStatusCode(t) === filterStatus);
    if (filterConverged !== null) result = result.filter((t) => t.is_converged === filterConverged);
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.label.toLowerCase().includes(kw) ||
          t.system.toLowerCase().includes(kw) ||
          t.rel_path.toLowerCase().includes(kw),
      );
    }
    return result;
  }, [tasks, filterStatus, filterConverged, searchText]);

  const handleConvergence = (task: Task) => {
    panelStore.setSelectedTask(task);
    panelStore.setViewTab('chart');
    onTaskSelected?.(task);
  };

  const handleStructure = (task: Task) => {
    panelStore.setSelectedTask(task);
    panelStore.setViewTab('structure');
    onTaskSelected?.(task);
  };

  const columns: ColumnsType<Task> = [
    {
      title: '标签',
      dataIndex: 'label',
      key: 'label',
      width: 140,
      sorter: (a, b) => a.label.localeCompare(b.label),
      render: (v: string, record: Task) => (
        <a onClick={() => {
          panelStore.setSelectedTask(record);
          panelStore.setViewTab('status');
          onTaskSelected?.(record);
        }}>{v}</a>
      ),
    },
    {
      title: '体系',
      dataIndex: 'system',
      key: 'system',
      width: 120,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status_record',
      key: 'status',
      width: 145,
      filters: [
        { text: '未发现计算输出', value: 'NO_OUTPUT_EVIDENCE' },
        { text: '任务完成', value: 'TASK_COMPLETED' },
        { text: '检测到错误', value: 'ERROR_DETECTED' },
        { text: '正在运行', value: 'RUNNING' },
        { text: '待检查', value: 'UNKNOWN' },
      ],
      onFilter: (value, record) => taskStatusCode(record) === value,
      render: (_: unknown, record: Task) => (
        <Space direction="vertical" size={2}>
          <StatusBadge task={record} />
          <span style={{ color: '#8c8c8c', fontSize: 10 }}>{record.input_check?.label ?? '未指定检查规则'}</span>
        </Space>
      ),
    },
    {
      title: '收敛',
      dataIndex: 'is_converged',
      key: 'is_converged',
      width: 70,
      filters: [
        { text: '已收敛', value: true },
        { text: '未收敛', value: false },
      ],
      onFilter: (value, record) => record.is_converged === value,
      render: (v: boolean | undefined) => {
        if (v === undefined) return <Tag>—</Tag>;
        return <Tag color={v ? 'green' : 'red'}>{v ? '是' : '否'}</Tag>;
      },
    },
    {
      title: '离子步',
      dataIndex: 'n_ion_steps',
      key: 'n_ion_steps',
      width: 70,
      sorter: (a, b) => a.n_ion_steps - b.n_ion_steps,
    },
    {
      title: '最终能量 / eV',
      dataIndex: 'final_energy',
      key: 'final_energy',
      width: 160,
      render: (v: number | null) => (v != null ? v.toFixed(6) : 'N/A'),
      sorter: (a, b) => (a.final_energy ?? 0) - (b.final_energy ?? 0),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_: unknown, record: Task) => (
        <Space size={0}>
          <Tooltip title="查看收敛曲线">
            <Button type="link" size="small" icon={<LineChartOutlined />}
              onClick={() => handleConvergence(record)} />
          </Tooltip>
          <Tooltip title="查看 3D 结构">
            <Button type="link" size="small" icon={<EyeOutlined />}
              onClick={() => handleStructure(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  if (tasks.length === 0) return null;

  return (
    <Table
      columns={columns}
      dataSource={filteredTasks}
      rowKey="id"
      size="small"
      loading={loading}
      onRow={(record) => ({
        onClick: () => { panelStore.setSelectedTask(record); panelStore.setViewTab('status'); },
        style: {
          background: selectedTask?.id === record.id ? 'var(--dsw-specific-sidebar-nav-item-active, #e6f4ff)' : undefined,
          cursor: 'pointer',
        },
      })}
      pagination={{
        pageSize: 50,
        showSizeChanger: true,
        showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个任务`,
      }}
      scroll={{ y: 'calc(100vh - 320px)' }}
    />
  );
}

/** Directory tree view (port of Sidebar.tsx tree portion). */
export function TreeView({ onTaskSelected }: {
  /** Called when a task node is selected (used to auto-close the popup). */
  onTaskSelected?: (task: Task) => void;
}) {
  const {
    projectPath, tasks, directories, pendingDirectories, failedDirectories, loading,
    selectedTask, filterStatus, filterConverged, searchText,
  } = usePanelStore();
  const [expandedKeys, setExpandedKeys] = React.useState<React.Key[]>([]);

  const fullTree = React.useMemo(() => buildProjectTree(directories, tasks, pendingDirectories, failedDirectories), [directories, tasks, pendingDirectories, failedDirectories]);
  const visibleTree = React.useMemo(
    () => filterTaskTree(fullTree, filterStatus, filterConverged, searchText),
    [fullTree, filterStatus, filterConverged, searchText],
  );

  React.useEffect(() => {
    const visibleKeys = new Set(collectKeys(visibleTree));
    const rootKeys = visibleTree.map((n) => n.key as string);
    setExpandedKeys((prev) => {
      const kept = prev.filter((key) => visibleKeys.has(String(key)));
      return kept.length > 0 ? kept : rootKeys;
    });
  }, [visibleTree]);

  const selectedKeys = selectedTask ? [`dir:${normalizePath(selectedTask.rel_path)}`] : [];

  const handleSelect = (_keys: React.Key[], info: any) => {
    const task = (info.node as VaspTreeNode).__task;
    if (task) {
      panelStore.setSelectedTask(task);
      panelStore.setViewTab(task.is_vasp_task === false ? 'files' : 'status');
      onTaskSelected?.(task);
    }
  };

  const handleDoubleClick = async (nodeData: VaspTreeNode) => {
    const relPath = nodeData.__rel_path;
    if (!relPath || !projectPath) return;
    const existing = tasks.find((task) => normalizePath(task.rel_path) === normalizePath(relPath));
    if (existing) {
      panelStore.setSelectedTask(existing);
      panelStore.setViewTab(existing.is_vasp_task === false ? 'files' : 'status');
      onTaskSelected?.(existing);
      return;
    }
    panelStore.setLoading(true);
    try {
      const { openTaskByPath } = await import('./api');
      const newTask = await openTaskByPath(projectPath, relPath);
      panelStore.setTasks([...tasks, newTask]);
      panelStore.setSelectedTask(newTask);
      panelStore.setViewTab(newTask.is_vasp_task === false ? 'files' : 'status');
      onTaskSelected?.(newTask);
    } catch {
      // Ignore open failures; the tree state is preserved.
    } finally {
      panelStore.setLoading(false);
    }
  };

  const titleRender = (node: TreeDataNode) => {
    const treeNode = node as VaspTreeNode;
    const task = treeNode.__task;
    if (treeNode.__pending) {
      return <span style={{ fontSize: 12, color: '#1677ff' }}>{node.title as string}</span>;
    }
    if (treeNode.__failedReason) {
      return <Tooltip title={treeNode.__failedReason}><span style={{ fontSize: 12, color: '#ff4d4f' }}>{node.title as string}</span></Tooltip>;
    }
    const content = task && task.is_vasp_task !== false ? (
      <Tooltip
        title={`体系: ${task.system} | ${task.status_record?.label ?? task.status}：${task.status_record?.reason ?? ''} | 最近观察: ${task.status_record?.observedAt ?? '-'} `}
        mouseEnterDelay={0.5}
      >
        <span style={{ fontSize: 12 }}>
          {node.title as string}
          <span style={{ color: 'var(--dsw-alias-label-tertiary, #999)', marginLeft: 8, fontSize: 10 }}>
            {task.n_ion_steps}步
          </span>
        </span>
      </Tooltip>
    ) : (
      <span style={{ fontSize: 12, color: task ? 'var(--dsw-alias-label-secondary, #555)' : 'var(--dsw-alias-label-tertiary, #666)' }}>
        {node.title as string}
      </span>
    );
    return (
      <span
        style={{ userSelect: 'none' }}
        onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(treeNode); }}
      >
        {content}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 2px 4px', position: 'relative' }}>
        {visibleTree.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#bbb', marginTop: 30, fontSize: 12 }}>
            <FolderOpenOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
            {tasks.length === 0 && directories.length === 0
              ? '输入路径并打开项目'
              : loading ? '正在扫描...' : '未找到目录或任务'}
          </div>
        ) : (
          <Tree
            treeData={visibleTree}
            selectedKeys={selectedKeys}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys)}
            onSelect={handleSelect}
            titleRender={titleRender}
            showIcon
            style={{ fontSize: 12, background: 'transparent' }}
          />
        )}
      </div>
    </div>
  );
}
