/**
 * dsh-vaspflow client: panel store — port of frontend/src/store/useAppStore.ts
 * into a tiny external-store (no zustand dependency; the shell ships zustand
 * but keeping the bundle self-contained avoids a peer resolution).
 */
import { useSyncExternalStore } from 'react';

export type ViewTab = 'status' | 'chart' | 'structure' | 'files';

export interface PanelState {
  projectPath: string;
  projectId: number | null;
  tasks: any[];
  directories: any[];
  pendingDirectories: any[];
  failedDirectories: any[];
  scanProgress: { batchId: string; scannedDirectories: number; discoveredDirectories: number } | null;
  loading: boolean;
  selectedTask: any | null;
  viewTab: ViewTab;
  filterStatus: string | null;
  filterConverged: boolean | null;
  searchText: string;
  /** Right-dock panel open state (collapsed = width 0). */
  open: boolean;
  /** DSH workspaces for the "从工作区" picker (S5). */
  workspaceItems: Array<{ value: string; label: string }>;
}

function readInitialOpen(): boolean {
  try {
    // Default collapsed: the sidebar entry opens the panel.
    return localStorage.getItem('dsh-vaspflow:panel-collapse:') === 'expanded';
  } catch {
    return false;
  }
}

const initial: PanelState = {
  projectPath: '',
  projectId: null,
  tasks: [],
  directories: [],
  pendingDirectories: [],
  failedDirectories: [],
  scanProgress: null,
  loading: false,
  selectedTask: null,
  viewTab: 'chart',
  filterStatus: null,
  filterConverged: null,
  searchText: '',
  open: readInitialOpen(),
  workspaceItems: [],
};

class PanelStore {
  private state: PanelState = { ...initial };
  private listeners = new Set<() => void>();

  getSnapshot = (): PanelState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  setProjectPath(path: string) { this.set({ projectPath: path }); }
  setProjectId(id: number | null) { this.set({ projectId: id }); }
  setTasks(tasks: any[]) { this.set({ tasks }); }
  setDirectories(directories: any[]) { this.set({ directories }); }
  setLoading(loading: boolean) { this.set({ loading }); }
  setSelectedTask(task: any | null) { this.set({ selectedTask: task }); }
  setTaskInputCheck(taskId: number, inputCheck: any) {
    const patchTask = (task: any) => task?.id === taskId ? { ...task, input_check: inputCheck } : task;
    this.set({
      tasks: this.state.tasks.map(patchTask),
      selectedTask: patchTask(this.state.selectedTask),
    });
  }
  setViewTab(tab: ViewTab) { this.set({ viewTab: tab }); }
  setFilterStatus(status: string | null) { this.set({ filterStatus: status }); }
  setFilterConverged(converged: boolean | null) { this.set({ filterConverged: converged }); }
  setSearchText(text: string) { this.set({ searchText: text }); }
  setOpen(open: boolean) {
    this.set({ open });
    try {
      localStorage.setItem('dsh-vaspflow:panel-collapse:', open ? 'expanded' : 'collapsed');
    } catch {
      // ignore
    }
  }
  toggleOpen() { this.setOpen(!this.state.open); }
  setWorkspaceItems(items: Array<{ value: string; label: string }>) { this.set({ workspaceItems: items }); }
  reset() { this.set({ ...initial }); }

  beginIncrementalScan(batchId: string) {
    this.set({ projectId: null, tasks: [], directories: [], pendingDirectories: [], failedDirectories: [], selectedTask: null, scanProgress: { batchId, scannedDirectories: 0, discoveredDirectories: 0 }, loading: true });
  }

  recordScanEvent(type: string, event: any) {
    const progress = this.state.scanProgress;
    if (!progress || event.batchId !== progress.batchId) return;
    const rel = event.directory?.rel_path;
    if (type === 'directory-discovered' && event.directory) {
      if (this.state.directories.some((item) => item.rel_path === rel) || this.state.pendingDirectories.some((item) => item.rel_path === rel)) return;
      this.set({ pendingDirectories: [...this.state.pendingDirectories, event.directory], scanProgress: { ...progress, discoveredDirectories: progress.discoveredDirectories + 1 } });
      return;
    }
    if (type === 'directory-scanned' && event.directory) {
      const nextDirectories = rel === '.' || this.state.directories.some((item) => item.rel_path === rel)
        ? this.state.directories
        : [...this.state.directories, event.directory];
      const nextTasks = event.task
        ? [...this.state.tasks.filter((item) => item.rel_path !== event.task.rel_path), event.task]
        : this.state.tasks;
      this.set({
        directories: nextDirectories,
        tasks: nextTasks,
        pendingDirectories: this.state.pendingDirectories.filter((item) => item.rel_path !== rel),
        scanProgress: { ...progress, scannedDirectories: progress.scannedDirectories + 1 },
      });
      return;
    }
    if (type === 'directory-failed' && event.directory) {
      this.set({
        pendingDirectories: this.state.pendingDirectories.filter((item) => item.rel_path !== rel),
        failedDirectories: [...this.state.failedDirectories.filter((item) => item.rel_path !== rel), { ...event.directory, reason: event.reason || '无法读取目录' }],
      });
      return;
    }
    if (type === 'scan-complete') {
      this.applyScan(event);
      this.set({ pendingDirectories: [], failedDirectories: event.failedDirectories || [], scanProgress: null, loading: false });
    }
  }

  failIncrementalScan(batchId?: string) {
    if (batchId && this.state.scanProgress?.batchId !== batchId) return;
    this.set({ pendingDirectories: [], scanProgress: null, loading: false });
  }

  /**
   * Merge a scan result into the store.
   * @param preserveSelection - keep the currently selected task when true
   *   (used by the reverse-linkage poll refresh; open/refresh buttons reset).
   */
  applyScan(result: any, preserveSelection = false) {
    const selected = this.state.selectedTask;
    let nextSelected: any | null = null;
    if (preserveSelection && selected) {
      const found = (result.tasks || []).find((t: any) => t.id === selected.id);
      nextSelected = found ?? selected;
    }
    this.set({
      projectId: result.project_id,
      tasks: result.tasks || [],
      directories: result.directories || [],
      pendingDirectories: [],
      failedDirectories: result.failedDirectories || [],
      scanProgress: null,
      selectedTask: nextSelected,
    });
  }
}

export const panelStore = new PanelStore();

/** React hook reading the panel store. */
export function usePanelStore(): PanelState {
  return useSyncExternalStore(panelStore.subscribe, panelStore.getSnapshot);
}
