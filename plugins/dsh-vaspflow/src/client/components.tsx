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
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TreeDataNode } from 'antd';
import { panelStore, usePanelStore } from './store';
import type { Task } from './api';

/** Status dot color per the original Sidebar semantics. */
function TaskStatusDot({ task }: { task: Task }) {
  const color =
    task.status === 'finished'
      ? task.is_converged ? '#52c41a' : '#13c2c2'
      : task.status === 'error' ? '#ff4d4f' : '#faad14';
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      marginRight: -2,
      flexShrink: 0,
    }} />
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

export function buildProjectTree(directories: any[], tasks: Task[]): VaspTreeNode[] {
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
      : <TaskStatusDot task={task} />;
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
    if (filterStatus && task.status !== filterStatus) return false;
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
      const selfMatches = task ? taskMatches(task) : selfMatchesSearch && !filterStatus && filterConverged === null;
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
export function TaskTable({ onAnalyze, onTaskSelected }: {
  onAnalyze?: (task: Task) => void;
  /** Called when a task row is selected (used to auto-close the popup). */
  onTaskSelected?: (task: Task) => void;
}) {
  const { tasks, loading, filterStatus, filterConverged, searchText, selectedTask } = usePanelStore();

  const filteredTasks = React.useMemo(() => {
    let result = tasks;
    if (filterStatus) result = result.filter((t) => t.status === filterStatus);
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
      dataIndex: 'status',
      key: 'status',
      width: 80,
      filters: [
        { text: '已完成', value: 'finished' },
        { text: '错误', value: 'error' },
        { text: '未知', value: 'unknown' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (v: string) => {
        const color = v === 'finished' ? 'green' : v === 'error' ? 'red' : 'orange';
        const label = v === 'finished' ? '完成' : v === 'error' ? '错误' : '未知';
        return <Tag color={color}>{label}</Tag>;
      },
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
          {onAnalyze && (
            <Tooltip title="分析此任务">
              <Button type="link" size="small"
                onClick={() => onAnalyze(record)}>分析</Button>
            </Tooltip>
          )}
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
        onClick: () => panelStore.setSelectedTask(record),
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
export function TreeView({ onAnalyze, onTaskSelected }: {
  onAnalyze?: (task: Task) => void;
  /** Called when a task node is selected (used to auto-close the popup). */
  onTaskSelected?: (task: Task) => void;
}) {
  const {
    projectPath, tasks, directories, loading,
    selectedTask, filterStatus, filterConverged, searchText,
  } = usePanelStore();
  const [expandedKeys, setExpandedKeys] = React.useState<React.Key[]>([]);

  const fullTree = React.useMemo(() => buildProjectTree(directories, tasks), [directories, tasks]);
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
      panelStore.setViewTab(task.is_vasp_task === false ? 'files' : 'chart');
      onTaskSelected?.(task);
    }
  };

  const handleDoubleClick = async (nodeData: VaspTreeNode) => {
    const relPath = nodeData.__rel_path;
    if (!relPath || !projectPath) return;
    const existing = tasks.find((task) => normalizePath(task.rel_path) === normalizePath(relPath));
    if (existing) {
      panelStore.setSelectedTask(existing);
      panelStore.setViewTab(existing.is_vasp_task === false ? 'files' : 'chart');
      onTaskSelected?.(existing);
      return;
    }
    panelStore.setLoading(true);
    try {
      const { openTaskByPath } = await import('./api');
      const newTask = await openTaskByPath(projectPath, relPath);
      panelStore.setTasks([...tasks, newTask]);
      panelStore.setSelectedTask(newTask);
      panelStore.setViewTab(newTask.is_vasp_task === false ? 'files' : 'chart');
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
    const content = task && task.is_vasp_task !== false ? (
      <Tooltip
        title={`体系: ${task.system} | 状态: ${task.status} | ${task.n_ion_steps}步 | E: ${task.final_energy?.toFixed(4) ?? 'N/A'} eV`}
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
        {task && task.is_vasp_task !== false && (
          <Button type="link" size="small" style={{ fontSize: 11, padding: 0, marginLeft: 6 }}
            onClick={(e) => { e.stopPropagation(); onAnalyze?.(task); }}>
            分析
          </Button>
        )}
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
