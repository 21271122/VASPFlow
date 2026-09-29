/**
 * dsh-vaspflow client entry: sidebar entry + right-dock panel mount.
 *
 * Mount techniques mirror the installed plugins:
 *  - sidebar entry: task-board self-healing DOM insert;
 *  - right dock: aionui-panel grid-track append + own React root.
 *
 * S5: "分析此任务" prefills the conversation input and focuses it.
 */
import React, { useSyncExternalStore } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Panel, buildTaskContext } from './Panel';
import type { PanelProps } from './Panel';
import { mountPanelLayout } from './layout';
import { panelStore, usePanelStore } from './store';
import { VaspToolRow } from './tool-rows';
import type { BuildTaskDetail } from './store';
import type { Task } from './api';

const ENTRY_ATTR = 'data-dsh-vaspflow-entry';
const PANEL_ATTR = 'data-dsh-vaspflow-panel';
const ENTRY_LABEL = 'VASP';

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><ellipse cx="8" cy="8" rx="7" ry="2.8" transform="rotate(-30 8 8)"/><path d="M8 4.8v6.4"/></svg>';

const CSS = [
  `[${PANEL_ATTR}]{display:flex;flex-direction:column;min-width:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#e5e6eb);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2329);font-family:var(--dsw-font-family,sans-serif);font-size:16px}`,
  `[${ENTRY_ATTR}]{width:100%;height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--dsw-alias-label-secondary,#454d5f);background:none;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:14px}`,
  `[${ENTRY_ATTR}]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#1f2329)}`,
  `[${ENTRY_ATTR}][data-active]{background:var(--dsw-specific-sidebar-nav-item-active,rgba(22,93,255,.1));color:var(--dsw-alias-label-primary,#1f2329);font-weight:600}`,
  `[${ENTRY_ATTR}] .vfp-dev-badge{display:none;margin-left:auto;padding:1px 5px;border-radius:8px;background:#fa8c16;color:#fff;font-size:10px;font-weight:600;line-height:16px}`,
  `[${ENTRY_ATTR}][data-development] .vfp-dev-badge{display:inline-block}`,
  '[data-dsh-frame][data-sidebar-collapsed] [' + ENTRY_ATTR + ']{justify-content:center;width:100%;padding:0}',
  '[data-dsh-frame][data-sidebar-collapsed] [' + ENTRY_ATTR + '] .vfp-entry-label,[data-dsh-frame][data-sidebar-collapsed] [' + ENTRY_ATTR + '] .vfp-dev-badge{display:none}',
  // Compact task tree (panel + popup): tighter rows, smaller indent, arrow
  // close to the name. The popup renders on <body>, OUTSIDE the panel, so it
  // needs its own scope.
  `[${PANEL_ATTR}] .ant-tree-treenode, .vaspflow-task-popover .ant-tree-treenode{padding:0!important;line-height:20px}`,
  `[${PANEL_ATTR}] .ant-tree-node-content-wrapper, .vaspflow-task-popover .ant-tree-node-content-wrapper{padding:0 4px!important;min-height:20px!important;line-height:20px!important}`,
  `[${PANEL_ATTR}] .ant-tree-switcher, .vaspflow-task-popover .ant-tree-switcher{width:14px!important;margin-right:0!important}`,
  `[${PANEL_ATTR}] .ant-tree-indent-unit, .vaspflow-task-popover .ant-tree-indent-unit{width:12px!important}`,
  `[${PANEL_ATTR}] .ant-tree-title, .vaspflow-task-popover .ant-tree-title{font-size:14px!important}`,
  `[${PANEL_ATTR}] .ant-tree, .vaspflow-task-popover .ant-tree{margin-top:2px}`,
  // Popup controls row: compact height and gaps.
  '.vaspflow-task-popover .ant-input-affix-wrapper, .vaspflow-task-popover .ant-select-selector{font-size:14px!important}',
  '.vaspflow-task-popover .ant-segmented{font-size:14px}',
  // Compact popup table rows + tighten popover body padding.
  '.vaspflow-task-popover .ant-popover-inner{padding:6px!important}',
  '.vaspflow-task-popover .ant-table-cell{padding-top:4px!important;padding-bottom:4px!important;font-size:14px!important}',
  '.vaspflow-task-popover .ant-table-thead > tr > th{padding-top:4px!important;padding-bottom:4px!important;font-size:14px!important}',
  '.vaspflow-task-popover .ant-table-tbody > tr > td{padding-top:4px!important;padding-bottom:4px!important}',
  // Dark mode: force the 3D structure mount container to the dark background
  // even if the alias token is unresolved on some element paths.
  'body[data-ds-dark-theme] [data-vasp-structure-mount]{background:#16181f!important;border-color:#30343f!important}',
  // File preview <pre>: dark-mode fallback when the alias token is unresolved.
  'body[data-ds-dark-theme] .vaspflow-file-preview{background:#16181f!important;color:#e6e6e6!important;border:1px solid #30343f!important}',
  // Structure file tab bar: keyboard focus affordance (←/→ switches file).
  '[data-dsh-vaspflow-panel] .vaspflow-structure-tabs:focus-visible{border-radius:8px;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#3964fe)}',
  // Task-list popup: menu-like floating surface with theme-adaptive colors.
  '.vaspflow-task-popover .ant-popover-inner{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2329);border:1px solid var(--dsw-alias-border-l2,#e5e6eb);box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:10px}',
  '.vaspflow-task-popover .ant-popover-arrow{display:none}',
  // The host panel is intentionally readable at the same scale as a normal
  // conversation reply. Ant Design controls otherwise keep their 14px default.
  `[${PANEL_ATTR}] .ant-btn,[${PANEL_ATTR}] .ant-input,[${PANEL_ATTR}] .ant-input-affix-wrapper input,[${PANEL_ATTR}] .ant-select-selection-item,[${PANEL_ATTR}] .ant-select-selection-placeholder,[${PANEL_ATTR}] .ant-tabs-tab,[${PANEL_ATTR}] .ant-tag{font-size:15px!important}`,
  `[${PANEL_ATTR}] .ant-btn-sm{min-height:28px}`,
  // Build tasks sit directly in the conversation. Details live in the dock.
  '[data-dsh-vaspflow-tool]{margin:12px 0;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 0 7px;border-bottom:1px solid var(--dsw-alias-border-l2,#d4ded5)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-head strong{font-size:14px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-muted{color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-group{display:flex;align-items:center;gap:7px;padding:7px 0 3px;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-tree-toggle{border:0;background:none;color:inherit;cursor:pointer;font:inherit;padding:0 3px;width:18px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-task{display:flex;align-items:center;gap:8px;min-height:30px;margin:3px 0;padding:2px 6px 2px 25px;border-radius:4px;background:rgba(38,151,102,.09)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-task[data-selected]{background:rgba(38,151,102,.19)}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-tree-task{background:rgba(94,204,155,.11)}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-tree-task[data-selected]{background:rgba(94,204,155,.22)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-open{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:2px;border:0;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}',
  '[data-dsh-vaspflow-tool] .vfp-tree-open:hover{text-decoration:underline}',
  '[data-dsh-vaspflow-tool] .vfp-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-tree-status{margin-left:auto;white-space:nowrap;color:#248452;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-status[data-status="warn"]{color:#ae7412}',
  '[data-dsh-vaspflow-tool] .vfp-tree-status[data-status="error"]{color:#c44136}',
  '[data-dsh-vaspflow-tool] .vfp-tree-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:12px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-actions button{border:1px solid var(--dsw-alias-border-l2,#b4c6b5);border-radius:4px;background:transparent;color:inherit;padding:5px 10px;cursor:pointer;font:inherit}',
  '[data-dsh-vaspflow-tool] .vfp-tree-actions button.vfp-tree-confirm{background:#db4b32;border-color:#db4b32;color:#fff;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-tree-actions button:disabled{opacity:.5;cursor:default}',
  '[data-dsh-vaspflow-tool] .vfp-tree-message{margin-top:8px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-message[data-error]{color:#c44136}',
  '[data-dsh-vaspflow-tool] .vfp-result-summary{padding:8px 0;line-height:1.5}',
  '[data-dsh-vaspflow-tool] .vfp-result-summary[data-error]{color:#c44136}',
  '[data-dsh-vaspflow-tool] .vfp-result-rows{display:grid;gap:3px}',
  '[data-dsh-vaspflow-tool] .vfp-result-row{display:flex;align-items:center;gap:10px;min-height:30px;padding:4px 8px;border:0;border-radius:4px;background:rgba(38,151,102,.09);color:inherit;text-align:left;font:inherit;cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-result-row:disabled{cursor:default}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-result-row{background:rgba(94,204,155,.11)}',
  '[data-dsh-vaspflow-tool] .vfp-result-row .vfp-tree-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool="vasp_say"].vfp-say{font-size:15px;line-height:1.65;white-space:pre-wrap}',
  '[data-chat-flow-kind="tool-call"]:has([data-dsh-vaspflow-tool="vasp_done"][data-complete]){display:none!important}',
  `[${PANEL_ATTR}] .vfp-build-detail{font-size:14px;line-height:1.55}`,
  `[${PANEL_ATTR}] .vfp-build-detail-head{display:flex;align-items:center;gap:8px;font-size:16px}`,
  `[${PANEL_ATTR}] .vfp-build-detail-path{margin:5px 0 16px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#65746b);font-family:ui-monospace,Consolas,monospace;font-size:12px}`,
  `[${PANEL_ATTR}] .vfp-build-detail-section{display:grid;gap:7px;padding:13px 0;border-top:1px solid var(--dsw-alias-border-l2,#d4ded5);overflow-wrap:anywhere}`,
  `[${PANEL_ATTR}] .vfp-build-detail-section>b{font-size:13px}`,
  `[${PANEL_ATTR}] .vfp-build-detail-section>div:has(>span){display:grid;grid-template-columns:95px minmax(0,1fr);gap:8px}`,
  `[${PANEL_ATTR}] .vfp-build-warning{color:#ae7412}`,
  `[${PANEL_ATTR}] .vfp-build-error{color:#c44136}`,
].join('\n');

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.pluginCss = 'dsh-vaspflow-css';
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ---- sidebar entry (task-board technique) -----------------------------------

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return undefined;
  return (column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild) as HTMLElement | undefined;
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector('button[class*="newSession"]') as HTMLButtonElement | null;
  if (nested !== null) return nested;
  for (const child of Array.from(root.children)) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement;
  }
  return undefined;
}

