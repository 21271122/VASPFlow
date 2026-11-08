/**
 * dsh-vaspflow client: build inheritance model.
 *
 * The input builder resolves every file of a task from either the task itself
 * (explicit source) or the shared template directory. That provenance is the
 * thing users need to read: which files are inherited, which are overridden,
 * and which tasks share a source. This module derives that model without
 * touching React so it can be checked on its own.
 */

export type BuildOrigin = 'inherit' | 'explicit' | 'pending' | 'missing';

export const BUILD_SLOTS = [
  { key: 'POSCAR', short: 'poscar', field: 'poscarSrc', label: 'POSCAR', fromTemplate: false },
  { key: 'INCAR', short: 'incar', field: 'incarSrc', label: 'INCAR', fromTemplate: true },
  { key: 'KPOINTS', short: 'kpoints', field: 'kpointsSrc', label: 'KPOINTS', fromTemplate: true },
  { key: 'POTCAR', short: 'potcar', field: 'potcarSrc', label: 'POTCAR', fromTemplate: true },
  { key: 'submit', short: 'submit', field: 'submitSrc', label: '提交脚本', fromTemplate: false },
] as const;

export type BuildSlot = (typeof BUILD_SLOTS)[number];

export type BuildBatch = { tasks: any[]; results: any[] } | undefined;

export type BuildSlotRow = {
  key: string;
  label: string;
  fileName: string;
  fromTemplate: boolean;
  origin: BuildOrigin;
  /** Absolute source path when the host resolved one. */
  path?: string;
  /** Project-root-relative path for display. */
  rel: string;
  /** How many tasks in the batch resolve this slot to the same file. */
  shared: number;
};

export type BuildBatchSummary = {
  total: number;
  templates: Array<{ name: string; rel: string; count: number }>;
  untemplated: number;
  slots: Array<{ key: string; label: string; fromTemplate: boolean; inherit: number; explicit: number; missing: number }>;
};

export function toPosix(value: string): string {
  return value.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
}

