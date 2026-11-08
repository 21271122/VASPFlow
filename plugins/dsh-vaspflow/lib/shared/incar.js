/** Pure INCAR overrides shared by the host writer and browser fallback. */
/** Escape a regex metacharacter outside of $ and braces (INCAR tags never
 * contain them); avoids the $ { sequence entirely. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^()|[\]\\]/g, '\\$&');
}

/**
 * INCAR tag regexp, semicolon-aware. VASP allows multiple tag = value per
 * line separated by ';' (e.g. "EDIFF = 1E-5; EDIFFG = -0.02"); '#' and '!'
 * both start a trailing comment.
 */
const INCAR_TAG_RE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*(?:[#!].*)?$/;

/** Collect every declared tag (semicolon-aware). */
function collectIncarTags(text) {
  const tags = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    for (const segment of rawLine.split(';')) {
      const m = INCAR_TAG_RE.exec(segment);
      if (m) tags.add(m[1]);
    }
  }
  return tags;
}

/**
 * Replace existing tags; ADD missing ones. Semicolon-aware: only the segment
 * owning the tag is replaced, sibling tags on the same line stay intact.
 */
export function applyIncarOverrides(incarText, overrides) {
  const entries = Object.entries(overrides ?? {});
  if (entries.length === 0) return incarText;
  const lines = incarText.split(/\r?\n/).map((line) => {
    const segments = line.split(';');
    let touched = false;
    for (let i = 0; i < segments.length; i += 1) {
      for (const [key, val] of entries) {
        const pattern = new RegExp('^\\s*' + escapeRegExp(key) + '\\s*=\\s*[^\\r\\n]*');
        if (pattern.test(segments[i])) {
          segments[i] = segments[i].replace(pattern, () => key + ' = ' + val);
          touched = true;
        }
      }
    }
    return touched ? segments.join(';') : line;
  });
  let out = lines.join('\n');
  // ADD missing tags (absent anywhere, including inside ';' segments)
  const existing = collectIncarTags(out);
  for (const [key, val] of entries) {
    if (!existing.has(key)) out += '\n' + key + ' = ' + val + '\n';
  }
  return out;
}