function createEntry(onClick: () => void): HTMLButtonElement {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.setAttribute(ENTRY_ATTR, '');
  entry.setAttribute('aria-label', ENTRY_LABEL);
  entry.innerHTML = `<span style="display:inline-flex;flex:none;justify-content:center;align-items:center">${ICON}</span><span class="vfp-entry-label">${ENTRY_LABEL}</span><span class="vfp-dev-badge">开发测试</span>`;
  entry.addEventListener('click', onClick);
  return entry;
}

function placeEntry(root: HTMLElement, entry: HTMLElement): boolean {
  const button = newSessionButton(root);
  if (button === undefined) return false;
  if (entry.parentElement !== root) {
    const family = Array.from(root.children).filter(
      (el) => el instanceof HTMLElement && el.hasAttribute(ENTRY_ATTR),
    );
    const anchor = family.length > 0 ? family[0] : button.nextElementSibling;
    root.insertBefore(entry, anchor);
  }
  return true;
}

function mountSidebarEntry(toggle: () => void, isOpen: () => boolean, subscribe: (fn: () => void) => () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  if (document.querySelector(`[${ENTRY_ATTR}]`) !== null) return () => {};
  const entry = createEntry(toggle);
  let root: HTMLElement | undefined;
  let placed = false;
  let rootObserver: MutationObserver | null = null;

  const tryPlace = () => {
    if (root !== undefined && !root.isConnected) {
      rootObserver?.disconnect();
      root = undefined;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(entry)) return;
      rootObserver?.disconnect();
      root = undefined;
      placed = false;
    }
    root = root ?? sidebarRoot();
    if (root === undefined) return;
    placed = placeEntry(root, entry);
    if (placed) {
      rootObserver = new MutationObserver(tryPlace);
      rootObserver.observe(root, { childList: true, subtree: true });
    }
  };

  const waitObserver = new MutationObserver(tryPlace);
  waitObserver.observe(document.body, { childList: true, subtree: true });

  const applyActive = () => {
    if (isOpen()) entry.setAttribute('data-active', '');
    else entry.removeAttribute('data-active');
  };
  const unsub = subscribe(applyActive);
  applyActive();
  tryPlace();

  // The host returns this only for a source checkout. A package downloaded
  // from npm does not contain the marker and therefore keeps the normal VASP
  // label even when its version number happens to match the source tree.
  void fetch('/plugins/dsh-vaspflow/ping', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : undefined)
    .then((body) => {
      if (body?.development === true) entry.setAttribute('data-development', '');
    })
    .catch(() => {});

  return () => {
    waitObserver.disconnect();
    rootObserver?.disconnect();
    unsub();
    entry.remove();
  };
}

