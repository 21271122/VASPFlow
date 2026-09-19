/**
 * dsh-vaspflow host: in-memory task store — Node port of backend/services/task_store.py.
 *
 * Input checks are retained in DSH's local data directory across restarts.
 * Projects are keyed by realpath+casefold root; task ids by (root_key, rel_key).
 * Input checks, however, are keyed by the task directory's canonical absolute
 * path, so the same directory retains its result when opened under a parent
 * project or as a nested project.
 *
 * @module dsh-vaspflow/host/task-store
 */
import { join, normalize, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync } from 'node:fs';

const INPUT_FILES = ['POSCAR', 'INCAR', 'KPOINTS', 'POTCAR'];

function defaultInputCheckCacheFile() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'vaspflow', 'input-check-cache.json');
}

function fileSignature(path, label) {
  try {
    const stat = statSync(path);
    return `${label}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${label}:missing`;
  }
}

function inputSignature(rootPath, relPath, task) {
  const dir = resolve(rootPath, relPath);
  const entries = INPUT_FILES.map((name) => fileSignature(join(dir, name), name));
  if (task?.task_type?.code === 'NEB') {
    try {
      for (const name of readdirSync(dir).filter((item) => /^\d{2}$/.test(item)).sort()) {
        entries.push(fileSignature(join(dir, name, 'POSCAR'), `${name}/POSCAR`));
      }
    } catch {
      // A later input check reports an unreadable NEB layout in user-facing terms.
    }
  }
  return entries.join('|');
}

export class TaskStore {
  constructor({ inputCheckCacheFile = defaultInputCheckCacheFile() } = {}) {
    this.projects = new Map(); // id -> {root_path, tasks, directories}
    this.tasks = new Map(); // id -> latest TaskRecord (plus root_path)
    this.projectIdsByRoot = new Map(); // root_key -> id
    this.taskIdsByPath = new Map(); // "root\0rel" -> id
    this.inputCheckSignatures = new Map(); // task id -> inputs used for its stored result
    this.inputCheckCacheFile = inputCheckCacheFile;
    this.persistedInputChecks = this.loadInputCheckCache(); // canonical task path -> { signature, inputCheck }
    this.legacyInputChecksByTaskPath = this.indexLegacyInputChecks();
    this.nextProjectId = 1;
    this.nextTaskId = 1;
    this.version = 0; // bumped on every mutation (reverse-linkage polling)
  }

  addProject(rootPath, tasksData, directories) {
    const rootKey = this.rootKey(rootPath);
    for (const task of tasksData) {
      this.addTask(rootPath, task);
    }
    let projectId = this.projectIdsByRoot.get(rootKey);
    if (projectId === undefined) {
      projectId = this.nextProjectId;
      this.nextProjectId += 1;
      this.projectIdsByRoot.set(rootKey, projectId);
    }
    this.projects.set(projectId, {
      root_path: rootPath,
      tasks: tasksData,
      directories,
    });
    this.version += 1;
    return projectId;
  }

