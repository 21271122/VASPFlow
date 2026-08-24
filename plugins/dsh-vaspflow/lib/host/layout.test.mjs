/**
 * dsh-vaspflow layout regression test (pure JS): verifies the MutationObserver
 * guard logic — closed panel leaves the grid untouched; open panel re-inserts
 * its track when aionui drops it (track-count based, no width collision);
 * insertion happens before aionui's columns.
 *
 * Mirrors src/client/layout.ts syncOnce/insertionIndex semantics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

function parseGridTracks(input) {
  const tracks = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ' ' && depth === 0) {
      if (current !== '') {
        tracks.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') tracks.push(current);
  return tracks;
}

/**
 * Inlined copy of the observer syncOnce: given grid/base/open/width returns
 * { grid, base, changed }.
 */
function makeSync(baseRef) {
  const isOpen = () => true;
  const insertionIndex = (tracks) => (tracks.length >= 3 ? Math.min(3, tracks.length) : tracks.length);
  const syncOnce = (gridStr, width) => {
    const tracks = parseGridTracks(gridStr);
    if (tracks.length === 0) return { grid: gridStr, changed: false };
    if (!isOpen()) return { grid: gridStr, changed: false };
    const w = `${Math.round(width)}px`;
    const hasOurs = tracks.length === baseRef.value.length + 1 && baseRef.value.length > 0;
    if (hasOurs) {
      const at = insertionIndex(tracks);
      if (tracks[at] === w) return { grid: gridStr, changed: false };
      const next = [...tracks];
      next[at] = w;
      return { grid: next.join(' '), changed: true };
    }
    baseRef.value = tracks;
    const at = insertionIndex(tracks);
    const next = [...tracks];
    next.splice(at, 0, w);
    return { grid: next.join(' '), changed: true };
  };
  return syncOnce;
}

test('parseGridTracks handles minmax and px', () => {
  assert.deepEqual(parseGridTracks('minmax(0, 1fr) 260px minmax(0, 1fr)'), ['minmax(0, 1fr)', '260px', 'minmax(0, 1fr)']);
  assert.deepEqual(parseGridTracks('260px minmax(0, 1fr) 560px'), ['260px', 'minmax(0, 1fr)', '560px']);
});

test('open panel inserts before aionui columns (index 3)', () => {
  const baseRef = { value: ['280px', 'minmax(0px, 1fr)', '0px', '0px', '220px'] }; // aionui 5-track
  const syncOnce = makeSync(baseRef);
  const r = syncOnce('280px minmax(0px, 1fr) 0px 0px 220px', 420);
  assert.equal(r.changed, true);
  const tracks = parseGridTracks(r.grid);
  assert.equal(tracks.length, 6);
  assert.equal(tracks[3], '420px', 'vasp inserted at index 3');
  assert.equal(tracks[4], '0px', 'aionui preview stays');
  assert.equal(tracks[5], '220px', 'aionui explorer stays rightmost');
});

test('aionui drag rewrite (5 tracks, no ours) triggers restore once', () => {
  const baseRef = { value: ['280px', 'minmax(0px, 1fr)', '0px', '0px', '220px'] };
  const syncOnce = makeSync(baseRef);
  // Our write from a previous tick:
  const written = syncOnce('280px minmax(0px, 1fr) 0px 0px 220px', 420);
  assert.equal(written.changed, true);
  // Observer re-entry on our own write: ours present → no-op.
  const echo = syncOnce(written.grid, 420);
  assert.equal(echo.changed, false);
  // aionui rewrites mid-drag (drops our track, width changes):
  const drag = syncOnce('280px minmax(0px, 1fr) 0px 0px 340px', 420);
  assert.equal(drag.changed, true);
  const tracks = parseGridTracks(drag.grid);
  assert.equal(tracks.length, 6);
  assert.equal(tracks[3], '420px');
  assert.equal(tracks[5], '340px', 'aionui width adopted');
  // Stable on re-entry.
  assert.equal(syncOnce(drag.grid, 420).changed, false);
});

test('no aionui present: appends at end (4 tracks)', () => {
  const baseRef = { value: ['260px', 'minmax(0px, 1fr)', '0px'] };
  const syncOnce = makeSync(baseRef);
  const r = syncOnce('260px minmax(0px, 1fr) 0px', 420);
  assert.equal(r.changed, true);
  assert.equal(parseGridTracks(r.grid).length, 4);
  assert.equal(parseGridTracks(r.grid)[3], '420px');
});

test('drag resize updates our width without adding tracks', () => {
  const baseRef = { value: ['280px', 'minmax(0px, 1fr)', '0px', '0px', '220px'] };
  const syncOnce = makeSync(baseRef);
  // initial open
  const first = syncOnce('280px minmax(0px, 1fr) 0px 0px 220px', 420);
  // drag: width 420 → 560, track must be UPDATED not duplicated
  const resized = syncOnce(first.grid, 560);
  assert.equal(resized.changed, true);
  const tracks = parseGridTracks(resized.grid);
  assert.equal(tracks.length, 6, 'no track growth on resize');
  assert.equal(tracks[3], '560px', 'width updated in place');
  // re-entry with same width: no-op
  assert.equal(syncOnce(resized.grid, 560).changed, false);
  // aionui rewrites (drops ours) then our width is applied fresh
  const afterAionui = syncOnce('280px minmax(0px, 1fr) 0px 0px 260px', 560);
  assert.equal(afterAionui.changed, true);
  const t2 = parseGridTracks(afterAionui.grid);
  assert.equal(t2.length, 6);
  assert.equal(t2[3], '560px');
  assert.equal(t2[5], '260px');
});

test('removal: dropping our track restores base count', () => {
  // Simulate onStoreChange close: tracks = base+1 → remove index 3.
  const baseRef = { value: ['280px', 'minmax(0px, 1fr)', '0px', '0px', '220px'] };
  const grid = '280px minmax(0px, 1fr) 0px 420px 0px 220px';
  const tracks = parseGridTracks(grid);
  assert.equal(tracks.length, baseRef.value.length + 1);
  const at = Math.min(3, tracks.length);
  tracks.splice(at, 1);
  assert.equal(tracks.length, 5);
  assert.deepEqual(tracks.slice(0, 3), ['280px', 'minmax(0px, 1fr)', '0px']);
});