// ---- S5: conversation input prefill -----------------------------------------

function findComposerTextarea(): HTMLTextAreaElement | null {
  const selectors = [
    '[data-dsh-composer] textarea',
    '[class*="composer"] textarea',
    '[data-pane="conversation"] textarea',
    '[class*="inputArea"] textarea',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLTextAreaElement) return el;
  }
  return null;
}

/**
 * Prefill the conversation input with a task context (editable) and focus it.
 * Uses native setter + input event so React-controlled textareas see the
 * change.
 */
function prefillConversationInput(text: string): boolean {
  const textarea = findComposerTextarea();
  if (textarea === null) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(textarea, text);
  else textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(text.length, text.length);
  return true;
}

// ---- entry ------------------------------------------------------------------

const inject = ['slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'locale'];

/** Subscribe to the DSH dark-theme marker (body[data-ds-dark-theme]). */
function subscribeDarkTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', callback);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', callback);
  };
}

function getDarkTheme(): boolean {
  return document.body.dataset.dsDarkTheme !== undefined
    || window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

// ---- conversation tool row --------------------------------------------------

type BuildInputsArgs = {
  projectRoot?: string;
  linkPotcar?: boolean;
  tasks?: BuildTaskDetail['task'][];
};

type BuildTask = NonNullable<BuildInputsArgs['tasks']>[number];
type BuildRow = NonNullable<BuildTaskDetail['result']>;
type BuildResult = { planId?: string; projectRoot?: string; error?: string; results?: BuildRow[]; errorCount?: number; wroteCount?: number; dryRun?: boolean; dryRunMode?: boolean };
type BuildOutcome = { phase: 'done' | 'cancelled' | 'unavailable'; selectedIndices: number[]; writeRows: Record<number, BuildRow>; message: string; requestError: boolean };
const buildOutcomes = new Map<string, BuildOutcome>();
const buildOutcomeListeners = new Set<() => void>();

function subscribeBuildOutcomes(listener: () => void): () => void {
  buildOutcomeListeners.add(listener);
  return () => buildOutcomeListeners.delete(listener);
}

function readBuildOutcome(planId?: string): BuildOutcome | null {
  if (!planId) return null;
  const cached = buildOutcomes.get(planId);
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(`dsh-vaspflow:build-outcome:${planId}`);
    if (!raw) return null;
    const outcome = JSON.parse(raw) as BuildOutcome;
    if ((outcome.phase !== 'done' && outcome.phase !== 'cancelled' && outcome.phase !== 'unavailable')
      || !Array.isArray(outcome.selectedIndices) || !outcome.writeRows || typeof outcome.message !== 'string') return null;
    buildOutcomes.set(planId, outcome);
    return outcome;
  } catch { return null; }
}

