export type PaneRow = { kind: 'line'; index: number; text: string } | { kind: 'gap'; from: number; count: number };

/**
 * Collapse runs of unchanged lines so a compare shows what actually differs.
 * A short file, or one with no differences, renders whole: hiding two lines
 * would only add noise.
 */
export function collapseUnchanged(lines: string[] | undefined, changed: boolean[] | undefined, expanded: boolean): PaneRow[] {
  if (!lines) return [];
  const allLines = lines.map((text, index) => ({ kind: 'line' as const, index, text }));
  if (expanded || !changed?.some(Boolean)) return allLines;
  const MIN_RUN = 4;
  const rows: PaneRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (changed[index]) {
      rows.push({ kind: 'line', index, text: lines[index] });
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && !changed[end]) end += 1;
    const count = end - index;
    if (count >= MIN_RUN) {
      rows.push({ kind: 'gap', from: index, count });
      index = end;
      continue;
    }
    for (let cursor = index; cursor < end; cursor += 1) rows.push({ kind: 'line', index: cursor, text: lines[cursor] });
    index = end;
  }
  return rows;
}

/** Normalise line endings and omit the empty row after a final newline. */
export function toLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Compare the whole file, with bounded memory for large unrelated inputs. */
export function markDifferences(left: string[], right: string[]): { left: boolean[]; right: boolean[] } {
  const leftFlags = new Array<boolean>(left.length).fill(false);
  const rightFlags = new Array<boolean>(right.length).fill(false);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  leftFlags.fill(true, start, leftEnd);
  rightFlags.fill(true, start, rightEnd);
  const n = leftEnd - start;
  const m = rightEnd - start;
  // Conservatively mark the differing middle. A Set-based approximation loses
  // duplicate counts and reordered rows, and can falsely report identical files.
  if (!n || !m || n * m > 400_000) return { left: leftFlags, right: rightFlags };
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = left[start + i] === right[start + j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[start + i] === right[start + j]) {
      leftFlags[start + i++] = false;
      rightFlags[start + j++] = false;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
    else j += 1;
  }
  return { left: leftFlags, right: rightFlags };
}

