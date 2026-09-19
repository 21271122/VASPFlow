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
  directory_type?: 'VASP_TASK_DIRECTORY' | 'ORDINARY_DIRECTORY';
  task_type?: { code: string; label: string; requiredOutputs?: string[]; availableOutputIntents?: string[] };
  status_record?: TaskStatusRecord;
  input_check?: InputCheck;
  output_files?: OutputFile[];
}

export interface StatusEvidence {
  ruleId: string;
  file: string;
  severity: string;
  message: string;
  excerpt?: string;
}

export interface TaskStatusRecord {
  code: 'NO_OUTPUT_EVIDENCE' | 'TASK_COMPLETED' | 'ERROR_DETECTED' | 'RUNNING' | 'UNKNOWN';
  label: string;
  reason: string;
  evidence: StatusEvidence[];
  observedAt: string;
}

export interface InputCheck {
  code: 'NOT_REQUESTED' | 'NOT_CHECKED' | 'PASS' | 'WARN' | 'FAIL';
  label: string;
  profileId: string;
  profileVersion: string;
  checkedFiles: string[];
  uncheckedItems: string[];
  evidence: StatusEvidence[];
  observedAt: string;
}

/** 原始文件检查摘要；只用于解释输入检查结论，不是“可提交”判断。 */
export interface InputCheckRawResult {
  poscarPotcar: string;
  sd: string;
  incar: Record<string, unknown> | string;
  kpoints: string;
  warnings: string[];
  error: string;
}

export interface InputCheckResponse {
  input_check: InputCheck;
  raw_check: InputCheckRawResult;
}

export interface OutputFile {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface ProjectDirectory {
  rel_path: string;
  label: string;
}

export interface ScanResult {
  project_id: number;
  tasks: Task[];
  directories: ProjectDirectory[];
  failedDirectories?: Array<ProjectDirectory & { reason: string }>;
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
  totalSize: number;
  offset: number;
  length: number;
  content: string;
  hasBefore: boolean;
  hasAfter: boolean;
  truncated: boolean;
}

export interface ScanEvent {
  batchId: string;
  directory?: ProjectDirectory;
  task?: Task | null;
  reason?: string;
  project_id?: number;
  tasks?: Task[];
  directories?: ProjectDirectory[];
  failedDirectories?: Array<ProjectDirectory & { reason: string }>;
  error?: string;
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

/** Start the panel-only incremental scan. Closing the returned stream cancels it. */
export function scanProjectEvents(rootPath: string, handlers: {
  onStart: (event: ScanEvent) => void;
  onEvent: (type: string, event: ScanEvent) => void;
  onError: () => void;
}): () => void {
  const stream = new EventSource(`/plugins/dsh-vaspflow/scan-events?root_path=${encodeURIComponent(rootPath)}`);
  const parse = (type: string) => (message: MessageEvent) => {
    try {
      const event = JSON.parse(message.data) as ScanEvent;
      if (type === 'scan-start') handlers.onStart(event);
      else handlers.onEvent(type, event);
    } catch {
      // Ignore malformed partial events; the next scan can replace them.
    }
  };
  ['scan-start', 'directory-discovered', 'directory-scanned', 'directory-failed', 'scan-complete', 'scan-failed']
    .forEach((type) => stream.addEventListener(type, parse(type)));
  stream.onerror = () => handlers.onError();
  return () => stream.close();
}

export function openTaskByPath(rootPath: string, relPath: string): Promise<Task> {
  return request(`/plugins/dsh-vaspflow/task/open-by-path?root_path=${encodeURIComponent(rootPath)}&rel_path=${encodeURIComponent(relPath)}`, { method: 'POST' });
}

/** Run one explicit input-check profile against a task already opened by the panel. */
export function checkTaskInputs(taskId: number, profileId: string): Promise<InputCheckResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/input-check?profile_id=${encodeURIComponent(profileId)}`, { method: 'POST' });
}

export function fetchConvergence(taskId: number): Promise<ConvergenceResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/convergence`);
}

export function fetchTaskFiles(taskId: number): Promise<TaskFilesResponse> {
  return request(`/plugins/dsh-vaspflow/task/${taskId}/files`);
}

export function fetchFileContent(taskId: number, name: string, options: { offset?: number; length?: number } = {}): Promise<FileContentResponse> {
  const params = new URLSearchParams({ name });
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.length !== undefined) params.set('length', String(options.length));
  return request(`/plugins/dsh-vaspflow/task/${taskId}/file-content?${params.toString()}`);
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