function saveBuildOutcome(planId: string | undefined, outcome: BuildOutcome): void {
  if (!planId) return;
  buildOutcomes.set(planId, outcome);
  try { sessionStorage.setItem(`dsh-vaspflow:build-outcome:${planId}`, JSON.stringify(outcome)); } catch { /* in-memory state still survives conversation switches */ }
  buildOutcomeListeners.forEach((listener) => listener());
}

function parseToolArgs(block: any): BuildInputsArgs {
  const raw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw) as BuildInputsArgs;
  } catch {
    return {};
  }
}

function parseBuildResult(block: any): BuildResult {
  for (const candidate of [block?.result?.value, block?.result?.meta, block?.resultView?.meta, block?.meta, block?.value, block?.result]) {
    if (candidate && typeof candidate === 'object' && ('results' in candidate || 'planId' in candidate)) return candidate as BuildResult;
  }
  return {};
}

function taskGroup(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(' / ') : '项目根目录';
}

function BuildInputsToolRow({ block }: { block: any }) {
  const { buildDryRun, buildModeError } = usePanelStore();
  const args = React.useMemo(() => parseToolArgs(block), [block]);
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const settled = block?.kind === 'tool-result';
  const preview = React.useMemo(() => parseBuildResult(block), [block]);
  const [selectedState, setSelected] = React.useState<Set<number>>(() => new Set(tasks.map((_, index) => index)));
  const [focused, setFocused] = React.useState<number | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [phaseState, setPhase] = React.useState<'preview' | 'building' | BuildOutcome['phase']>('preview');
  const [writeRowsState, setWriteRows] = React.useState<Record<number, BuildRow>>({});
  const [messageState, setMessage] = React.useState('');
  const [requestErrorState, setRequestError] = React.useState(false);
  const saved = React.useSyncExternalStore<BuildOutcome | null>(subscribeBuildOutcomes, () => readBuildOutcome(preview.planId), () => null);
  const selected: Set<number> = saved ? new Set<number>(saved.selectedIndices) : selectedState;
  const phase = saved?.phase ?? phaseState;
  const writeRows = saved?.writeRows ?? writeRowsState;
  const message = messageState || saved?.message || '';
  const requestError = messageState ? requestErrorState : saved?.requestError ?? requestErrorState;
  const directMode = buildDryRun === false;
  const submitLock = React.useRef(false);
  const isPreview = preview.dryRun !== false;
  const groups = new Map<string, number[]>();
  tasks.forEach((task, index) => {
    const group = taskGroup(task.dir || '');
    groups.set(group, [...(groups.get(group) || []), index]);
  });
  const canConfirm = settled && isPreview && !!preview.planId && !preview.error && !buildModeError && phase === 'preview';
  const selectedIndices = [...selected].sort((a, b) => a - b);
  const selectedErrors = selectedIndices.filter((index) => preview.results?.[index]?.errors?.length).length;

  const showTask = (index: number, row?: BuildRow, nextPhase: BuildTaskDetail['phase'] = (phase === 'done' && selected.has(index)) || (settled && !isPreview) ? 'done' : 'preview') => {
    setFocused(index);
    panelStore.setSelectedBuildTask({
      task: tasks[index], result: row ?? writeRows[index] ?? preview.results?.[index],
      projectRoot: preview.projectRoot || args.projectRoot || '',
      linkPotcar: !!args.linkPotcar, phase: nextPhase,
    });
    panelStore.setOpen(true);
  };
  const confirm = async (enableDirect = false) => {
    if (!canConfirm || selectedIndices.length === 0 || selectedErrors > 0 || submitLock.current) return;
    submitLock.current = true;
    setPhase('building');
    setRequestError(false);
    setMessage('正在构建所选任务…');
    try {
      const response = await fetch('/plugins/dsh-vaspflow/build-inputs/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: preview.planId, selectedIndices, enableDirect }),
      });
      const result = await response.json() as BuildResult;
      if (!response.ok) throw new Error(result.error || '构建失败');
      const rows = Object.fromEntries(selectedIndices.map((index, position) => [index, result.results?.[position] ?? {}])) as Record<number, BuildRow>;
      const nextMessage = `已写入 ${result.wroteCount ?? 0}/${selectedIndices.length} 个任务${result.errorCount ? `，${result.errorCount} 个任务失败` : ''}${result.dryRunMode === false ? '；后续由 AI 直接构建' : enableDirect ? '；仍保持预览确认' : ''}`;
      saveBuildOutcome(preview.planId, { phase: 'done', selectedIndices, writeRows: rows, message: nextMessage, requestError: false });
      setWriteRows(rows);
      setPhase('done');
      panelStore.setBuildDryRun(result.dryRunMode !== false);
      setMessage(nextMessage);
      if (focused !== null) showTask(focused, rows[focused], selected.has(focused) ? 'done' : 'preview');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      saveBuildOutcome(preview.planId, { phase: 'unavailable', selectedIndices, writeRows: {}, message: nextMessage, requestError: true });
      setPhase('unavailable');
      setRequestError(true);
      setMessage(nextMessage);
    }
  };
  const restorePreview = async () => {
    try {
      const response = await fetch('/plugins/dsh-vaspflow/build-inputs/mode', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '切换失败');
      panelStore.setBuildDryRun(true);
      setRequestError(false);
      setMessage('已恢复预览确认；后续构建将先交给你确认');
    } catch (error) {
      setRequestError(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div data-dsh-vaspflow-tool="vasp_build_inputs">
      <div className="vfp-tree-head"><strong>构建任务</strong><span className="vfp-tree-muted">{!settled ? '处理中' : phase === 'done' ? '构建结果' : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '不可确认' : isPreview ? '安全预览' : '构建结果'} · {tasks.length} 个任务</span></div>
      {Array.from(groups, ([name, indices]) => (
        <div key={name}>
          <div className="vfp-tree-group">
            <button type="button" className="vfp-tree-toggle" aria-label={`${collapsed.has(name) ? '展开' : '收起'} ${name}`} aria-expanded={!collapsed.has(name)} onClick={() => setCollapsed((old) => { const next = new Set(old); if (next.has(name)) next.delete(name); else next.add(name); return next; })}>{collapsed.has(name) ? '›' : '⌄'}</button>
            {canConfirm && <input type="checkbox" aria-label={`选择 ${name} 全部任务`} checked={indices.every((index) => selected.has(index))} ref={(node) => { if (node) node.indeterminate = indices.some((index) => selected.has(index)) && !indices.every((index) => selected.has(index)); }} onChange={(event) => setSelected((old) => { const next = new Set(old); indices.forEach((index) => event.target.checked ? next.add(index) : next.delete(index)); return next; })} />}
            <span>{name}</span><span className="vfp-tree-muted">{indices.length}</span>
          </div>
          {!collapsed.has(name) && indices.map((index) => {
            const row = writeRows[index] ?? preview.results?.[index];
            const status = row?.errors?.length ? 'error' : row?.warnings?.length ? 'warn' : 'ok';
            const label = !settled ? '处理中' : status === 'error' ? '错误' : row?.wrote ? '已写入' : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '待核查' : phase === 'done' && selected.has(index) ? '未写入' : status === 'warn' ? '需注意' : isPreview ? '可构建' : '完成';
            return <div className="vfp-tree-task" key={`${taskGroup(tasks[index].dir || '')}-${index}`} data-selected={focused === index ? '' : undefined}>
              {canConfirm && <input type="checkbox" aria-label={`选择 ${tasks[index].dir || `任务 ${index + 1}`}`} checked={selected.has(index)} onChange={(event) => setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(index); else next.delete(index); return next; })} />}
              <button type="button" className="vfp-tree-open" onClick={() => showTask(index)} aria-label={`在右侧查看 ${tasks[index].dir || `任务 ${index + 1}`} 详情`}><span className="vfp-tree-name">{tasks[index].dir?.split(/[\\/]+/).filter(Boolean).at(-1) || `任务 ${index + 1}`}</span><span className="vfp-tree-status" data-status={status}>{label}</span><span aria-hidden="true">›</span></button>
            </div>;
          })}
        </div>
      ))}
      {tasks.length === 0 && <div className="vfp-tree-message">没有构建任务</div>}
      {isPreview && tasks.length > 0 && <div className="vfp-tree-actions"><span>{selected.size} 个任务已选中{selectedErrors ? ` · ${selectedErrors} 个任务存在错误` : ''}</span><span>
        {phase === 'preview' && <button type="button" onClick={() => {
          saveBuildOutcome(preview.planId, { phase: 'cancelled', selectedIndices, writeRows: {}, message: '预览已取消，未写入文件', requestError: false });
          setPhase('cancelled');
          setMessage('预览已取消，未写入文件');
          if (preview.planId) void fetch('/plugins/dsh-vaspflow/build-inputs/confirm', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ planId: preview.planId, cancel: true }),
          }).catch(() => {});
        }}>取消预览</button>}
        {phase === 'preview' && <button type="button" disabled={!canConfirm || selected.size === 0 || selectedErrors > 0} title="执行本次所选任务，并让后续 AI 调用直接构建" onClick={() => { void confirm(true); }}>交给 AI 直接构建</button>}
        <button type="button" className="vfp-tree-confirm" disabled={!canConfirm || selected.size === 0 || selectedErrors > 0} onClick={() => { void confirm(); }}>{phase === 'building' ? '正在构建…' : phase === 'done' ? '已完成' : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '不可确认' : `确认构建 ${selected.size} 个任务`}</button>
      </span></div>}
      {directMode && settled && <div className="vfp-tree-actions"><span className="vfp-tree-muted">后续 AI 调用将直接构建</span><button type="button" onClick={() => { void restorePreview(); }}>恢复预览确认</button></div>}
      {preview.error && <div className="vfp-tree-message" data-error="">{preview.error}</div>}
      {buildModeError && <div className="vfp-tree-message" data-error="">{buildModeError}</div>}
      {settled && isPreview && !preview.planId && !preview.error && <div className="vfp-tree-message">此预览缺少确认凭据，请在对话中重新运行预览。</div>}
      {message && <div className="vfp-tree-message" data-error={requestError ? '' : undefined}>{message}</div>}
    </div>
  );
}

