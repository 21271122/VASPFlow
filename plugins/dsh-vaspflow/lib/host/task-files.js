/**
 * dsh-vaspflow host: task file services — Node port of backend/services/task_files.py.
 *
 * @module dsh-vaspflow/host/task-files
 */
import { readdirSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STRUCTURE_FILE_PRIORITY = { POSCAR: 0, CONTCAR: 1 };
const DEFAULT_PREVIEW_CHUNK_SIZE = 256 * 1024;
const MAX_PREVIEW_CHUNK_SIZE = 512 * 1024;

export function taskDir(taskInfo) {
  return join(taskInfo.root_path, taskInfo.rel_path);
}

/** Case-insensitive file resolution inside the task directory. */
export function resolveTaskFile(taskInfo, fileName) {
  const directory = taskDir(taskInfo);
  const filePath = join(directory, fileName);
  if (isFile(filePath)) return filePath;

  if (!isDir(directory)) return null;

  for (const candidate of readdirSync(directory, { withFileTypes: true })) {
    if (!candidate.isFile()) continue;
    if (candidate.name.toUpperCase() === fileName.toUpperCase()) {
      const candidatePath = join(directory, candidate.name);
      if (isFile(candidatePath)) return candidatePath;
    }
  }
  return null;
}

/** List files and dirs: {files: [{name, size, ext}], dirs: [{name}]}. */
export function listFilesAndDirs(directory) {
  const files = [];
  const dirs = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      files.push({ name: entry.name, size: statSync(join(directory, entry.name)).size, ext });
    } else if (entry.isDirectory()) {
      dirs.push({ name: entry.name });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { files, dirs };
}

/** Structure files (POSCAR / CONTCAR / *.vasp), priority-ordered. */
export function listStructureFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    if (!isFile(fullPath)) continue;
    const upper = name.toUpperCase();
    if (upper === 'POSCAR' || upper === 'CONTCAR' || upper.endsWith('.VASP')) {
      files.push(name);
    }
  }
  files.sort((a, b) => {
    const pa = STRUCTURE_FILE_PRIORITY[a.toUpperCase()] ?? 2;
    const pb = STRUCTURE_FILE_PRIORITY[b.toUpperCase()] ?? 2;
    return pa !== pb ? pa - pb : a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return files;
}

/**
 * Text preview with chunk offsets + path-traversal guard. No request reads
 * more than MAX_PREVIEW_CHUNK_SIZE; omitted offset retains the familiar
 * "show the end of a log first" behaviour for large files.
 */
export function readTextPreview(taskInfo, fileName, options = {}) {
  const directory = resolve(taskDir(taskInfo));
  const filePath = resolve(join(directory, fileName));
  if (!isWithin(directory, filePath)) {
    const err = new Error('Path traversal detected');
    err.statusCode = 403;
    throw err;
  }
  if (!isFile(filePath)) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  const fileSize = statSync(filePath).size;
  const requestedLength = boundedInteger(options.length, DEFAULT_PREVIEW_CHUNK_SIZE, 1, MAX_PREVIEW_CHUNK_SIZE);
  const defaultOffset = fileSize > requestedLength ? fileSize - requestedLength : 0;
  const offset = boundedInteger(options.offset, defaultOffset, 0, fileSize);
  const length = Math.min(requestedLength, Math.max(0, fileSize - offset));
  const content = readChunk(filePath, offset, length);

  return {
    name: fileName,
    size: fileSize,
    totalSize: fileSize,
    offset,
    length,
    content,
    hasBefore: offset > 0,
    hasAfter: offset + length < fileSize,
    truncated: offset > 0 || offset + length < fileSize,
  };
}

function isWithin(directory, filePath) {
  const dir = realpathSync(directory).toLowerCase();
  const file = realpathSync(filePath).toLowerCase();
  return file === dir || file.startsWith(dir + '\\') || file.startsWith(dir + '/');
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readChunk(p, offset, length) {
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, offset);
    return buf.toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