  addTask(rootPath, taskData) {
    const rootKey = this.rootKey(rootPath);
    const relKey = this.relKey(taskData.rel_path);
    const pathKey = rootKey + '\u0000' + relKey;
    let taskId = this.taskIdsByPath.get(pathKey);
    if (taskId === undefined) {
      taskId = this.nextTaskId;
      this.nextTaskId += 1;
      this.taskIdsByPath.set(pathKey, taskId);
    }
    const previous = this.tasks.get(taskId);
    const nextInputSignature = inputSignature(rootPath, taskData.rel_path, taskData);
    const taskPathKey = this.taskPathKey(rootPath, taskData.rel_path);
    const cachedEntry = this.cachedInputCheck(taskPathKey);
    const cachedCheck = cachedEntry?.value;
    // Scans create NOT_REQUESTED by default. Retain an explicit check only
    // while the checked input files are unchanged, including after DSH restarts.
    if (previous?.input_check?.code && previous.input_check.code !== 'NOT_REQUESTED'
      && taskData.input_check?.code === 'NOT_REQUESTED'
      && this.inputCheckSignatures.get(taskId) === nextInputSignature) {
      taskData.input_check = previous.input_check;
    } else if (cachedCheck?.signature === nextInputSignature
      && taskData.input_check?.code === 'NOT_REQUESTED') {
      taskData.input_check = cachedCheck.inputCheck;
      this.inputCheckSignatures.set(taskId, nextInputSignature);
      // Cache entries written before canonical task identities used
      // `project root\0relative path`. Upgrade them when first encountered.
      if (cachedEntry.key !== taskPathKey) {
        this.persistedInputChecks.delete(cachedEntry.key);
        this.legacyInputChecksByTaskPath.delete(taskPathKey);
        this.persistedInputChecks.set(taskPathKey, cachedCheck);
        this.saveInputCheckCache();
      }
    }
    if (this.inputCheckSignatures.get(taskId) !== nextInputSignature) this.inputCheckSignatures.delete(taskId);
    if (cachedCheck && cachedCheck.signature !== nextInputSignature) {
      this.persistedInputChecks.delete(cachedEntry.key);
      if (cachedEntry.key !== taskPathKey) this.legacyInputChecksByTaskPath.delete(taskPathKey);
      this.saveInputCheckCache();
    }
    taskData.id = taskId;
    this.tasks.set(taskId, { ...taskData, root_path: rootPath });
    this.version += 1;
    return taskId;
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /** Attach the independent input-check dimension to one known task. */
  setInputCheck(rootPath, relPath, inputCheck) {
    const scopedPathKey = this.rootKey(rootPath) + '\u0000' + this.relKey(relPath);
    const taskId = this.taskIdsByPath.get(scopedPathKey);
    if (taskId === undefined) return false;
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const taskPathKey = this.taskPathKey(rootPath, relPath);
    const signature = inputSignature(rootPath, relPath, task);
    // One physical VASP directory can be represented by several open projects:
    // e.g. `client_verify/8-_NH2OH` under ABN+LCBN and `8-_NH2OH` under
    // client_verify. Keep all of those views synchronized.
    for (const [candidateId, candidate] of this.tasks) {
      if (this.taskPathKey(candidate.root_path, candidate.rel_path) !== taskPathKey) continue;
      candidate.input_check = inputCheck;
      this.inputCheckSignatures.set(candidateId, inputSignature(candidate.root_path, candidate.rel_path, candidate));
    }
    for (const project of this.projects.values()) {
      for (const projectTask of project.tasks) {
        if (this.taskPathKey(project.root_path, projectTask.rel_path) === taskPathKey) projectTask.input_check = inputCheck;
      }
    }
    this.persistedInputChecks.set(taskPathKey, {
      signature,
      inputCheck,
    });
    this.saveInputCheckCache();
    this.version += 1;
    return true;
  }

  loadInputCheckCache() {
    try {
      const payload = JSON.parse(readFileSync(this.inputCheckCacheFile, 'utf8'));
      if (payload?.version !== 1 || !payload.entries || typeof payload.entries !== 'object') return new Map();
      return new Map(Object.entries(payload.entries).filter(([, value]) => (
        value && typeof value.signature === 'string' && value.inputCheck && typeof value.inputCheck === 'object'
      )));
    } catch {
      return new Map();
    }
  }

  cachedInputCheck(taskPathKey) {
    const direct = this.persistedInputChecks.get(taskPathKey);
    if (direct) return { key: taskPathKey, value: direct };
    return this.legacyInputChecksByTaskPath.get(taskPathKey) ?? null;
  }

  indexLegacyInputChecks() {
    const indexed = new Map();
    // Compatibility with the cache format used before task identity was made
    // independent from the project root. Windows paths cannot contain NUL.
    for (const [key, value] of this.persistedInputChecks) {
      const separator = key.indexOf('\u0000');
      if (separator < 0) continue;
      const rootPath = key.slice(0, separator);
      const relPath = key.slice(separator + 1);
      const taskPathKey = this.taskPathKey(rootPath, relPath);
      if (!indexed.has(taskPathKey)) indexed.set(taskPathKey, { key, value });
    }
    return indexed;
  }

  saveInputCheckCache() {
    try {
      mkdirSync(resolve(this.inputCheckCacheFile, '..'), { recursive: true });
      writeFileSync(this.inputCheckCacheFile, JSON.stringify({
        version: 1,
        entries: Object.fromEntries(this.persistedInputChecks),
      }), 'utf8');
    } catch {
      // A local cache must never block scanning or checking inputs.
    }
  }

  relPathFromAbsolute(rootPath, absolutePath) {
    return relative(resolve(rootPath), resolve(absolutePath)) || '.';
  }

  rootKey(rootPath) {
    return resolve(realpathSync(rootPath)).toLowerCase();
  }

  relKey(relPath) {
    return normalize(relPath).toLowerCase();
  }

  taskPathKey(rootPath, relPath) {
    const taskPath = resolve(rootPath, relPath);
    try {
      return normalize(realpathSync(taskPath)).toLowerCase();
    } catch {
      return normalize(taskPath).toLowerCase();
    }
  }
}