/** Panel wrapped in a theme-aware ConfigProvider (dark/light adaptive). */
function PanelRoot(props: PanelProps) {
  const dark = useSyncExternalStore(subscribeDarkTheme, getDarkTheme, getDarkTheme);
  const api = panelLayoutApi.current;
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <Panel
        {...props}
        onResizeWidth={api ? (w) => api.setWidth(w) : undefined}
        getPanelWidth={api ? () => api.getWidth() : undefined}
      />
    </ConfigProvider>
  );
}

/** Mutable holder for the layout API so PanelRoot can reach setWidth/getWidth. */
const panelLayoutApi: { current: { setWidth: (w: number) => void; getWidth: () => number } | null } = { current: null };

function apply(ctx: any) {
  injectCss();

  void fetch('/plugins/dsh-vaspflow/build-inputs/mode')
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((result) => {
      if (typeof result.dryRun !== 'boolean') throw new Error('invalid build mode response');
      panelStore.setBuildDryRun(result.dryRun);
      panelStore.setBuildModeError(null);
    })
    .catch(() => panelStore.setBuildModeError('VASPFlow 插件服务仍是旧版或未启动。请重启 DSH 并刷新页面后再构建。'));

  // The host still owns calls and results; these views provide the visible
  // delivery for the VASP preset without an extra assistant paragraph.
  try {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'vasp_build_inputs',
    }, BuildInputsToolRow));
    for (const toolName of ['vasp_scan', 'vasp_inspect_task', 'vasp_convergence', 'vasp_structure_scene', 'vasp_discover_inputs', 'vasp_check_inputs', 'vasp_say', 'vasp_done']) {
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: toolName,
      }, (props: any) => <VaspToolRow {...props} toolName={toolName} />));
    }
  } catch (error) {
    console.error('[dsh-vaspflow] conversation tool row mount failed:', error);
  }

  // S5 workspace reuse: subscribe to the workspaces store so the "从工作区"
  // picker stays populated as workspaces load/change.
  // DSH client API: ctx.workspaces.list is a snapshot store; getSnapshot()
  // returns { recentWorkspaceId, items: [{ workspaceId, path, name?, ... }] }.
  const syncWorkspaces = () => {
    try {
      const snap = ctx.workspaces.list.getSnapshot();
      const items = (snap?.items ?? []) as any[];
      panelStore.setWorkspaceItems(items.map((w) => ({
        value: w.workspaceId ?? w.id,
        label: w.name || w.workspaceId || w.path || String(w.id),
      })));
    } catch {
      panelStore.setWorkspaceItems([]);
    }
  };
  const unsubscribeWorkspaces = (() => {
    try {
      return ctx.workspaces.list.subscribe(syncWorkspaces);
    } catch {
      return () => {};
    }
  })();
  syncWorkspaces();

  const onPickWorkspace = (id: string) => {
    try {
      const snap = ctx.workspaces.list.getSnapshot();
      const item = (snap?.items ?? []).find((w: any) => (w.workspaceId ?? w.id) === id);
      const path = item?.path ?? '';
      if (path) panelStore.setProjectPath(path);
    } catch {
      // ignore
    }
  };

  const toggle = () => panelStore.toggleOpen();

  const handleAnalyzeTask = (task: Task, draft?: string) => {
    const rootPath = (panelRootPath());
    const context = draft ?? buildTaskContext(task, rootPath);
    if (!prefillConversationInput(context)) {
      try {
        navigator.clipboard.writeText(context);
        // eslint-disable-next-line no-alert
        window.alert('未能定位聊天输入框；任务上下文已复制到剪贴板，粘贴即可');
      } catch {
        // ignore
      }
    }
  };

  const panel = <PanelRoot onAnalyzeTask={handleAnalyzeTask} onPickWorkspace={onPickWorkspace} />;

  const disposers: Array<() => void> = [];
  try {
    disposers.push(mountSidebarEntry(toggle, () => panelStore.getSnapshot().open, panelStore.subscribe));
    const layoutApi = mountPanelLayout({
      renderPanel: () => panel,
      collapseRoot: '',
    });
    panelLayoutApi.current = layoutApi;
    disposers.push(() => layoutApi.dispose());
  } catch (error) {
    console.error('[dsh-vaspflow] mount failed:', error);
  }

  ctx.effect(() => () => {
    unsubscribeWorkspaces();
    for (const dispose of disposers) dispose();
    panelLayoutApi.current = null;
  }, 'dsh-vaspflow: ui');
}

/** Read the panel's current scan root from the store (state is module-level). */
let currentProjectPath = '';
function panelRootPath(): string {
  return currentProjectPath || panelStore.getSnapshot().projectPath;
}

// keep the store path in sync for prefill (best-effort)
export function setProjectPathForPrefill(path: string) {
  currentProjectPath = path;
}

export { apply, inject };
