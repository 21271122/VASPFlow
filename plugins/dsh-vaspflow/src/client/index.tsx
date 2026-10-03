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
import { VaspToolRow, useToolCardCollapse } from './tool-rows';
import { mountWorkCollapse } from './work-collapse';
import type { BuildTaskDetail } from './store';
import type { Task } from './api';
import { readStructureDrag, startStructureDrag, STRUCTURE_DRAG_TYPE } from './structure-drag';
import { scrollExpandedTreeRow } from './tree-scroll';

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
  '[data-dsh-vaspflow-tool]{margin:12px 0;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;--vfp-tree-folder-bg:rgba(79,143,210,.08);--vfp-tree-leaf-bg:rgba(38,151,102,.09)}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool]{--vfp-tree-folder-bg:rgba(120,185,241,.09);--vfp-tree-leaf-bg:rgba(94,204,155,.11)}',
  '[data-dsh-vaspflow-tool]:not([data-dsh-vaspflow-tool="vasp_say"]):not([data-dsh-vaspflow-tool="vasp_done"]){border-left:3px solid #4f8fd2;padding:12px 14px 14px;background:rgba(79,143,210,.035)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 0 4px;margin-bottom:4px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-head strong{font-size:15px;color:#3279bf}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-tree-head strong{color:#78b9f1}',
  '[data-dsh-vaspflow-tool] .vfp-card-toggle{display:inline-flex;align-items:center;gap:7px;min-width:0;padding:0;border:0;background:none;color:inherit;cursor:pointer;font:inherit;text-align:left}',
  '[data-dsh-vaspflow-tool] .vfp-card-toggle>span{width:12px;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-card-toggle:focus-visible{outline:2px solid #4f8fd2;outline-offset:3px}',
  '[data-dsh-vaspflow-tool] [hidden]{display:none!important}',
  '[data-dsh-vaspflow-tool] .vfp-tree-muted{color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-group{display:flex;align-items:center;gap:7px;padding:7px 0 3px;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-tree-toggle{border:0;background:none;color:inherit;cursor:pointer;font:inherit;padding:0 3px;width:18px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-task{display:flex;align-items:center;gap:8px;min-height:30px;margin:3px 0;padding:2px 8px;border-radius:4px;background:var(--vfp-tree-leaf-bg)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-task[data-selected]{background:rgba(38,151,102,.19)}',
  '[data-dsh-vaspflow-tool] .vfp-tree-task[data-drop-active]{outline:2px dashed #d7a62d;background:rgba(215,166,45,.16)}',
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
  '[data-dsh-vaspflow-tool] .vfp-build-steps{display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 0;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e6eb)}',
  '[data-dsh-vaspflow-tool] .vfp-build-steps span{color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-build-steps [data-stage="done"]{color:#248452}',
  '[data-dsh-vaspflow-tool] .vfp-build-steps [data-stage="current"]{color:#3279bf;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-build-steps [data-stage="stopped"]{color:#c44136}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e6eb);font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes summary{cursor:pointer;color:#ae7412}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes>div{display:flex;flex-wrap:wrap;gap:4px 8px;padding:5px 0;overflow-wrap:anywhere}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes>div strong{width:100%;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes>div span{max-width:45%;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes p{display:flex;gap:8px;margin:5px 0;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-build-changes time{flex:none;font-variant-numeric:tabular-nums}',
  '[data-vasp-structure-mount]:focus-visible{outline:2px solid #4f8fd2;outline-offset:2px}',
  '.vfp-structure-toolbar{min-height:30px}',
  '.vfp-structure-toolbar .vfp-source-location{flex:1;min-width:0}',
  '.vfp-structure-toolbar .vfp-structure-action{height:27px;padding:0 9px;border:1px solid rgba(80,144,202,.42);border-radius:3px;background:rgba(77,147,205,.09);color:#3279bf;font-size:12px}',
  '.vfp-structure-toolbar .vfp-structure-action:hover,.vfp-structure-toolbar .vfp-structure-action:focus-visible{border-color:#3279bf;background:rgba(77,147,205,.17);color:#2367a7}',
  'body[data-ds-dark-theme] .vfp-structure-toolbar .vfp-structure-action{color:#78b9f1;background:rgba(112,185,241,.1)}',
  '.vfp-structure-measurement{display:flex;align-items:center;gap:10px;padding:5px 8px;border-left:2px solid #d8a53e;background:rgba(216,165,62,.1);font-size:12px;line-height:1.4}',
  '.vfp-structure-measurement button{margin-left:auto;padding:1px 5px;border:0;background:transparent;color:#3279bf;cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-result-summary{padding:8px 0;line-height:1.5}',
  '[data-dsh-vaspflow-tool] .vfp-result-summary[data-error]{color:#c44136}',
  '[data-dsh-vaspflow-tool] .vfp-result-rows{display:grid;gap:3px}',
  '[data-dsh-vaspflow-tool="vasp_inspect_tasks"] .vfp-result-rows{max-height:320px;overflow:auto}',
  '[data-dsh-vaspflow-tool] .vfp-result-row{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;min-width:0;min-height:30px;padding:4px 8px;border:0;border-radius:4px;background:var(--vfp-tree-leaf-bg);color:inherit;text-align:left;font:inherit;cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-result-row:disabled{cursor:default}',
  '[data-dsh-vaspflow-tool] .vfp-result-row[draggable="true"], [data-dsh-vaspflow-tool] .vfp-inspection-item>summary[draggable="true"], [data-dsh-vaspflow-tool] .vfp-visual-tree-leaf[draggable="true"], [data-dsh-vaspflow-tool] .vfp-tree-task[draggable="true"]{cursor:grab}',
  '[data-dsh-vaspflow-tool] .vfp-result-row>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-result-row .vfp-tree-muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-scan-path{font-size:12px;color:var(--dsw-alias-label-secondary,#65746b);overflow-wrap:anywhere;padding-top:9px}',
  '[data-dsh-vaspflow-tool] .vfp-scan-path code{font:inherit;color:inherit}',
  '[data-dsh-vaspflow-tool] .vfp-scan-stats{padding:10px 0 6px}',
  '[data-dsh-vaspflow-tool] .vfp-scan-bar{display:flex;width:100%;height:16px;overflow:hidden;border-radius:5px;background:rgba(128,128,128,.14)}',
  '[data-dsh-vaspflow-tool] .vfp-scan-bar span{height:100%}',
  '[data-dsh-vaspflow-tool] .vfp-scan-legend{display:flex;flex-wrap:wrap;gap:4px 14px;padding:8px 0 12px;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-scan-legend span{display:inline-flex;align-items:center;gap:5px}',
  '[data-dsh-vaspflow-tool] .vfp-scan-legend i{display:inline-block;width:8px;height:8px;border-radius:2px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;padding:14px 0 4px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-title{font-weight:600;padding-bottom:9px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-body{display:flex;align-items:center;gap:11px}',
  '[data-dsh-vaspflow-tool] .vfp-pie{width:130px;height:130px;flex:none;border-radius:50%}',
  '[data-dsh-vaspflow-tool] .vfp-pie[role="img"]{cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend{display:grid;gap:5px;min-width:0;flex:1;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto 39px;align-items:center;gap:5px}',
  '[data-dsh-vaspflow-tool] button.vfp-pie-legend-row{width:100%;padding:2px 4px;border:0;border-radius:3px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}',
  '[data-dsh-vaspflow-tool] button.vfp-pie-legend-row:hover,[data-dsh-vaspflow-tool] button.vfp-pie-legend-row[data-selected]{background:var(--vfp-tree-folder-bg)}',
  '[data-dsh-vaspflow-tool] button.vfp-pie-legend-row[data-selected]{font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-clear-filter{border:0;background:none;color:#3279bf;cursor:pointer;font:inherit;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend i{width:8px;height:8px;border-radius:1px}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend-row strong{text-align:right}',
  '[data-dsh-vaspflow-tool] .vfp-pie-legend-row small{text-align:right;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-path-tree{padding:4px 0;max-height:320px;overflow-y:auto;overflow-x:hidden}',
  '[data-dsh-vaspflow-tool] .vfp-build-tree{max-height:420px}',
  '[data-dsh-vaspflow-tool] .vfp-tree-group>span:first-of-type{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-tree-group>span:last-of-type{margin-left:auto}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder{border-top:0}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary,[data-dsh-vaspflow-tool] .vfp-build-folder>.vfp-tree-group{box-sizing:border-box;display:flex;align-items:center;gap:7px;min-height:30px;margin:3px 0;padding:4px 8px;border-radius:4px;background:var(--vfp-tree-folder-bg);font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary{list-style:none;cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary::-webkit-details-marker{display:none}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary::before{content:"▸";color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder[open]>summary::before{content:"▾"}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-path-folder>summary small{margin-left:auto;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-path-children{margin-left:8px;padding-left:12px;border-left:1px solid rgba(112,146,173,.28)}',
  '[data-dsh-vaspflow-tool] .vfp-path-leaf{position:relative}',
  '[data-dsh-vaspflow-tool] .vfp-path-children>.vfp-path-leaf::before{content:"";position:absolute;left:-12px;top:15px;width:8px;border-top:1px solid rgba(112,146,173,.28)}',
  '[data-dsh-vaspflow-tool] .vfp-path-children>.vfp-path-folder{position:relative}',
  '[data-dsh-vaspflow-tool] .vfp-path-children>.vfp-path-folder::before{content:"";position:absolute;left:-12px;top:15px;width:8px;border-top:1px solid rgba(112,146,173,.28)}',
  '[data-dsh-vaspflow-tool] .vfp-source-file{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;min-height:30px;margin:3px 0;padding:4px 8px;border:0;border-radius:4px;background:var(--vfp-tree-leaf-bg);color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background .12s ease}',
  '[data-dsh-vaspflow-tool] .vfp-source-file:hover{background:rgba(38,151,102,.17)}',
  '[data-dsh-vaspflow-tool] .vfp-source-file[draggable="true"]{cursor:grab}',
  '[data-dsh-vaspflow-tool] .vfp-source-file small{margin-left:auto;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-source-file>span:last-child{color:var(--dsw-alias-label-secondary,#65746b);white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-source-file:hover>span:last-child{color:#3279bf}',
  '[data-dsh-vaspflow-tool] .vfp-source-location{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;padding:4px 0}',
  '.ant-modal .vfp-source-location{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);overflow-wrap:anywhere;padding:4px 0}',
  '.ant-modal .vfp-file-preview{max-height:60vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-elevated,#f5f5f5);color:var(--dsw-alias-label-primary,#1f2329);padding:12px;font-size:12px;line-height:1.5}',
  '.vfp-preview-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:11px}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-section>details{border-top:1px solid var(--dsw-alias-border-l2,#d4ded5);padding:7px 0}',
  '[data-dsh-vaspflow-tool] .vfp-discovery .vfp-path-folder{border-top:0;padding:0}',
  '[data-dsh-vaspflow-tool] .vfp-discovery summary{cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-heading{font-weight:600;padding:10px 0 6px}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list{max-height:260px;overflow:auto;padding:6px 0 6px 14px}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list>div{display:flex;gap:10px;justify-content:space-between;padding:4px 0;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list>div[draggable="true"]{cursor:grab}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list>div[draggable="true"]:hover{background:var(--vfp-tree-folder-bg)}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list code{font:inherit;overflow-wrap:anywhere}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-list span{color:var(--dsw-alias-label-secondary,#65746b);text-align:right}',
  '[data-dsh-vaspflow-tool] .vfp-inline-tree{margin:4px 0 8px}',
  '[data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-path-tree{max-height:220px}',
  '[data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-visual-tree-leaf{display:block;box-sizing:border-box;width:100%;min-height:30px;margin:3px 0;padding:4px 8px;border:0;border-radius:4px;background:var(--vfp-tree-leaf-bg);color:inherit;text-align:left;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-visual-tree-leaf[aria-current="true"]{background:rgba(38,151,102,.2);color:#278d67}',
  '[data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-visual-tree-leaf[data-user-added]{color:#bc870e}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-visual-tree-leaf[data-user-added]{color:#f4c65d}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs{display:flex;gap:3px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l2,#d4ded5);margin:0 0 8px;scrollbar-width:thin}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button{flex:none;max-width:220px;min-height:30px;padding:4px 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;font:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button:hover{background:rgba(38,151,102,.1)}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button[aria-selected="true"]{color:#278d67;border-color:#39a579;font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-drag-side="left"]{box-shadow:inset 3px 0 #4c9ed7}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-drag-side="right"]{box-shadow:inset -3px 0 #4c9ed7}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-user-added]{color:#bc870e}',
  '[data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-user-added][aria-selected="true"]{color:#bc870e;border-color:#bc870e}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-user-added]{color:#f4c65d}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-visual-tabs button[data-user-added][aria-selected="true"]{color:#f4c65d;border-color:#f4c65d}',
  '[data-dsh-vaspflow-tool][data-drop-active]{outline:2px dashed #d7a62d;outline-offset:2px;background:rgba(215,166,45,.1)}',
  '[data-dsh-vaspflow-tool] .vfp-structure-drop-hint{padding:6px 0;color:#bc870e}',
  '[data-dsh-vaspflow-tool] .vfp-structure-drop-hint[data-rejected]{color:#c44136}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-structure-drop-hint{color:#f4c65d}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-structure-drop-hint[data-rejected]{color:#ff7875}',
  '[data-dsh-vaspflow-tool] .vfp-file-preview{max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-tool-intent{font-size:13px;line-height:1.55;padding:10px 0 1px;color:inherit}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr);gap:10px;align-items:center;margin:16px 0 12px}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow>div{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px;align-items:baseline;min-width:0}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow>div strong{font-size:26px;line-height:1;color:#3279bf}',
  'body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-source-flow>div strong{color:#78b9f1}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow>div span{font-weight:600}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow>div small{grid-column:1/-1;color:var(--dsw-alias-label-secondary,#65746b);line-height:1.4}',
  '[data-dsh-vaspflow-tool] .vfp-source-flow>b{text-align:center;font-size:17px;font-weight:400;color:var(--dsw-alias-label-tertiary,#999)}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-section{padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2,#d4ded5)}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-heading{display:flex;justify-content:space-between;align-items:baseline;gap:12px}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-heading span{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row>summary{position:relative;display:flex;justify-content:space-between;gap:12px;padding:7px 4px 9px;overflow:hidden}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row>summary i{position:absolute;bottom:0;left:0;height:3px;background:#48a884;border-radius:2px}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row>summary,[data-dsh-vaspflow-tool] .vfp-template-group>summary{box-sizing:border-box;align-items:center;min-height:30px;margin:3px 0;padding:5px 8px;border-radius:4px;background:var(--vfp-tree-folder-bg);list-style:none;cursor:pointer}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row>summary::-webkit-details-marker,[data-dsh-vaspflow-tool] .vfp-template-group>summary::-webkit-details-marker{display:none}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row>summary::before,[data-dsh-vaspflow-tool] .vfp-template-group>summary::before{content:"▸";flex:none;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-distribution-row[open]>summary::before,[data-dsh-vaspflow-tool] .vfp-template-group[open]>summary::before{content:"▾"}',
  '[data-dsh-vaspflow-tool] .vfp-coverage{display:grid;gap:7px;margin:8px 0 10px}',
  '[data-dsh-vaspflow-tool] .vfp-coverage>div{display:grid;grid-template-columns:82px minmax(0,1fr) 54px;align-items:center;gap:9px;font-size:12px}',
  '[data-dsh-vaspflow-tool] .vfp-coverage>div>div{height:9px;border-radius:5px;background:rgba(128,128,128,.14);overflow:hidden}',
  '[data-dsh-vaspflow-tool] .vfp-coverage i{display:block;height:100%;border-radius:5px;background:#69a7d5}',
  '[data-dsh-vaspflow-tool] .vfp-coverage strong{text-align:right}',
  '[data-dsh-vaspflow-tool] .vfp-template-group>summary{display:flex;align-items:baseline;gap:12px;min-width:0}',
  '[data-dsh-vaspflow-tool] .vfp-template-group>summary .vfp-tree-muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-dsh-vaspflow-tool] .vfp-discovery-foot{font-size:11px;line-height:1.45;padding:10px 0}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list{max-height:420px;overflow-y:auto;overflow-x:hidden}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-path-tree{max-height:none;overflow:visible}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-path-folder{border:0}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-inspection-item{border-top:0}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-inspection-item>summary{display:flex;align-items:center;gap:9px;min-width:0;min-height:30px;margin:3px 0;padding:4px 8px;border-radius:4px;background:var(--vfp-tree-leaf-bg);cursor:pointer;list-style:none}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list summary::marker{content:""}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list summary::-webkit-details-marker{display:none}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-inspection-item>summary::before{content:"▸";flex:none;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list .vfp-inspection-item[open]>summary::before{content:"▾"}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list summary strong{min-width:0;overflow-wrap:anywhere}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-list summary small{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-state-chip{flex:none;padding:2px 7px;border-radius:10px;background:rgba(128,128,128,.15);font-size:11px}',
  '[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="PASS"],[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="TASK_COMPLETED"]{color:#39ae78;background:rgba(39,157,105,.15)}',
  '[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="FAIL"],[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="ERROR_DETECTED"],[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="error"]{color:#db6962;background:rgba(213,87,80,.15)}',
  '[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="RUNNING"]{color:#69b5e5;background:rgba(85,166,217,.15)}',
  '[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="WARN"],[data-dsh-vaspflow-tool] .vfp-state-chip[data-status="NO_OUTPUT_EVIDENCE"]{color:#d4a64f;background:rgba(217,170,82,.15)}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-scan-bar{margin-top:11px}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-inspection-list summary{flex-wrap:wrap}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix{display:flex;flex:0 0 100%;box-sizing:border-box;min-width:0;max-width:100%;flex-wrap:wrap;gap:5px 12px;padding:0 4px 1px 16px;font-size:12px}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix span{display:inline-flex;align-items:center;gap:4px}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix i{width:7px;height:7px;border-radius:2px;background:#9a91a8}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix [data-check="ok"] i{background:#279d69}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix [data-check="bad"] i{background:#d55750}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix [data-check="warn"] i{background:#d9aa52}',
  '[data-dsh-vaspflow-tool="vasp_check_inputs"] .vfp-check-matrix [data-check="skip"]{opacity:.55}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-detail{padding:2px 4px 12px 16px;font-size:12px;line-height:1.55}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-detail>div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px;padding:3px 0;overflow-wrap:anywhere}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-detail b{font-weight:600;color:var(--dsw-alias-label-secondary,#65746b)}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-detail span{grid-column:2}',
  '[data-dsh-vaspflow-tool] .vfp-inspection-detail button{border:0;background:none;padding:4px 0;color:#39ae78;cursor:pointer;font:inherit}',
  '[data-dsh-vaspflow-tool="vasp_say"].vfp-say{font-size:15px;line-height:1.65;white-space:pre-wrap}',
  '[data-chat-flow-kind="tool-call"]:has([data-dsh-vaspflow-tool="vasp_done"][data-complete]){display:none!important}',
  '[data-vfp-work-first]>[data-vfp-work-summary]{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;border:0;border-radius:6px;padding:3px 8px;background:var(--dsw-alias-interactive-bg-hover,rgba(100,120,150,.08));color:var(--dsw-alias-label-secondary,#65746b);text-align:left;font:inherit;font-size:13px;cursor:pointer}',
  '[data-vfp-work-first]>[data-vfp-work-summary]::before{content:"▸";font-size:12px}',
  '[data-vfp-work-first][data-vfp-work-open]>[data-vfp-work-summary]::before{content:"▾"}',
  '[data-vfp-work-first]:not([data-vfp-work-open])>:not([data-vfp-work-summary]),[data-vfp-work-member]{display:none!important}',
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

