/**
 * dsh-vaspflow client: API layer (fetch → /plugins/dsh-vaspflow/*).
 */
export interface Task {
  id: number;
  label: string;
  rel_path: string;
  system: string;
  status: string;
  is_converged: boolean;
  n_ion_steps: number;
  final_energy: number | null;
  final_max_force: number | null;
  lattice_consts: number[] | null;
  incar_summary: Record<string, unknown>;
  error_message?: string;
  is_vasp_task?: boolean;
}

export interface ProjectDirectory {
  rel_path: string;
  label: string;
}

export interface ScanResult {
  project_id: number;
  tasks: Task[];
  directories: ProjectDirectory[];
  error?: string;
}

export interface ConvergenceResponse {
  ion_steps: number[];
  energies: number[];
  max_forces: number[];
  error?: string;
  _source?: string;
}

export interface TaskFileEntry {
  name: string;
  size: number;
  ext: string;
}

export interface TaskDirEntry {
  name: string;
}

export interface TaskFilesResponse {
  files: TaskFileEntry[];
  dirs: TaskDirEntry[];
}

export interface FileContentResponse {
  name: string;
  size: number;
  content: string;
  truncated: boolean;
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) detail = body.error;
    } catch {
      // keep HTTP status text
    }
    throw new Error(detail);
  }
  return response.json();
}

export function scanProject(rootPath: string): Promise<ScanResult> {
  return request(`/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(rootPath)}`, { method: 'POST' });
}

export function openTaskByPath(rootPath: string, relPath: string): Promise<Task> {
  return request(`/plugins/dsh-vaspflow/task/open-by-path?root_path=${encodeURIComponent(rootPath)}&rel_path=${encodeURIComponent(relPath)}`, { method: 'POST' });
}

export function fetchConvergence(taskId: number): Promise<ConvergenceResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/convergence`);
}

export function fetchTaskFiles(taskId: number): Promise<TaskFilesResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/files`);
}

export function fetchFileContent(taskId: number, name: string): Promise<FileContentResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/file-content?name=${encodeURIComponent(name)}`);
}

export function fetchStructureFiles(taskId: number): Promise<string[]> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/structure-files`).then((data) => data?.files || []);
}

export function fetchStructureScene(taskId: number, file: string): Promise<StructureScene> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/structure-scene?file=${encodeURIComponent(file)}`);
}

export interface StructureScene {
  version: number;
  cell: {
    vectors: number[][];
    lengths: number[];
    angles: number[];
  };
  atoms: SceneAtom[];
  bonds: SceneBond[];
  bond_families: SceneBondFamily[];
  summary: {
    formula: string;
    atom_count: number;
    space_group: string | null;
    space_group_number: number | null;
    crystal_system: string | null;
    bond_algorithm: string | null;
  };
  warnings: string[];
}

export interface SceneAtom {
  id: string;
  site_index: number;
  element: string;
  position: number[];
  fractional_position: number[];
  image_offset: number[];
  is_periodic_image: boolean;
}

export interface SceneBond {
  id: string;
  family_key: string;
  start_atom_index: number;
  end_atom_index: number;
  length: number;
}

export interface SceneBondFamily {
  key: string;
  elements: string[];
  min_length: number | null;
  max_length: number | null;
}

export interface ViewerStructure {
  lattice: number[][];
  species: string[];
  coords: number[][];
  frac_coords: number[][];
  num_atoms: number;
  bonds: SceneBond[];
  scene?: StructureScene;
}

export function structureSceneToViewerStructure(scene: StructureScene): ViewerStructure {
  return {
    lattice: scene.cell.vectors,
    species: scene.atoms.map((atom) => atom.element),
    coords: scene.atoms.map((atom) => atom.position),
    frac_coords: scene.atoms.map((atom) => atom.fractional_position),
    num_atoms: scene.summary?.atom_count ?? scene.atoms.length,
    bonds: scene.bonds.map((bond) => ({
      id: bond.id,
      family_key: bond.family_key,
      start_atom_index: bond.start_atom_index,
      end_atom_index: bond.end_atom_index,
      length: bond.length,
    })),
    scene,
  };
}