export function basenameOf(value?: string): string {
  if (!value) return '';
  const parts = toPosix(value).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function absoluteTaskPath(rootPath: string, relPath: string): string {
  const root = rootPath.replace(/[\\/]+$/, '');
  const relative = (relPath || '.').replace(/^[\\/]+/, '');
  return !relative || relative === '.' ? root : `${root}\\${relative.replace(/[\\/]+/g, '\\')}`;
}

/** Project-root-relative path; falls back to the absolute path when outside the root. */
export function projectRelative(projectRoot: string, absolute?: string): string {
  if (!absolute) return '';
  const root = toPosix(projectRoot);
  const target = toPosix(absolute);
  if (!root) return target;
  if (target.toLowerCase() === root.toLowerCase()) return '.';
  if (target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return target.slice(root.length + 1);
  return target;
}

/** Keep the first segment (where the source lives) and the last two (what it is). */
export function shortenPath(relPath: string): string {
  const parts = relPath.split('/').filter((part) => part && part !== '.');
  if (parts.length <= 3) return parts.join('/') || relPath;
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`;
}

/** True when the task chose this source itself instead of accepting the template. */
export function slotExplicit(task: any, slot: BuildSlot): boolean {
  const alias = task?.sources?.[slot.short];
  return Boolean(alias || task?.[slot.field]);
}

/** Host-resolved absolute source for a slot; submit is matched by its destination basename. */
export function slotResolvedPath(task: any, result: any, slot: BuildSlot): string | undefined {
  const sources: Record<string, string> = result?.sources ?? {};
  if (slot.key !== 'submit') return sources[slot.key] || undefined;
  const name = basenameOf(task?.submitSrc || task?.sources?.submit);
  if (name && sources[name]) return sources[name];
  return undefined;
}

/** Pre-preview fallback: the task's own declared source, still unverified. */
export function slotDeclaredPath(task: any, slot: BuildSlot): string | undefined {
  const alias = task?.sources?.[slot.short];
  const value = task?.[slot.field] || alias;
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Where a resolved file comes from. Only two real answers:
 *   模板  the task did not name a file, so the template supplied it
 *   指定  the task named a file (POSCAR and the submit script always are)
 * Whether that named file happens to differ from a template copy is a
 * difference to show, not a third category.
 */
export function slotOrigin(task: any, slot: BuildSlot, resolved?: string): BuildOrigin {
  if (!resolved) return slotDeclaredPath(task, slot) ? 'pending' : 'missing';
  return slotExplicit(task, slot) ? 'explicit' : 'inherit';
}

export function templateKeyOf(task: any): string {
  const template = typeof task?.template === 'string' ? task.template.trim() : '';
  return template || '';
}

export function describeSlots(task: any, result: any, projectRoot: string, share: Map<string, number>): BuildSlotRow[] {
  const standard = BUILD_SLOTS.map((slot) => {
    const resolved = slotResolvedPath(task, result, slot);
    const origin = slotOrigin(task, slot, resolved);
    const rel = resolved
      ? shortenPath(projectRelative(projectRoot, resolved))
      : origin === 'pending'
        ? shortenPath(toPosix(slotDeclaredPath(task, slot) || ''))
        : '';
    return {
      key: slot.key,
      label: slot.label,
      fileName: slot.key === 'submit' ? basenameOf(task?.submitSrc || task?.sources?.submit) || 'submit.sh' : slot.key,
      fromTemplate: slot.fromTemplate,
      origin,
      path: resolved,
      rel,
      shared: resolved ? share.get(`${slot.key}|${resolved.toLowerCase()}`) ?? 0 : 0,
    };
  });
  const reserved = new Set(standard.map((row) => row.fileName));
  const extras = new Map<string, any>();
  for (const item of task?.extraFiles ?? []) {
    const name = item.dest || (item.src ? basenameOf(item.src) : item.fromTemplate);
    if (typeof name === 'string' && name && !reserved.has(name)) extras.set(name, item);
  }
  for (const name of Object.keys(result?.sources ?? {})) {
    if (!reserved.has(name) && !extras.has(name)) extras.set(name, {});
  }
  const extraRows: BuildSlotRow[] = [...extras].map(([name, item]) => {
    const path = typeof result?.sources?.[name] === 'string' ? result.sources[name] : undefined;
    const fromTemplate = !item.src && Boolean(item.fromTemplate);
    const key = `extra:${name}`;
    return {
      key, label: name, fileName: name, fromTemplate, path,
      origin: path ? (fromTemplate ? 'inherit' : 'explicit') : result ? 'missing' : 'pending',
      rel: path ? shortenPath(projectRelative(projectRoot, path)) : item.src || item.fromTemplate || '',
      shared: path ? share.get(`${key}|${path.toLowerCase()}`) ?? 0 : 0,
    };
  });
  return [...standard, ...extraRows];
}

/** Count how many tasks in the batch point at the same resolved file per slot. */
export function buildShareIndex(batch: BuildBatch, projectRoot: string): Map<string, number> {
  const share = new Map<string, number>();
  (batch?.tasks ?? []).forEach((entry, index) => {
    const result = batch?.results?.[index];
    for (const slot of describeSlots(entry, result, projectRoot, new Map())) {
      const resolved = slot.path;
      if (!resolved) continue;
      const key = `${slot.key}|${resolved.toLowerCase()}`;
      share.set(key, (share.get(key) ?? 0) + 1);
    }
  });
  return share;
}

/** Task directories that resolve each slot to the same file, for the share drill-down. */
export function buildSourceTasks(batch: BuildBatch): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  (batch?.tasks ?? []).forEach((entry, index) => {
    const result = batch?.results?.[index];
    const dir = typeof entry?.dir === 'string' && entry.dir ? entry.dir.replace(/[\\/]+/g, '/') : '(未命名任务)';
    for (const slot of describeSlots(entry, result, '', new Map())) {
      const resolved = slot.path;
      if (!resolved) continue;
      const key = `${slot.key}|${resolved.toLowerCase()}`;
      owners.set(key, [...(owners.get(key) ?? []), dir]);
    }
  });
  return owners;
}

export type BatchSourceGroup = {
  /** Absolute path of the file every task in this group copies from. */
  path: string;
  /** Project-relative path, shortened for display. */
  rel: string;
  /** Indices into batch.tasks that resolve to this file. */
  tasks: number[];
};

export type BatchFileGroup = {
  /** Destination names may differ between tasks, e.g. submit.sh and lqf.sh. */
  fileNames: Record<number, string>;
  key: string;
  label: string;
  fromTemplate: boolean;
  sources: BatchSourceGroup[];
  /** Tasks whose slot could not be resolved at all. */
  missing: number[];
};

/**
 * Group a batch by input file, then by the file every task in that group reads
 * from. This is what the batch card renders as source-node → task-node edges.
 */
export function groupBatchBySource(batch: BuildBatch, projectRoot: string): BatchFileGroup[] {
  const rows = (batch?.tasks ?? []).map((task, index) => describeSlots(task, batch?.results?.[index], projectRoot, new Map()));
  const kinds = new Map<string, BuildSlotRow>();
  rows.forEach((taskRows) => taskRows.forEach((row) => { if (!kinds.has(row.key)) kinds.set(row.key, row); }));
  return [...kinds.values()].map((kind) => {
    const byPath = new Map<string, BatchSourceGroup>();
    const missing: number[] = [];
    const fileNames: Record<number, string> = {};
    rows.forEach((taskRows, index) => {
      const row = taskRows.find((candidate) => candidate.key === kind.key);
      if (!row) return; // An extra file is optional for other tasks.
      fileNames[index] = row.fileName;
      const resolved = row.path;
      if (!resolved) { missing.push(index); return; }
      const key = resolved.toLowerCase();
      const existing = byPath.get(key);
      if (existing) existing.tasks.push(index);
      else byPath.set(key, { path: resolved, rel: shortenPath(projectRelative(projectRoot, resolved)), tasks: [index] });
    });
    const sources = [...byPath.values()].sort((a, b) => b.tasks.length - a.tasks.length);
    return { key: kind.key, label: kind.label, fromTemplate: kind.fromTemplate, sources, missing, fileNames };
  }).filter((group) => group.sources.length > 0 || group.missing.length > 0);
}

export type DirKind = 'plain' | 'template' | 'task' | 'both';

export type DirNode = {
  name: string;
  /** Project-root-relative path of this directory. */
  path: string;
  kind: DirKind;
  taskCount: number;
  children: DirNode[];
};

/**
 * Directory picture for one file group: the directory each template lives in
 * and the directory of every task, laid out under their deepest shared
 * ancestor. Directories are plain nodes; the ones that hold a template or a
 * task are marked so the UI can colour them.
 */
export function buildRelativeTree(sources: string[], taskDirs: string[], projectRoot: string): DirNode | null {
  const split = (value: string) => toPosix(value).split('/').filter(Boolean);
  const toRel = (value: string) => split(projectRelative(projectRoot, value));
  const templatePaths = sources.map(toRel).filter((parts) => parts.length > 0);
  const taskPaths = taskDirs.map(toRel).filter((parts) => parts.length > 0);
  const all = [...templatePaths, ...taskPaths];
  if (all.length === 0) return null;

  let common = all[0].slice();
  for (const parts of all.slice(1)) {
    let index = 0;
    while (index < common.length && index < parts.length && common[index].toLowerCase() === parts[index].toLowerCase()) index += 1;
    common = common.slice(0, index);
  }

  const root: DirNode = { name: common[common.length - 1] ?? '.', path: common.join('/'), kind: 'plain', taskCount: 0, children: [] };
  const ensure = (parts: string[]): DirNode => {
    let node = root;
    for (let index = common.length; index < parts.length; index += 1) {
      const name = parts[index];
      let child = node.children.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (!child) {
        child = { name, path: [...parts.slice(0, index + 1)].join('/'), kind: 'plain', taskCount: 0, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  };

  for (const parts of templatePaths) {
    const node = ensure(parts);
    if (node.kind !== 'task') node.kind = 'template';
  }
  for (const parts of taskPaths) {
    const node = ensure(parts);
    node.taskCount += 1;
    node.kind = node.kind === 'template' ? 'both' : 'task';
  }

  const sort = (node: DirNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function summarizeBatch(batch: BuildBatch, projectRoot: string): BuildBatchSummary | null {
  const tasks = batch?.tasks ?? [];
  if (tasks.length < 2) return null;
  const templates = new Map<string, { name: string; rel: string; count: number }>();
  const slots: BuildBatchSummary['slots'] = BUILD_SLOTS.map((slot) => ({ key: slot.key as string, label: slot.label, fromTemplate: slot.fromTemplate, inherit: 0, explicit: 0, missing: 0 }));
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const template = templateKeyOf(task);
    if (template) {
      const rel = projectRelative(projectRoot, absoluteTaskPath(projectRoot, template));
      const entry = templates.get(template.toLowerCase()) ?? { name: basenameOf(template) || template, rel, count: 0 };
      entry.count += 1;
      templates.set(template.toLowerCase(), entry);
    }
    const rows = describeSlots(task, batch?.results?.[index], projectRoot, new Map());
    rows.forEach((row) => {
      let slot = slots.find((entry) => entry.key === row.key);
      if (!slot) {
        slot = { key: row.key, label: row.label, fromTemplate: row.fromTemplate, inherit: 0, explicit: 0, missing: 0 };
        slots.push(slot);
      }
      if (row.origin === 'explicit') slot.explicit += 1;
      else if (row.origin === 'inherit') slot.inherit += 1;
      else if (row.origin === 'missing') slot.missing += 1;
      else slot.explicit += 1;
    });
  }
  return {
    total: tasks.length,
    templates: [...templates.values()].sort((a, b) => b.count - a.count),
    untemplated: tasks.filter((task) => !templateKeyOf(task)).length,
    slots,
  };
}

export function originLabel(origin: BuildOrigin): string {
  if (origin === 'inherit') return '模板';
  if (origin === 'explicit') return '指定';
  if (origin === 'pending') return '待预览';
  return '缺失';
}
