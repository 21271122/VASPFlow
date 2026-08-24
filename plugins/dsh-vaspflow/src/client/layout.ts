/**
 * dsh-vaspflow client: DOM layout controller.
 *
 * The VASP panel lives as one grid track inserted BEFORE the aionui panel
 * columns (so aionui's right-to-left drag-handle math keeps working). The
 * shell frame ([data-dsh-frame]) is a grid whose tracks are written by the
 * shell and by aionui; neither knows about our track, so aionui rewrites the
 * grid (5 tracks) on every drag tick and drops ours.
 *
 * Strategy: a MutationObserver on the frame's style watches every grid write.
 * When the panel is OPEN and an external writer (aionui) dropped our track,
 * we re-insert it inside the observer callback — a microtask that runs after
 * the external write but before the browser paints, so there is no flicker.
 * When CLOSED we never touch the grid (zero interference).
 */
import { createRoot, Root } from 'react-dom/client';
import { panelStore } from './store';

const WIDTH_KEY = 'dsh-vaspflow:panel-width-px';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;

export interface PanelLayoutOptions {
  renderPanel: () => React.ReactElement;
  /** Persist key prefix per project root (empty = global). */
  collapseRoot: string;
}

/** Find the frame grid element. */
export function findFrame(): HTMLElement | null {
  const stamped = document.querySelector('[data-dsh-frame]');
  if (stamped !== null) return stamped as HTMLElement;
  return (document.querySelector('[class*="sidebarCol"]')?.parentElement as HTMLElement | null) ?? null;
}

/** Parse an inline grid-template-columns string into tracks. */
export function parseGridTracks(input: string): string[] {
  const tracks: string[] = [];
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

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH;
}

/**
 * Mount the right dock panel.
 *
 * Idempotent: if a previous mount left its column in the DOM (e.g. the client
 * plugin was re-applied without a clean dispose), the stale column and its
 * React root are torn down first so only ONE panel instance can ever exist.
 * @returns disposer unmounting the root and restoring the grid.
 */
