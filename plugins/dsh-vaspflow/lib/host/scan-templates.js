/**
 * dsh-vaspflow host: template-directory scanner (B5).
 *
 * Walks a project tree and reports directories that look like usable VASP
 * input templates (contain INCAR), together with which input files each one
 * carries (INCAR/KPOINTS/POTCAR/submit-script name) and key INCAR parameters.
 * This is a REPORTING tool: locating/choosing templates stays a user decision;
 * the agent only lists candidates for confirmation.
 *
 * @module dsh-vaspflow/host/scan-templates
 */
import fs from 'node:fs';
import { resolve, relative } from 'node:path';

const KEY_PARAMS = ['IBRION', 'NSW', 'ISIF', 'ENCUT', 'ALGO', 'EDIFF', 'EDIFFG', 'ISPIN', 'ISMEAR', 'SIGMA', 'NFREE', 'POTIM'];
const SUBMIT_CANDIDATES = ['submit.sh', 'run.sh', 'job.sh'];
const SUBMIT_EXTS = ['.slurm', '.sbatch', '.pbs'];

/** Submit-script file name in a directory (report only, never auto-selected). */
function findSubmitName(dir) {
  for (const n of SUBMIT_CANDIDATES) {
    if (fs.existsSync(resolve(dir, n))) return n;
  }
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile()).map((e) => e.name);
    return names.find((n) => SUBMIT_EXTS.some((x) => n.toLowerCase().endsWith(x))) ?? null;
  } catch (error) {
    return null;
  }
}

/** Extract key INCAR parameters (semicolon-aware). */
export function incarParams(p) {
  const params = {};
  try {
    const text = fs.readFileSync(p, 'utf-8');
    for (const rawLine of text.split(/\r?\n/)) {
      for (const seg of rawLine.split(';')) {
        const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\S+)/.exec(seg.trim());
        if (m && KEY_PARAMS.includes(m[1])) params[m[1]] = m[2];
      }
    }
  } catch (error) { /* unreadable INCAR -> empty params */ }
  return params;
}

/** Walk rootPath (up to maxDepth) and list template-like directories. */
export function scanTemplates(rootPath, maxDepth = 3) {
  const rootAbs = resolve(rootPath);
  const templates = [];
  const stack = [{ dir: rootAbs, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    if (fs.existsSync(resolve(dir, 'INCAR'))) {
      const files = ['INCAR', 'KPOINTS', 'POTCAR'].filter((f) => fs.existsSync(resolve(dir, f)));
      const sub = findSubmitName(dir);
      if (sub) files.push(sub);
      templates.push({
        relPath: relative(rootAbs, dir) === '' ? '.' : relative(rootAbs, dir),
        dir,
        files,
        submit: sub ?? '',
        params: incarParams(resolve(dir, 'INCAR')),
        complete: files.includes('INCAR') && files.includes('KPOINTS') && files.includes('POTCAR') && sub !== null,
      });
    }
    for (const en of entries) {
      if (en.isDirectory() && !['node_modules', '.git'].includes(en.name)) {
        stack.push({ dir: resolve(dir, en.name), depth: depth + 1 });
      }
    }
  }
  templates.sort((a, b) => a.dir.localeCompare(b.dir));
  return { templates, count: templates.length };
}
