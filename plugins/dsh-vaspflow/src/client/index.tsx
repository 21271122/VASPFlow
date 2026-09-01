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
import { panelStore } from './store';
import type { Task } from './api';

const ENTRY_ATTR = 'data-dsh-vaspflow-entry';
const PANEL_ATTR = 'data-dsh-vaspflow-panel';
const ENTRY_LABEL = 'VASP';

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><ellipse cx="8" cy="8" rx="7" ry="2.8" transform="rotate(-30 8 8)"/><path d="M8 4.8v6.4"/></svg>';

const CSS = [
  `[${PANEL_ATTR}]{display:flex;flex-direction:column;min-width:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,#e5e6eb);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2329);font-family:var(--dsw-font-family,sans-serif);font-size:13px}`,
  `[${ENTRY_ATTR}]{width:100%;height:32px;display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--dsw-alias-label-secondary,#454d5f);background:none;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:13px}`,
  `[${ENTRY_ATTR}]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#1f2329)}`,
  `[${ENTRY_ATTR}][data-active]{background:var(--dsw-specific-sidebar-nav-item-active,rgba(22,93,255,.1));color:var(--dsw-alias-label-primary,#1f2329);font-weight:600}`,
  '[data-dsh-frame][data-sidebar-collapsed] [' + ENTRY_ATTR + ']{justify-content:center;width:100%;padding:0}',
  '[data-dsh-frame][data-sidebar-collapsed] [' + ENTRY_ATTR + '] .vfp-entry-label{display:none}',
  // Compact task tree (panel + popup): tighter rows, smaller indent, arrow
  // close to the name. The popup renders on <body>, OUTSIDE the panel, so it
  // needs its own scope.
  `[${PANEL_ATTR}] .ant-tree-treenode, .vaspflow-task-popover .ant-tree-treenode{padding:0!important;line-height:20px}`,
  `[${PANEL_ATTR}] .ant-tree-node-content-wrapper, .vaspflow-task-popover .ant-tree-node-content-wrapper{padding:0 4px!important;min-height:20px!important;line-height:20px!important}`,
  `[${PANEL_ATTR}] .ant-tree-switcher, .vaspflow-task-popover .ant-tree-switcher{width:14px!important;margin-right:0!important}`,
  `[${PANEL_ATTR}] .ant-tree-indent-unit, .vaspflow-task-popover .ant-tree-indent-unit{width:12px!important}`,
  `[${PANEL_ATTR}] .ant-tree-title, .vaspflow-task-popover .ant-tree-title{font-size:12px!important}`,
  `[${PANEL_ATTR}] .ant-tree, .vaspflow-task-popover .ant-tree{margin-top:2px}`,
  // Popup controls row: compact height and gaps.
  '.vaspflow-task-popover .ant-input-affix-wrapper, .vaspflow-task-popover .ant-select-selector{font-size:12px!important}',
  '.vaspflow-task-popover .ant-segmented{font-size:12px}',
  // Compact popup table rows + tighten popover body padding.
  '.vaspflow-task-popover .ant-popover-inner{padding:6px!important}',
  '.vaspflow-task-popover .ant-table-cell{padding-top:4px!important;padding-bottom:4px!important;font-size:12px!important}',
  '.vaspflow-task-popover .ant-table-thead > tr > th{padding-top:4px!important;padding-bottom:4px!important;font-size:12px!important}',
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
  entry.innerHTML = `<span style="display:inline-flex;flex:none;justify-content:center;align-items:center">${ICON}</span><span class="vfp-entry-label">${ENTRY_LABEL}</span>`;
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

  const handleAnalyzeTask = (task: Task) => {
    const rootPath = (panelRootPath());
    const context = buildTaskContext(task, rootPath);
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
