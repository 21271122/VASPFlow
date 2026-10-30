/** Presentation shared by the dock and conversation cards; host theme stays authoritative. */
export const PRESENTATION_CSS = `
[data-dsh-vaspflow-panel], [data-dsh-vaspflow-tool], .vaspflow-task-popover {
  --vfp-surface: var(--dsw-alias-bg-base, #fff);
  --vfp-soft: var(--dsw-alias-bg-elevated, #f5f7fa);
  --vfp-text: var(--dsw-alias-label-primary, #243247);
  --vfp-muted: var(--dsw-alias-label-secondary, #66758a);
  --vfp-line: var(--dsw-alias-border-l2, #e2e7ee);
  --vfp-accent: #396bd7;
  --vfp-selected: #edf3ff;
  --vfp-success: #23836a;
  --vfp-warning: #956817;
  --vfp-error: #bc505b;
}
body[data-ds-dark-theme] [data-dsh-vaspflow-panel],
body[data-ds-dark-theme] [data-dsh-vaspflow-tool],
body[data-ds-dark-theme] .vaspflow-task-popover {
  --vfp-soft: var(--dsw-alias-bg-elevated, #263143);
  --vfp-accent: #99baff;
  --vfp-selected: #283957;
  --vfp-success: #89d5b9;
  --vfp-warning: #edc783;
  --vfp-error: #ef9fa7;
}
.vfp-panel { display:flex; flex-direction:column; height:100%; min-height:0; position:relative; color:var(--vfp-text); container:vfp-panel / inline-size; }
.vfp-panel-header { flex:none; padding:10px 16px 12px; border-bottom:1px solid var(--vfp-line); }
.vfp-panel-brand { display:flex; align-items:center; gap:12px; margin-bottom:8px; font-size:13px; font-weight:500; color:var(--vfp-muted); }
.vfp-panel-brand > span { flex:none; }
.vfp-panel-brand > .ant-btn { margin-left:auto; flex:none; }
.vfp-header-statistics { display:flex; flex:1; min-width:0; align-items:center; flex-wrap:wrap; gap:0 8px; font-size:11px; }
.vfp-project-controls { display:flex; align-items:center; gap:6px; min-width:0; }
.vfp-workspace-picker { width:90px; flex:none; }
.vfp-stat-states { display:flex; align-items:center; gap:2px; flex-wrap:wrap; flex-basis:100%; order:1; }
.vfp-stat-total { font-weight:500; white-space:nowrap; }
.vfp-stat-directory { color:var(--vfp-muted); white-space:nowrap; }
.vfp-scan-progress { flex-basis:100%; color:var(--vfp-accent); font-size:11px; }
[data-dsh-vaspflow-panel] .vfp-stat-filter.ant-btn { height:24px; min-height:24px; padding:0 4px; font-size:11px!important; border-radius:4px; }
[data-dsh-vaspflow-panel] .vfp-stat-filter[aria-pressed="false"] { color:var(--vfp-muted)!important; }
[data-dsh-vaspflow-panel] .vfp-stat-filter[data-status="ERROR_DETECTED"]:not([data-count="0"]) { color:var(--vfp-error)!important; }
.vfp-stat-filter[aria-pressed="true"] { background:var(--vfp-selected); box-shadow:inset 0 0 0 1px var(--vfp-line); }
[data-dsh-vaspflow-panel] .vfp-task-list-trigger.ant-btn { margin-left:auto; font-size:11px!important; height:26px; min-height:26px; padding:0 7px; border-color:transparent; box-shadow:none; color:var(--vfp-muted); background:transparent; }
.vfp-panel-body { flex:1; min-height:0; display:flex; flex-direction:column; padding:22px 20px 12px; overflow:auto; }
.vfp-panel-body-build { display:block; }
.vfp-task-summary { flex:none; margin-bottom:4px; }
.vfp-task-overview { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,340px) auto; align-items:center; gap:16px; margin-bottom:14px; }
.vfp-task-identity { min-width:0; }
.vfp-task-status { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.vfp-task-navigation-standby { display:flex; justify-content:flex-end; flex:none; margin-bottom:8px; }
.vfp-task-title { display:flex; align-items:center; gap:8px; min-width:0; }
.vfp-task-status .ant-tag:not(.ant-tag-red) { color:var(--vfp-muted); background:transparent; border-color:transparent; }
[data-dsh-vaspflow-panel] .vfp-task-status .ant-tag { font-size:11px!important; }
.vfp-task-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:18px; cursor:grab; }
.vfp-task-name .ant-typography { font-size:inherit; }
.vfp-task-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vfp-muted); font:10px/1.6 Consolas,monospace; margin-bottom:6px; }
.vfp-task-facts { display:grid; grid-template-columns:minmax(0,.8fr) minmax(0,1.3fr); gap:8px 16px; }
.vfp-task-facts > div { display:flex; align-items:baseline; gap:6px; min-width:0; max-width:100%; }
.vfp-task-facts span { flex:none; color:var(--vfp-muted); font-size:11px; }
.vfp-task-facts strong { font-size:12px; font-weight:400; overflow-wrap:anywhere; }
.vfp-task-facts .vfp-number { font:12px/1.5 Consolas,monospace; font-variant-numeric:tabular-nums; }
.vfp-task-facts small { color:var(--vfp-muted); font:11px sans-serif; }
.vfp-task-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:7px; }
.vfp-task-actions > .ant-dropdown-button { width:auto; }
[data-dsh-vaspflow-panel] .vfp-task-actions .ant-btn { border-color:var(--vfp-line); background:transparent; box-shadow:none; font-size:12px!important; color:var(--vfp-muted); }
[data-dsh-vaspflow-panel] .vfp-task-actions .ant-btn:hover { color:var(--vfp-accent); }
.vfp-detail-tabs { flex:1; min-height:240px; }
.vfp-detail-tabs > .ant-tabs-nav { flex:none; margin-bottom:12px; }
.vfp-detail-tabs > .ant-tabs-nav .ant-tabs-tab { padding:9px 0; }
.vfp-detail-tabs > .ant-tabs-content-holder { display:flex; min-height:0; }
.vfp-detail-tabs > .ant-tabs-content-holder > .ant-tabs-content { flex:1; min-height:0; height:100%; }
.vfp-detail-tabs > .ant-tabs-content-holder > .ant-tabs-content > .ant-tabs-tabpane-active { display:flex; flex-direction:column; height:100%; min-height:0; overflow:auto; }
.vfp-convergence { min-width:0; }
.vfp-convergence-source { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; font-size:10px; line-height:1.6; color:var(--vfp-muted, var(--dsw-alias-label-secondary, #66758a)); }
.vfp-convergence-controls { display:flex; align-items:center; gap:8px; margin:4px 0 12px; font-size:11px; color:var(--vfp-muted, var(--dsw-alias-label-secondary, #66758a)); }
.vfp-convergence-plot { width:100%; height:340px; }
.vfp-convergence-plot > .recharts-responsive-container { display:block; }
.vfp-convergence-plot .recharts-wrapper > .recharts-surface { display:block; }
[data-dsh-vaspflow-panel] .vfp-convergence { display:flex; flex-direction:column; flex:1; min-height:0; }
[data-dsh-vaspflow-panel] .vfp-convergence-source { order:1; margin-top:12px; flex:none; }
[data-dsh-vaspflow-panel] .vfp-convergence-controls { flex:none; }
[data-dsh-vaspflow-panel] .vfp-convergence-plot { flex:1; min-height:170px; height:0; }
[data-dsh-vaspflow-panel] .vfp-structure-viewer { flex:1; min-height:240px; }
[data-dsh-vaspflow-panel] .vfp-structure-viewer > [data-vasp-structure-mount] { flex:1; min-height:130px; height:0!important; }
[data-dsh-vaspflow-panel] .vfp-structure-viewer > :not([data-vasp-structure-mount]) { flex:none; }
.vfp-structure-toolbar .ant-tabs-nav { margin-bottom:4px; }
.vfp-task-popup { width:min(380px,calc(100vw - 32px)); display:flex; flex-direction:column; gap:8px; }
.vfp-task-search { display:flex; min-width:0; }
.vfp-task-filters { display:flex; align-items:center; gap:6px; }
.vfp-task-filters .ant-segmented { margin-left:auto; }
.vfp-task-popup-list { max-height:min(55vh,480px); overflow:auto; min-height:120px; }
.vaspflow-task-popover .ant-popover-inner { padding:12px!important; border-color:var(--vfp-line); box-shadow:0 12px 36px rgba(24,40,66,.14); }
[data-dsh-vaspflow-panel] .ant-tree-node-content-wrapper, .vaspflow-task-popover .ant-tree-node-content-wrapper { min-height:24px!important; line-height:24px!important; border-radius:4px; }
[data-dsh-vaspflow-panel] .ant-tree-title, .vaspflow-task-popover .ant-tree-title { font-size:12px!important; }
.vaspflow-task-popover .ant-input-affix-wrapper, .vaspflow-task-popover .ant-select-selector, .vaspflow-task-popover .ant-segmented { font-size:12px!important; }
.vfp-status-evidence { font-size:13px; line-height:1.6; display:flex; flex-direction:column; gap:12px; padding-top:4px; }
.vfp-status-card { padding:12px 14px; border:1px solid var(--vfp-line); border-left:3px solid; border-radius:7px; background:var(--vfp-soft); }
.vfp-status-card-head { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:6px; }
.vfp-status-card-head .ant-typography { font-size:13px; }
.vfp-status-card-head .ant-typography-secondary { font-size:11px; white-space:nowrap; }
.vfp-status-reason { margin-top:6px; font-size:13px; }
.vfp-status-source { display:block; margin-top:6px; font-size:11px; }
.vfp-status-excerpt { margin-top:7px; padding:8px 10px; color:var(--vfp-text); background:var(--vfp-surface); border:1px solid var(--vfp-line); border-radius:5px; font:12px/1.6 Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
.vfp-status-extra { margin-top:7px; color:var(--vfp-muted); font-size:12px; }
[data-dsh-vaspflow-tool]:not([data-dsh-vaspflow-tool="vasp_say"]):not([data-dsh-vaspflow-tool="vasp_done"]) { border:1px solid var(--vfp-line); border-radius:8px; background:var(--vfp-surface); padding:12px 14px; }
[data-dsh-vaspflow-tool] { --vfp-tree-folder-bg:transparent; --vfp-tree-leaf-bg:transparent; }
body[data-ds-dark-theme] [data-dsh-vaspflow-tool] { --vfp-tree-folder-bg:transparent; --vfp-tree-leaf-bg:transparent; }
[data-dsh-vaspflow-tool] .vfp-tree-task[data-selected], body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-tree-task[data-selected],
[data-dsh-vaspflow-tool] .vfp-inline-tree .vfp-visual-tree-leaf[aria-current="true"] { background:var(--vfp-selected); color:var(--vfp-accent); }
[data-dsh-vaspflow-tool] .vfp-tree-task:hover, [data-dsh-vaspflow-tool] .vfp-result-row:hover { background:var(--vfp-soft); }
[data-dsh-vaspflow-tool] .vfp-tree-head strong { color:var(--vfp-text); font-size:14px; }
body[data-ds-dark-theme] [data-dsh-vaspflow-tool] .vfp-tree-head strong { color:var(--vfp-text); }
[data-dsh-vaspflow-tool] .vfp-tree-group { font-size:12px; }
/* Build inheritance ledger: batch distribution bars + one row per inherited input. */
.vfp-build-inherit-line { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin:6px 0 2px; font-size:11.5px; color:var(--vfp-muted); }
.vfp-build-inherit-template { padding:0 6px; border:1px solid var(--vfp-line); border-radius:8px; background:var(--vfp-soft); color:var(--vfp-text); }
.vfp-build-inherit-exception { padding:0 6px; border:1px solid rgba(149,104,23,.26); border-radius:8px; background:rgba(149,104,23,.12); color:var(--vfp-warning); }
.vfp-build-inherit-missing { padding:0 6px; border:1px dashed var(--vfp-line); border-radius:8px; color:var(--vfp-muted); }
.vfp-inherit-batch { display:grid; gap:7px; margin:10px 0 2px; padding:10px 12px; border:1px solid var(--vfp-line); border-radius:8px; background:var(--vfp-soft); }
.vfp-inherit-batch-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12px; color:var(--vfp-muted); }
.vfp-inherit-templates { display:flex; flex-wrap:wrap; gap:5px; }
.vfp-inherit-templates span { padding:1px 7px; border:1px solid var(--vfp-line); border-radius:9px; background:var(--vfp-surface); color:var(--vfp-text); font-size:11px; white-space:nowrap; }
.vfp-inherit-bars { display:grid; gap:4px; }
.vfp-inherit-bar { display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center; gap:8px; font-size:11px; color:var(--vfp-muted); }
.vfp-inherit-bar-label { color:var(--vfp-text); }
.vfp-inherit-bar-track { display:flex; height:6px; border-radius:3px; overflow:hidden; background:rgba(120,132,150,.18); }
.vfp-inherit-bar-track i { display:block; height:100%; }
.vfp-inherit-bar-track i[data-origin="inherit"] { background:var(--vfp-success); }
.vfp-inherit-bar-track i[data-origin="override"] { background:var(--vfp-warning); }
.vfp-inherit-bar-track i[data-origin="explicit"] { background:var(--vfp-accent); }
.vfp-inherit-bar-track i[data-origin="missing"] { background:rgba(120,132,150,.55); }
.vfp-inherit-bar-count { max-width:52%; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
.vfp-inherit-legend { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; color:var(--vfp-muted); }
.vfp-inherit-legend span::before { content:""; display:inline-block; width:7px; height:7px; margin-right:4px; border-radius:2px; vertical-align:baseline; background:rgba(120,132,150,.55); }
.vfp-inherit-legend span[data-origin="inherit"]::before { background:var(--vfp-success); }
.vfp-inherit-legend span[data-origin="override"]::before { background:var(--vfp-warning); }
.vfp-inherit-legend span[data-origin="explicit"]::before { background:var(--vfp-accent); }
.vfp-inherit-template { display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:baseline; gap:8px; font-size:12px; }
.vfp-inherit-rows { display:grid; gap:1px; margin:2px 0 0; padding:0; list-style:none; }
.vfp-inherit-row { display:grid; grid-template-columns:56px 44px minmax(0,1fr) auto; align-items:baseline; gap:8px; padding:3px 0; border-bottom:1px dashed var(--vfp-line); }
.vfp-inherit-row:last-child { border-bottom:0; }
.vfp-inherit-name { color:var(--vfp-muted); font-size:11px; }
.vfp-inherit-badge { justify-self:start; padding:0 5px; border:1px solid transparent; border-radius:3px; font-size:11px; line-height:16px; white-space:nowrap; }
.vfp-inherit-badge[data-origin="inherit"] { color:var(--vfp-success); background:rgba(35,131,106,.11); border-color:rgba(35,131,106,.24); }
.vfp-inherit-badge[data-origin="override"] { color:var(--vfp-warning); background:rgba(149,104,23,.12); border-color:rgba(149,104,23,.26); }
.vfp-inherit-badge[data-origin="explicit"] { color:var(--vfp-accent); background:rgba(57,107,215,.10); border-color:rgba(57,107,215,.24); }
.vfp-inherit-badge[data-origin="pending"], .vfp-inherit-badge[data-origin="missing"] { color:var(--vfp-muted); background:transparent; border-style:dashed; border-color:var(--vfp-line); }
.vfp-inherit-path { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vfp-text); font:11.5px/1.5 Consolas,"Cascadia Mono",monospace; }
.vfp-inherit-row[data-origin="missing"] .vfp-inherit-path, .vfp-inherit-row[data-origin="pending"] .vfp-inherit-path { color:var(--vfp-muted); }
.vfp-inherit-share { color:var(--vfp-muted); font-size:11px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.vfp-inherit-empty { color:var(--vfp-muted); font-size:12px; }
.vfp-inherit-extras { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:baseline; gap:8px; margin-top:3px; font-size:12px; }
.vfp-inherit-extras code { margin-right:8px; color:var(--vfp-text); }
/* The detail section styles any div holding a <span> as a two-column row; the
   ledger needs its own columns (name / badge / path / share). */
[data-dsh-vaspflow-panel] .vfp-build-detail-section>.vfp-inherit-template,
[data-dsh-vaspflow-panel] .vfp-build-detail-section>.vfp-inherit-extras { grid-template-columns:56px minmax(0,1fr) auto; }
@container vfp-panel (max-width:420px) {
  .vfp-inherit-bar { grid-template-columns:48px minmax(0,1fr); }
  .vfp-inherit-bar-count { grid-column:2; max-width:none; text-align:left; }
  .vfp-inherit-row { grid-template-columns:48px 40px minmax(0,1fr); }
  .vfp-inherit-share { grid-column:3; justify-self:end; }
}
[data-dsh-vaspflow-panel] button:focus-visible, [data-dsh-vaspflow-tool] button:focus-visible { outline:2px solid var(--vfp-accent); outline-offset:2px; }
@media (max-height:740px) {
  .vfp-panel-header { padding-top:7px; padding-bottom:7px; }
  .vfp-panel-brand { margin-bottom:5px; }
  .vfp-panel-body { padding-top:10px; padding-bottom:8px; }
  .vfp-task-facts { gap:5px 16px; }
  .vfp-detail-tabs > .ant-tabs-nav { margin-bottom:8px; }
}
@container vfp-panel (max-width:600px) {
  .vfp-task-overview { grid-template-columns:minmax(0,1fr) auto; gap:10px; }
  .vfp-task-identity { grid-column:1; grid-row:1; }
  .vfp-task-status { grid-column:2; grid-row:1; }
  .vfp-task-facts { grid-column:1 / -1; grid-row:2; }
}
@media (prefers-reduced-motion:reduce) {
  [data-dsh-vaspflow-panel] *, [data-dsh-vaspflow-tool] *, .vaspflow-task-popover * { transition:none!important; animation:none!important; }
}
`;
