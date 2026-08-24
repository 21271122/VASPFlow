/**
 * dsh-vaspflow client: panel store — port of frontend/src/store/useAppStore.ts
 * into a tiny external-store (no zustand dependency; the shell ships zustand
 * but keeping the bundle self-contained avoids a peer resolution).
 */
import { useSyncExternalStore } from 'react';

export type ViewTab = 'chart' | 'structure' | 'files';

export interface PanelState {
  projectPath: string;
  projectId: number | null;
  tasks: any[];
  directories: any[];
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
      selectedTask: nextSelected,
    });
  }
}

export const panelStore = new PanelStore();

/** React hook reading the panel store. */
export function usePanelStore(): PanelState {
  return useSyncExternalStore(panelStore.subscribe, panelStore.getSnapshot);
}