const inject = ['slots', 'workspaces'];

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
type BuildAction = { at: number; text: string };
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

type BuildTreeNode = { name: string; path: string; indices: number[]; taskIndices: number[]; children: Map<string, BuildTreeNode> };

function buildTaskTree(tasks: BuildTask[]): BuildTreeNode {
  const root: BuildTreeNode = { name: '', path: '', indices: [], taskIndices: [], children: new Map() };
  tasks.forEach((task, index) => {
    const parts = (task.dir || `任务 ${index + 1}`).split(/[\\/]+/).filter(Boolean);
    if (!parts.length) parts.push('.');
    let node = root;
    for (const name of parts) {
      if (!node.children.has(name)) node.children.set(name, { name, path: [node.path, name].filter(Boolean).join('/'), indices: [], taskIndices: [], children: new Map() });
      node = node.children.get(name)!;
      node.indices.push(index);
    }
    node.taskIndices.push(index);
  });
  return root;
}

function BuildInputsToolRow({ block }: { block: any }) {
  const { collapsed, setCardCollapsed } = useToolCardCollapse(block, 'vasp_build_inputs');
  const { buildDryRun, buildModeError } = usePanelStore();
  const args = React.useMemo(() => parseToolArgs(block), [block]);
  const settled = block?.kind === 'tool-result';
  const originalPreview = React.useMemo(() => parseBuildResult(block), [block]);
  const [revision, setRevision] = React.useState<{ tasks: BuildTask[]; preview: BuildResult } | null>(() => {
    if (!originalPreview.planId) return null;
    try {
      const saved = sessionStorage.getItem(`dsh-vaspflow:build-repreview:${originalPreview.planId}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const historyKey = originalPreview.planId ? `dsh-vaspflow:build-history:${originalPreview.planId}` : '';
  const [history, setHistory] = React.useState<BuildAction[]>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(historyKey) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const historyRef = React.useRef(history);
  const recordAction = (text: string) => {
    const next = [...historyRef.current, { at: Date.now(), text }].slice(-20);
    historyRef.current = next;
    setHistory(next);
    if (historyKey) try { sessionStorage.setItem(historyKey, JSON.stringify(next)); } catch { /* current view keeps the record */ }
  };
  const tasks = revision?.tasks ?? (Array.isArray(args.tasks) ? args.tasks : []);
  const preview = revision?.preview ?? originalPreview;
  const [selectedState, setSelected] = React.useState<Set<number>>(() => new Set(tasks.map((_, index) => index)));
  const [focused, setFocused] = React.useState<number | null>(null);
  const [openDirectory, setOpenDirectory] = React.useState('');
  const [rootOpen, setRootOpen] = React.useState(true);
  const [phaseState, setPhase] = React.useState<'preview' | 'building' | BuildOutcome['phase']>('preview');
  const [writeRowsState, setWriteRows] = React.useState<Record<number, BuildRow>>({});
  const [messageState, setMessage] = React.useState('');
  const [requestErrorState, setRequestError] = React.useState(false);
  const [dropBusy, setDropBusy] = React.useState<number | null>(null);
  const [dropActive, setDropActive] = React.useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = React.useState(false);
  const saved = React.useSyncExternalStore<BuildOutcome | null>(subscribeBuildOutcomes, () => readBuildOutcome(preview.planId), () => null);
  const selected: Set<number> = saved ? new Set<number>(saved.selectedIndices) : selectedState;
  const phase = saved?.phase ?? phaseState;
  const writeRows = saved?.writeRows ?? writeRowsState;
  const message = messageState || saved?.message || '';
  const requestError = messageState ? requestErrorState : saved?.requestError ?? requestErrorState;
  const directMode = buildDryRun === false;
  const submitLock = React.useRef(false);
  const isPreview = preview.dryRun !== false;
  const taskTree = buildTaskTree(tasks);
  const canConfirm = settled && isPreview && !!preview.planId && !preview.error && !buildModeError && phase === 'preview' && dropBusy === null && !cancelBusy;
  const selectedIndices = [...selected].sort((a, b) => a - b);
  const selectedErrors = selectedIndices.filter((index) => preview.results?.[index]?.errors?.length).length;
  const writtenCount = phase === 'done' ? selectedIndices.filter((index) => writeRows[index]?.wrote).length : preview.wroteCount ?? 0;
  const writeErrors = phase === 'done' ? selectedIndices.filter((index) => writeRows[index]?.errors?.length).length : selectedErrors;
  const sourceChanges = tasks.flatMap((task, index) => {
    const before = originalPreview.results?.[index]?.sources ?? {};
    const after = preview.results?.[index]?.sources ?? {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((file) => before[file] !== after[file])
      .map((file) => ({ dir: task.dir, file, before: before[file], after: after[file] }));
  });

  const replaceSource = async (event: React.DragEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(null);
    const item = readStructureDrag(event.dataTransfer);
    if (!item || !canConfirm || submitLock.current) return;
    submitLock.current = true;
    setDropBusy(index);
    setMessage('正在重新生成预览…');
    setRequestError(false);
    try {
      const response = await fetch('/plugins/dsh-vaspflow/build-inputs/repreview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: preview.planId, taskIndex: index, sourceKind: item.kind === 'file' ? 'structure' : 'template', rootPath: item.rootPath, relPath: item.relPath, file: item.file }),
      });
      const result = await response.json() as BuildResult & { tasks?: BuildTask[] };
      if (!response.ok || !result.tasks) throw new Error(result.error || '预览更新失败');
      const next = { tasks: result.tasks, preview: result };
      setRevision(next);
      try { sessionStorage.setItem(`dsh-vaspflow:build-repreview:${preview.planId}`, JSON.stringify(next)); } catch { /* current view remains valid */ }
      const sourceName = item.kind === 'file' ? item.file : item.relPath;
      setMessage(`任务 ${tasks[index].dir} 已改用 ${sourceName}；预览已更新，尚未写入磁盘`);
      recordAction(`${tasks[index].dir}：${item.kind === 'file' ? 'POSCAR' : 'INCAR/KPOINTS/POTCAR'} 来源改为 ${sourceName}，预览已更新`);
      if (focused === index) panelStore.setSelectedBuildTask({ task: result.tasks[index], result: result.results?.[index], projectRoot: result.projectRoot || args.projectRoot || '', linkPotcar: !!args.linkPotcar, phase: 'preview' });
    } catch (caught) {
      setRequestError(true);
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      submitLock.current = false;
      setDropBusy(null);
    }
  };

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
      recordAction(nextMessage);
      if (focused !== null) showTask(focused, rows[focused], selected.has(focused) ? 'done' : 'preview');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      saveBuildOutcome(preview.planId, { phase: 'unavailable', selectedIndices, writeRows: {}, message: nextMessage, requestError: true });
      setPhase('unavailable');
      setRequestError(true);
      setMessage(nextMessage);
    }
  };
  const cancelPreview = async () => {
    if (!settled || !isPreview || !preview.planId || phase !== 'preview' || submitLock.current) return;
    submitLock.current = true;
    setCancelBusy(true);
    setMessage('正在取消预览…');
    setRequestError(false);
    try {
      const response = await fetch('/plugins/dsh-vaspflow/build-inputs/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: preview.planId, cancel: true }),
      });
      const result = await response.json();
      if (!response.ok || !result.cancelled) throw new Error(result.error || '取消预览失败');
      saveBuildOutcome(preview.planId, { phase: 'cancelled', selectedIndices, writeRows: {}, message: '预览已取消，未写入文件', requestError: false });
      setPhase('cancelled');
      setMessage('预览已取消，未写入文件');
      recordAction('预览已取消，未写入文件');
    } catch (error) {
      setRequestError(true);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCancelBusy(false);
      submitLock.current = false;
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
  const renderTaskRow = (index: number, name: string) => {
    const row = writeRows[index] ?? preview.results?.[index];
    const status = row?.errors?.length ? 'error' : row?.warnings?.length ? 'warn' : 'ok';
    const label = !settled ? '处理中' : status === 'error' ? '错误' : row?.wrote ? '已写入' : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '待核查' : phase === 'done' && selected.has(index) ? '未写入' : status === 'warn' ? '需注意' : isPreview ? '可构建' : '完成';
    return <div className="vfp-tree-task" data-selected={focused === index ? '' : undefined} data-drop-active={dropActive === index ? '' : undefined} title={canConfirm ? '拖入结构文件替换 POSCAR 来源；拖入含 INCAR 的目录替换模板来源并重算预览' : tasks[index].dir}
      onDragOver={(event) => { if (canConfirm && Array.from(event.dataTransfer.types).includes(STRUCTURE_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDropActive(index); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(null); }}
      onDrop={(event) => { void replaceSource(event, index); }} draggable={!!row?.wrote}
      onDragStart={(event) => { if (row?.wrote) startStructureDrag(event.dataTransfer, { kind: 'task', rootPath: preview.projectRoot || args.projectRoot || '', relPath: tasks[index].dir || '.' }); }}>
      {canConfirm && <input type="checkbox" aria-label={`选择 ${tasks[index].dir || `任务 ${index + 1}`}`} checked={selected.has(index)} onChange={(event) => setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(index); else next.delete(index); return next; })} />}
      <button type="button" className="vfp-tree-open" onClick={() => showTask(index)} aria-label={`在右侧查看 ${tasks[index].dir || `任务 ${index + 1}`} 详情`}><span className="vfp-tree-name">{name}</span><span className="vfp-tree-status" data-status={status}>{dropBusy === index ? '重算预览' : label}</span><span aria-hidden="true">›</span></button>
    </div>;
  };
  const renderNode = (node: BuildTreeNode): React.ReactNode => {
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!children.length) return node.taskIndices.map((index) => <div className="vfp-path-leaf" key={`${node.path}-${index}`}>{renderTaskRow(index, node.name)}</div>);
    const isOpen = openDirectory === node.path || openDirectory.startsWith(`${node.path}/`);
    return <div className="vfp-build-folder vfp-path-folder" key={node.path}>
      <div className="vfp-tree-group" title={node.path}>
        <button type="button" className="vfp-tree-toggle" aria-label={`${isOpen ? '收起' : '展开'} ${node.path}`} aria-expanded={isOpen} onClick={(event) => { setOpenDirectory(isOpen ? node.path.split('/').slice(0, -1).join('/') : node.path); if (!isOpen) scrollExpandedTreeRow(event.currentTarget.parentElement); }}>{isOpen ? '▾' : '▸'}</button>
        {canConfirm && <input type="checkbox" aria-label={`选择 ${node.path} 下全部任务`} checked={node.indices.every((index) => selected.has(index))} ref={(input) => { if (input) input.indeterminate = node.indices.some((index) => selected.has(index)) && !node.indices.every((index) => selected.has(index)); }} onChange={(event) => setSelected((old) => { const next = new Set(old); node.indices.forEach((index) => event.target.checked ? next.add(index) : next.delete(index)); return next; })} />}
        <span>{node.name}</span><span className="vfp-tree-muted">{node.indices.length}</span>
      </div>
      {isOpen && <div className="vfp-path-children">
        {node.taskIndices.map((index) => <div className="vfp-path-leaf" key={`${node.path}-${index}`}>{renderTaskRow(index, '本目录')}</div>)}
        {children.map(renderNode)}
      </div>}
    </div>;
  };
  return (
    <div data-dsh-vaspflow-tool="vasp_build_inputs">
      <div className="vfp-tree-head"><button type="button" className="vfp-card-toggle" aria-expanded={!collapsed} onClick={() => setCardCollapsed(!collapsed)}><span aria-hidden="true">{collapsed ? '▸' : '▾'}</span><strong>构建任务</strong></button><span className="vfp-tree-muted">{!settled ? '处理中' : phase === 'done' ? `已写入 ${writtenCount}/${selectedIndices.length}` : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '不可确认' : isPreview ? '待确认预览' : `已写入 ${writtenCount}/${tasks.length}`} · {tasks.length} 个任务{writeErrors ? ` · ${writeErrors} 错误` : ''}</span></div>
      <div hidden={collapsed}>
      {(preview.projectRoot || args.projectRoot) && <div className="vfp-scan-path"><code>{preview.projectRoot || args.projectRoot}</code></div>}
      {settled && tasks.length > 0 && <div className="vfp-build-steps" aria-label="构建进度">
        {isPreview ? <>
          <span data-stage="done">① 预览已生成</span>
          <span data-stage={phase === 'preview' ? 'current' : phase === 'building' || phase === 'done' ? 'done' : 'stopped'}>② {phase === 'preview' ? '等待确认' : phase === 'building' || phase === 'done' ? '已确认' : phase === 'cancelled' ? '已取消' : '确认状态待核查'}</span>
          <span data-stage={phase === 'done' ? 'done' : phase === 'building' ? 'current' : phase === 'unavailable' ? 'stopped' : 'pending'}>③ {phase === 'done' ? `已写入 ${writtenCount}/${selectedIndices.length}` : phase === 'building' ? '正在写入' : phase === 'unavailable' ? '写入状态待核查' : '尚未写入'}</span>
        </> : <><span data-stage="done">AI 直接构建</span><span data-stage="done">已写入 {writtenCount}/{tasks.length}</span></>}
      </div>}
      {(sourceChanges.length > 0 || history.length > 0) && <details className="vfp-build-changes"><summary>操作记录 · {history.length} 条{sourceChanges.length ? ` · ${sourceChanges.length} 个来源变化` : ''}</summary>{sourceChanges.map((change, index) => <div key={`${change.dir}-${change.file}-${index}`}><strong>{change.dir} / {change.file}</strong><span title={change.before || ''}>{change.before || '未指定'}</span><span aria-hidden="true">→</span><span title={change.after || ''}>{change.after || '未指定'}</span></div>)}{history.map((action, index) => <p key={`${action.at}-${index}`}><time>{new Date(action.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>{action.text}</p>)}</details>}
      <div className="vfp-build-tree vfp-path-tree"><details className="vfp-path-root vfp-path-folder" open={rootOpen}>
        <summary onClick={(event) => { event.preventDefault(); if (rootOpen) setOpenDirectory(''); else scrollExpandedTreeRow(event.currentTarget); setRootOpen(!rootOpen); }}><span>根目录</span><small>{tasks.length}</small></summary>
        <div className="vfp-path-children">{[...taskTree.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(renderNode)}</div>
      </details></div>
      {tasks.length === 0 && <div className="vfp-tree-message">没有构建任务</div>}
      {isPreview && tasks.length > 0 && <div className="vfp-tree-actions"><span>{selected.size} 个任务已选中{selectedErrors ? ` · ${selectedErrors} 个任务存在错误` : ''}</span><span>
        {phase === 'preview' && <button type="button" disabled={cancelBusy} onClick={() => { void cancelPreview(); }}>{cancelBusy ? '正在取消…' : '取消预览'}</button>}
        {phase === 'preview' && <button type="button" disabled={!canConfirm || selected.size === 0 || selectedErrors > 0} title="执行本次所选任务，并让后续 AI 调用直接构建" onClick={() => { void confirm(true); }}>交给 AI 直接构建</button>}
        <button type="button" className="vfp-tree-confirm" disabled={!canConfirm || selected.size === 0 || selectedErrors > 0} onClick={() => { void confirm(); }}>{phase === 'building' ? '正在构建…' : phase === 'done' ? '已完成' : phase === 'cancelled' ? '已取消' : phase === 'unavailable' ? '不可确认' : `确认构建 ${selected.size} 个任务`}</button>
      </span></div>}
      {directMode && settled && <div className="vfp-tree-actions"><span className="vfp-tree-muted">后续 AI 调用将直接构建</span><button type="button" onClick={() => { void restorePreview(); }}>恢复预览确认</button></div>}
      {preview.error && <div className="vfp-tree-message" data-error="">{preview.error}</div>}
      {buildModeError && <div className="vfp-tree-message" data-error="">{buildModeError}</div>}
      {settled && isPreview && !preview.planId && !preview.error && <div className="vfp-tree-message">此预览缺少确认凭据，请在对话中重新运行预览。</div>}
      {message && <div className="vfp-tree-message" data-error={requestError ? '' : undefined}>{message}</div>}
      </div>
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
    for (const toolName of ['vasp_scan', 'vasp_inspect_task', 'vasp_inspect_tasks', 'vasp_convergence', 'vasp_structure_scene', 'vasp_discover_inputs', 'vasp_check_inputs', 'vasp_say', 'vasp_done']) {
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
    disposers.push(mountWorkCollapse());
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
