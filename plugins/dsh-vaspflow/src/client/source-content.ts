import { fetchFileContent, openTaskByPath } from './api';
import { projectRelative, toPosix } from './inheritance';
import { toLines } from './file-compare';
import { applyIncarOverrides } from '../../lib/shared/incar.js';

export type FileState = { text: string; lines: string[]; error?: string; truncated?: boolean };
export type Compared = { source: string[]; written?: string[]; error?: string; writeError?: string; notice?: string; partial?: boolean };

const SOURCE_PREVIEW_BYTES = 64 * 1024;
const SOURCE_PREVIEW_LINES = 400;
const binaryMessage = '二进制文件不支持文本预览，构建时仍按原文件完整复制';
const isBinary = (text: string) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text.slice(0, 8192));

function textComparison(source: string, written: string): Compared {
  if (isBinary(source) || isBinary(written)) return { source: [], error: binaryMessage };
  return { source: toLines(source), written: toLines(written) };
}

type ComparisonRequest = {
  projectRoot: string;
  sourcePath: string;
  fileName: string;
  files?: Record<string, { source?: string; written?: string }>;
  planId?: string;
  taskIndex?: number;
  incarOverrides?: Record<string, unknown>;
  rewritten?: boolean;
  variant?: 'both' | 'source' | 'written';
};

/** Prefer plan snapshots; never pass a POSCAR source off as its rewritten result. */
export async function loadSourceComparison(request: ComparisonRequest): Promise<Compared> {
  const { projectRoot, sourcePath, fileName, files, planId, taskIndex, incarOverrides, rewritten, variant = 'both' } = request;
  const baked = files?.[fileName];
  if (typeof baked?.source === 'string' && typeof baked.written === 'string') {
    return textComparison(baked.source, baked.written);
  }
  let hostStale = false;
  if (variant !== 'source' && planId && taskIndex !== undefined) {
    try {
      const url = `/plugins/dsh-vaspflow/build-inputs/file?planId=${encodeURIComponent(planId)}`
        + `&taskIndex=${taskIndex}&name=${encodeURIComponent(fileName)}`;
      const response = await fetch(url);
      hostStale = response.status === 404 || response.status === 409;
      if (response.ok) {
        const payload = await response.json() as { source?: string; written?: string };
        if (typeof payload.source === 'string' && typeof payload.written === 'string') {
          return textComparison(payload.source, payload.written);
        }
      }
    } catch { /* fall back to reading the source */ }
  }
  const state = await readProjectFile(projectRoot, sourcePath);
  if (state.error) return { source: [], error: state.error };
  if (state.truncated && !rewritten && !Object.keys(incarOverrides ?? {}).length) {
    const lines = state.lines.slice(0, SOURCE_PREVIEW_LINES);
    return { source: lines, written: lines, partial: true, notice: '仅显示文件开头的部分内容；构建时仍完整复制，未对全文件进行比较' };
  }
  if (state.truncated || (rewritten && variant !== 'source')) {
    return { source: state.lines.slice(0, SOURCE_PREVIEW_LINES), writeError: state.truncated
      ? '来源内容未完整读取，无法比较写入结果'
      : '未取得宿主写入内容，不能以来源代替结果' };
  }
  return {
    source: state.lines,
    written: Object.keys(incarOverrides ?? {}).length ? toLines(applyIncarOverrides(state.text, incarOverrides)) : state.lines,
    notice: hostStale ? '构建计划不可用，此处按当前来源预览' : undefined,
  };
}

const pending = new Map<string, Promise<FileState>>();

/** Deduplicate concurrent reads, but re-read reopened files and retry failures. */
export async function readProjectFile(projectRoot: string, absolutePath: string): Promise<FileState> {
  const key = `${projectRoot}\0${absolutePath}`;
  const running = pending.get(key);
  if (running) return running;
  const job = (async (): Promise<FileState> => {
    try {
      const rel = projectRelative(projectRoot, absolutePath);
      const parts = toPosix(rel).split('/').filter(Boolean);
      const name = parts.at(-1) ?? '';
      if (!name) throw new Error('无法解析文件名');
      const dir = parts.slice(0, -1).join('/') || '.';
      const task = await openTaskByPath(projectRoot, dir);
      const response = await fetchFileContent(task.id, name, { offset: 0, length: SOURCE_PREVIEW_BYTES });
      const text = response.content ?? '';
      if (isBinary(text)) return { text: '', lines: [], error: binaryMessage };
      const value: FileState = { text, lines: toLines(text), truncated: !!response.hasAfter };
      return value;
    } catch (error) {
      const value: FileState = { text: '', lines: [], error: error instanceof Error ? error.message : String(error) };
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