export function mountPanelLayout(opts: PanelLayoutOptions): PanelLayoutApi {
  // Tear down any stale panel column left by an earlier mount (double-mount
  // guard — matches the sidebar entry's re-entrancy check in index.tsx).
  const stale = document.querySelector('[data-dsh-vaspflow-panel]');
  if (stale !== null && stale.isConnected) {
    const staleRoot = (stale as any).__vaspflowRoot as Root | undefined;
    try { staleRoot?.unmount(); } catch { /* ignore */ }
    stale.remove();
  }

  let frame: HTMLElement | null = null;
  let col: HTMLDivElement | null = null;
  let root: Root | null = null;
  /** Shell tracks plus any other plugin tracks (never ours). */
  let baseTracks: string[] = [];
  /** The grid string we last wrote (to recognize our own echo). */
  let lastWritten: string | null = null;
  let styleObserver: MutationObserver | null = null;
  let width = readStoredWidth();
  const disposers: Array<() => void> = [];

  const isOpen = () => panelStore.getSnapshot().open;

  /** Clamp a requested width to the allowed range. */
  const clampWidth = (w: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

  /** Set the panel width (drag callback) and persist it. */
  const setWidth = (w: number) => {
    width = clampWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      // ignore
    }
    lastWritten = null;
    syncOnce();
  };

  const getWidth = () => width;

  /**
   * Where our track is inserted: before aionui's columns when they exist, so
   * aionui's "explorer is rightmost" assumption holds.
   */
  const insertionIndex = (tracks: string[]): number => {
    const hasAionui = frame !== null
      && (frame.querySelector('[data-aionui-preview-col]') !== null
        || frame.querySelector('[data-aionui-explorer-col]') !== null);
    if (hasAionui && tracks.length >= 3) return Math.min(3, tracks.length);
    return tracks.length;
  };

  /**
   * One synchronization pass, driven by the style MutationObserver (runs as a
   * microtask after the external write, before paint).
   *  - closed: leave the grid exactly as the shell/aionui wrote it;
   *  - open:   if our track is missing (track count = base), insert it; if it
   *            is present but its width changed (drag), update the value.
   * Our own write echoes back as base+1 tracks and is ignored.
   */
  const syncOnce = (): boolean => {
    if (frame === null) return false;
    const inline = frame.style.gridTemplateColumns;
    if (inline === '') return false;
    const tracks = parseGridTracks(inline);
    if (tracks.length === 0) return false;
    if (inline === lastWritten) return false; // our own write echoing back
    if (!isOpen()) return false; // closed: hands off entirely
    const w = `${Math.round(width)}px`;
    const hasOurs = tracks.length === baseTracks.length + 1 && baseTracks.length > 0;
    if (hasOurs) {
      // Our track exists; refresh its width if it changed (drag).
      const at = insertionIndex(tracks);
      if (tracks[at] === w) return false;
      const next = [...tracks];
      next[at] = w;
      lastWritten = next.join(' ');
      frame.style.gridTemplateColumns = lastWritten;
      if ((window as any).__VASPFLOW_DEBUG__) {
        console.log('[vaspflow] resize:', { from: tracks.join(' '), to: lastWritten });
      }
      return true;
    }
    // aionui (or the shell) rewrote the grid without our track: adopt as base
    // and insert ours.
    baseTracks = tracks;
    const at = insertionIndex(tracks);
    const next = [...tracks];
    next.splice(at, 0, w);
    lastWritten = next.join(' ');
    frame.style.gridTemplateColumns = lastWritten;
    if ((window as any).__VASPFLOW_DEBUG__) {
      console.log('[vaspflow] restore:', { from: tracks.join(' '), to: lastWritten });
    }
    return true;
  };

  const attach = (frameEl: HTMLElement) => {
    frame = frameEl;

    col = document.createElement('div');
    col.dataset.dshVaspflowPanel = '';
    col.style.cssText = 'display:flex;flex-direction:column;min-width:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#e5e6eb);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2329);font-family:var(--dsw-font-family,sans-serif);font-size:13px;position:relative';
    // Insert BEFORE aionui's columns so they stay rightmost (aionui positions
    // its drag handles right-to-left assuming explorer is the last column).
    const aionuiCol = frame.querySelector('[data-aionui-preview-col], [data-aionui-explorer-col]');
    if (aionuiCol !== null) frame.insertBefore(col, aionuiCol);
    else frame.appendChild(col);

    // The drag handle is rendered by React inside the Panel (see Panel.tsx),
    // so it follows the column natively without per-frame DOM positioning.

    // Watch every grid write on the frame; restore our track when dropped.
    styleObserver = new MutationObserver(() => syncOnce());
    styleObserver.observe(frame, { attributes: true, attributeFilter: ['style'] });

    // When the panel opens/closes via the store.
    const onStoreChange = () => {
      lastWritten = null;
      if (!isOpen()) {
        // Remove our track from the grid and take the column out of grid
        // layout entirely (display:none — not visibility — so auto-placement
        // skips it and aionui's columns land back in their own tracks).
        const inline = frame.style.gridTemplateColumns;
        if (inline !== '') {
          const tracks = parseGridTracks(inline);
          if (tracks.length === baseTracks.length + 1 && baseTracks.length > 0) {
            const at = insertionIndex(tracks);
            const next = [...tracks];
            next.splice(at, 1);
            frame.style.gridTemplateColumns = next.join(' ');
          }
        }
        col.style.display = 'none';
      } else {
        col.style.display = 'flex';
        syncOnce();
      }
    };
    disposers.push(panelStore.subscribe(onStoreChange));

    // Initial state.
    const initial = frame.style.gridTemplateColumns;
    if (initial !== '') baseTracks = parseGridTracks(initial);
    if (baseTracks.length === 0) baseTracks = ['minmax(0, 1fr)'];
    root = createRoot(col);
    (col as any).__vaspflowRoot = root;
    root.render(opts.renderPanel());
    onStoreChange();
  };

  const tryAttach = () => {
    if (frame !== null) return;
    const f = findFrame();
    if (f === null) return;
    attach(f);
  };

  const waitObserver = new MutationObserver(tryAttach);
  waitObserver.observe(document.body, { childList: true, subtree: true });
  tryAttach();

  const api: PanelLayoutApi = {
    dispose: () => {
      waitObserver.disconnect();
      styleObserver?.disconnect();
      for (const dispose of disposers) dispose();
      root?.unmount();
      col?.remove();
      if (frame !== null) {
        // Remove our track if present.
        const inline = frame.style.gridTemplateColumns;
        if (inline !== '') {
          const tracks = parseGridTracks(inline);
          if (tracks.length === baseTracks.length + 1 && baseTracks.length > 0) {
            const at = insertionIndex(tracks);
            tracks.splice(at, 1);
            frame.style.gridTemplateColumns = tracks.join(' ');
          }
        }
      }
      frame = null;
    },
    setWidth,
    getWidth,
  };
  return api;
}

export interface PanelLayoutApi {
  dispose: () => void;
  setWidth: (w: number) => void;
  getWidth: () => number;
}
