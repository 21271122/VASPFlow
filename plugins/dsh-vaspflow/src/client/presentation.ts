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
/* Conversation cards keep the shell's own chrome: no border, background or
   padding here, and the tree keeps its tinted rows. Only the dock uses the
   --vfp-* presentation layer above. */
/* Build inheritance ledger: batch distribution bars + one row per inherited input. */
.vfp-inherit-batch { display:grid; gap:7px; margin:10px 0 2px; padding:10px 12px; border:1px solid var(--vfp-line); border-radius:8px; background:var(--vfp-soft); }
.vfp-inherit-batch-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12px; color:var(--vfp-muted); }
.vfp-inherit-templates { display:flex; flex-wrap:wrap; gap:5px; }
.vfp-inherit-templates span { padding:1px 7px; border:1px solid var(--vfp-line); border-radius:9px; background:var(--vfp-surface); color:var(--vfp-text); font-size:11px; white-space:nowrap; }
.vfp-inherit-bars { display:grid; gap:4px; }
.vfp-inherit-bar { display:grid; grid-template-columns:64px minmax(0,1fr) auto; align-items:center; gap:8px; font-size:11px; color:var(--vfp-muted); }
.vfp-inherit-bar-label { color:var(--vfp-text); }
.vfp-inherit-bar-track { display:flex; height:6px; border-radius:3px; overflow:hidden; background:rgba(120,132,150,.18); }
.vfp-inherit-bar-track i { display:block; height:100%; }
.vfp-inherit-bar-track i[data-origin="inherit"] { background:var(--vfp-success); }
.vfp-inherit-bar-track i[data-origin="override"] { background:var(--vfp-warning); }
.vfp-inherit-bar-track i[data-origin="explicit"] { background:var(--vfp-accent); }
.vfp-inherit-bar-track i[data-origin="missing"] { background:rgba(120,132,150,.55); }
.vfp-inherit-bar-count { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.vfp-inherit-legend { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; color:var(--vfp-muted); }
.vfp-inherit-legend span::before { content:""; display:inline-block; width:7px; height:7px; margin-right:4px; border-radius:2px; vertical-align:baseline; background:rgba(120,132,150,.55); }
.vfp-inherit-legend span[data-origin="inherit"]::before { background:var(--vfp-success); }
.vfp-inherit-legend span[data-origin="override"]::before { background:var(--vfp-warning); }
.vfp-inherit-legend span[data-origin="explicit"]::before { background:var(--vfp-accent); }
.vfp-inherit-template { display:grid; grid-template-columns:64px minmax(0,1fr) auto; align-items:baseline; gap:8px; font-size:12px; }
.vfp-inherit-rows { display:grid; gap:1px; margin:2px 0 0; padding:0; list-style:none; }
.vfp-inherit-row { display:grid; grid-template-columns:64px 44px minmax(0,1fr) auto; align-items:baseline; gap:8px; padding:3px 0; border-bottom:1px dashed var(--vfp-line); }
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
.vfp-inherit-extras { display:grid; grid-template-columns:64px minmax(0,1fr); align-items:baseline; gap:8px; margin-top:3px; font-size:12px; }
.vfp-inherit-extras code { margin-right:8px; color:var(--vfp-text); }
/* Hover drill-down: the two candidate files side by side, then where the
   adopted file lives. */
.vfp-cmp-popover .ant-popover-inner {
  padding:0; border:1px solid var(--vfp-line); border-radius:10px; overflow:hidden;
  box-shadow:0 16px 38px -12px rgba(20,32,52,.28), 0 2px 6px rgba(20,32,52,.06);
  max-height:calc(100vh - 28px);
}
.vfp-cmp-popover .ant-popover-arrow { display:none; }
.vfp-cmp {
  display:grid; gap:12px; width:clamp(420px,46vw,560px); padding:13px 15px;
  max-height:calc(100vh - 20px); overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; font-size:12px;
  scrollbar-width:thin; scrollbar-color:rgba(120,132,150,.38) transparent;
}
.vfp-cmp::-webkit-scrollbar,
.vfp-cmp-side pre::-webkit-scrollbar,
.vfp-cmp-address .ant-tree::-webkit-scrollbar { width:8px; height:8px; }
.vfp-cmp::-webkit-scrollbar-track,
.vfp-cmp-side pre::-webkit-scrollbar-track,
.vfp-cmp-address .ant-tree::-webkit-scrollbar-track { background:transparent; }
.vfp-cmp::-webkit-scrollbar-thumb,
.vfp-cmp-side pre::-webkit-scrollbar-thumb,
.vfp-cmp-address .ant-tree::-webkit-scrollbar-thumb {
  background:rgba(120,132,150,.34); background-clip:padding-box; border:2px solid transparent; border-radius:99px;
}
.vfp-cmp::-webkit-scrollbar-thumb:hover,
.vfp-cmp-side pre::-webkit-scrollbar-thumb:hover,
.vfp-cmp-address .ant-tree::-webkit-scrollbar-thumb:hover { background:rgba(120,132,150,.55); background-clip:padding-box; }
body[data-ds-dark-theme] .vfp-cmp { scrollbar-color:rgba(158,170,188,.42) transparent; }
body[data-ds-dark-theme] .vfp-cmp::-webkit-scrollbar-thumb,
body[data-ds-dark-theme] .vfp-cmp-side pre::-webkit-scrollbar-thumb,
body[data-ds-dark-theme] .vfp-cmp-address .ant-tree::-webkit-scrollbar-thumb { background:rgba(158,170,188,.38); background-clip:padding-box; border:2px solid transparent; }
body[data-ds-dark-theme] .vfp-cmp-side pre { scrollbar-color:rgba(158,170,188,.38) transparent; }
.vfp-cmp-head { display:flex; align-items:center; gap:9px; min-width:0; padding:0 1px 9px; border-bottom:1px solid var(--vfp-line); }
.vfp-cmp-title { flex:none; font-size:13px; font-weight:600; letter-spacing:.01em; color:var(--vfp-text); }
.vfp-cmp-notes { display:flex; align-items:center; gap:7px; flex:1 1 auto; min-width:0; overflow:hidden; }
.vfp-cmp-note { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vfp-muted); font-size:11px; }
.vfp-cmp-chip { flex:none; padding:0 7px; border:1px solid var(--vfp-line); border-radius:99px; background:var(--vfp-surface); color:var(--vfp-muted); font-size:10.5px; line-height:16px; }
.vfp-cmp-same[data-tone="muted"] { color:var(--vfp-muted); }
.vfp-cmp-delta { display:inline-flex; gap:7px; margin-left:7px; font-style:normal; font-variant-numeric:tabular-nums; }
.vfp-cmp-delta b { font-weight:500; }
.vfp-cmp-delta b:first-child { color:var(--vfp-success); }
.vfp-cmp-delta b:last-child { color:var(--vfp-error); }
.vfp-cmp-diff, .vfp-cmp-same { display:inline-flex; align-items:center; gap:5px; flex:none; margin-left:auto; padding:1px 7px; border-radius:99px; font-size:11px; }
.vfp-cmp-diff { background:rgba(196,132,20,.10); }
.vfp-cmp-same { background:rgba(38,146,96,.10); }
.vfp-cmp-diff::before, .vfp-cmp-same::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
.vfp-cmp-diff { color:var(--vfp-warning); }
.vfp-cmp-same { color:var(--vfp-success); }
.vfp-cmp-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; }
.vfp-cmp-grid[data-single] { grid-template-columns:minmax(0,1fr); }
/* Pointer-position scrolling: the pane follows the pointer while it is inside,
   and stops by itself when the pointer leaves. */
.vfp-cmp-side:hover > header { background:var(--vfp-selected); }
.vfp-cmp-side pre { cursor:crosshair; }
.vfp-cmp-side { min-width:0; border:1px solid var(--vfp-line); border-radius:8px; overflow:hidden; background:var(--vfp-surface); }
.vfp-cmp-side>header { display:flex; align-items:center; gap:6px; padding:6px 9px; background:var(--vfp-soft); border-bottom:1px solid var(--vfp-line); }
.vfp-cmp-step { flex:none; padding:0 5px; border:1px solid var(--vfp-line); border-radius:4px; background:var(--vfp-surface); color:var(--vfp-muted); font-size:10.5px; line-height:16px; }
.vfp-cmp-side[data-side="write"] .vfp-cmp-step { color:var(--vfp-accent); border-color:rgba(57,107,215,.34); background:rgba(57,107,215,.08); }
.vfp-cmp-role { flex:none; color:var(--vfp-muted); font-size:11px; }
.vfp-cmp-dir { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; color:var(--vfp-muted); font:10.5px/1.4 Consolas,"Cascadia Mono",monospace; }
.vfp-cmp-side pre {
  margin:0; padding:6px 0; max-height:252px; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable;
  font:11px/1.55 Consolas,"Cascadia Mono",monospace;
  scrollbar-width:thin; scrollbar-color:rgba(120,132,150,.32) transparent;
}
.vfp-cmp-line { display:block; padding:0 9px; white-space:pre; }
.vfp-cmp-line i { display:inline-block; width:24px; margin-right:8px; color:var(--vfp-muted); opacity:.72; font-style:normal; text-align:right; user-select:none; font-variant-numeric:tabular-nums; }
.vfp-cmp-line[data-changed] { background:rgba(149,104,23,.13); box-shadow:inset 2px 0 0 var(--vfp-warning); }
.vfp-cmp-line[data-changed] i { opacity:1; color:var(--vfp-warning); }
.vfp-cmp-empty { padding:16px 10px; text-align:center; color:var(--vfp-muted); font-size:11.5px; }
.vfp-cmp-empty[data-error] { color:var(--vfp-warning); }
.vfp-cmp-side[data-loading] { min-height:214px; }
.vfp-cmp-side[data-loading] .vfp-cmp-empty { padding:0; height:212px; display:flex; align-items:center; justify-content:center; }
.vfp-cmp-more { padding:5px 9px 6px; color:var(--vfp-muted); font-size:11px; border-top:1px dashed var(--vfp-line); }
.vfp-cmp-address { border-top:1px solid var(--vfp-line); padding-top:9px; }
.vfp-cmp-address-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; color:var(--vfp-muted); font-size:11px; }
.vfp-cmp-address .ant-tree { max-height:200px; overflow:auto; overscroll-behavior:contain; background:transparent; }
.vfp-cmp-address .ant-tree-list, .vfp-cmp-address .ant-tree-list-holder-inner { background:transparent; }
/* Same tree language as the task list, at popover scale. */
.vfp-cmp-address .ant-tree .ant-tree-treenode { padding:0!important; line-height:22px; }
.vfp-cmp-address .ant-tree-indent-unit { width:10px!important; }
.vfp-cmp-address .ant-tree-switcher { width:12px!important; margin-right:0!important; }
.vfp-cmp-address .ant-tree-title { font-size:12px!important; }
.vfp-cmp-address .ant-tree-iconEle { color:var(--vfp-muted); }
.vfp-cmp-address .ant-tree-node-content-wrapper { padding:0 4px!important; min-height:22px!important; line-height:22px!important; border-radius:4px; }
.vfp-cmp-address .ant-tree-node-content-wrapper:hover { background:var(--vfp-soft); }
.vfp-cmp-file { color:var(--vfp-text); font-weight:500; }
.vfp-cmp-ellipsis { color:var(--vfp-muted); }
/* Batch source view: file type → source file node → task nodes. */
.vfp-batch-popover .ant-popover-inner { width:auto; max-width:none; }
.vfp-batch { display:grid; grid-template-columns:minmax(0,1fr); gap:10px; box-sizing:border-box; max-height:min(86vh,820px); overflow:auto; overscroll-behavior:contain; padding:13px 15px; font-size:12px; scrollbar-width:thin; scrollbar-color:rgba(120,132,150,.38) transparent; }
.vfp-batch::-webkit-scrollbar { width:8px; }
.vfp-batch::-webkit-scrollbar-thumb { background:rgba(120,132,150,.34); border-radius:99px; }
.vfp-batch-head { display:flex; align-items:baseline; gap:8px; padding-bottom:9px; border-bottom:1px solid var(--vfp-line); }
.vfp-batch-head strong { font-size:13px; }
.vfp-batch-body { display:grid; grid-template-columns:minmax(0,1fr); gap:6px; min-width:0; }
.vfp-batch-group { min-width:0; border:1px solid var(--vfp-line); border-radius:8px; overflow:hidden; }
.vfp-batch-group-head { display:flex; align-items:center; gap:6px; padding:3px 6px 3px 3px; background:var(--vfp-soft); }
.vfp-batch-group-toggle { display:flex; align-items:center; gap:8px; flex:1 1 auto; min-width:0; padding:5px 6px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; cursor:pointer; text-align:left; }
.vfp-batch-group-toggle:hover { background:var(--vfp-surface); }
.vfp-batch-group-toggle strong { font-size:12px; }
.vfp-batch-group-toggle .vfp-cmp-note { margin-left:auto; }
.vfp-batch-dirbutton { flex:none; padding:2px 9px; border:1px solid var(--vfp-line); border-radius:99px; background:var(--vfp-surface); color:var(--vfp-muted); font:inherit; font-size:11px; line-height:16px; cursor:pointer; }
.vfp-batch-dirbutton:hover { color:var(--vfp-text); }
.vfp-batch-dirbutton[aria-pressed="true"] { color:var(--vfp-accent); border-color:rgba(57,107,215,.42); background:rgba(57,107,215,.09); }
.vfp-batch-missing { color:var(--vfp-warning); font-size:11px; }
.vfp-batch-tree { display:grid; grid-template-columns:minmax(0,1fr); gap:7px; min-width:0; padding:9px 10px 10px; }
.vfp-batch-source { display:flex; flex-direction:column; align-items:flex-start; gap:6px; min-width:0; max-width:100%; overflow:hidden; }
.vfp-batch-source + .vfp-batch-source { margin-top:12px; padding-top:12px; border-top:1px dashed var(--vfp-line); }
.vfp-batch-node { display:flex; align-items:center; gap:6px; min-width:0; }
.vfp-batch-root { display:inline-flex; align-self:flex-start; max-width:100%; padding:4px 7px; border:1px solid var(--vfp-line); border-radius:6px; background:var(--vfp-surface); }
.vfp-batch-dot { width:7px; height:7px; border-radius:50%; background:var(--vfp-accent); flex:none; }
.vfp-batch-path-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:11px/1.5 Consolas,"Cascadia Mono",monospace; color:var(--vfp-text); }
.vfp-batch-count { margin-left:auto; color:var(--vfp-muted); font-size:11px; font-variant-numeric:tabular-nums; }
.vfp-batch-children { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:8px; box-sizing:border-box; width:100%; margin:0; padding:0 0 2px; list-style:none; }

.vfp-batch-children li::before { content:none; }
.vfp-batch-task { width:100%; padding:2px 6px; border:0; border-radius:4px; background:transparent; color:inherit; font:inherit; cursor:pointer; text-align:left; }
.vfp-batch-task:hover { background:var(--vfp-soft); }
.vfp-batch-task[data-active] { background:var(--vfp-selected); }
.vfp-batch-name { flex:none; font-weight:500; }
.vfp-batch-branch { display:none; }
.vfp-batch-dir { margin-left:auto; flex:none; color:var(--vfp-muted); font-size:10.5px; font-variant-numeric:tabular-nums; }
/* Directory graph: one node per folder, edges are nesting. */
.vfp-dirtree { margin:2px 0 4px; padding:10px 12px 12px; border:1px solid var(--vfp-line); border-radius:8px; background:var(--vfp-surface); }
.vfp-dirtree-head { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
.vfp-dirtree-head strong { font-size:12px; }
.vfp-dirtree-legend { display:flex; align-items:center; gap:5px; margin-left:auto; color:var(--vfp-muted); font-size:10.5px; }
.vfp-dirtree-legend i { width:7px; height:7px; border-radius:50%; display:inline-block; }
.vfp-dirtree-legend i[data-kind="template"] { background:var(--vfp-warning); }
.vfp-dirtree-legend i[data-kind="task"] { margin-left:9px; background:var(--vfp-accent); }
.vfp-dirtree-legend i[data-kind="plain"] { margin-left:9px; background:var(--vfp-line); }
.vfp-dirtree ul { margin:0; padding:0 0 0 15px; list-style:none; }
.vfp-dirtree-root { padding-left:0; }
.vfp-dir-item { position:relative; padding:1px 0 1px 14px; }
.vfp-dirtree ul ul > .vfp-dir-item::before { content:""; position:absolute; left:0; top:0; bottom:0; border-left:1px solid var(--vfp-line); }
.vfp-dirtree ul ul > .vfp-dir-item:last-child::before { bottom:auto; height:13px; }
.vfp-dirtree ul ul > .vfp-dir-item::after { content:""; position:absolute; left:0; top:13px; width:9px; border-top:1px solid var(--vfp-line); }
.vfp-dir-label { display:inline-flex; align-items:center; gap:7px; font:12px/1.65 Consolas,"Cascadia Mono",monospace; color:var(--vfp-text); }
.vfp-dir-dot { flex:none; width:7px; height:7px; border-radius:50%; background:var(--vfp-line); }
.vfp-dir-item[data-kind="template"] .vfp-dir-dot { background:var(--vfp-warning); }
.vfp-dir-item[data-kind="task"] .vfp-dir-dot { background:var(--vfp-accent); }
.vfp-dir-item[data-kind="both"] .vfp-dir-dot { background:linear-gradient(90deg,var(--vfp-warning) 50%,var(--vfp-accent) 50%); }
.vfp-dir-item[data-kind="template"] > .vfp-dir-label b { color:var(--vfp-warning); font-weight:600; }
.vfp-dir-item[data-kind="task"] > .vfp-dir-label b,
.vfp-dir-item[data-kind="both"] > .vfp-dir-label b { color:var(--vfp-accent); font-weight:600; }
.vfp-dir-item[data-kind="plain"] > .vfp-dir-label b { color:var(--vfp-text); font-weight:400; }
.vfp-dir-tag { padding:0 6px; border-radius:99px; font-style:normal; font-size:10px; line-height:15px; color:var(--vfp-warning); background:rgba(196,132,20,.13); }
.vfp-dir-item[data-kind="task"] .vfp-dir-tag,
.vfp-dir-item[data-kind="both"] .vfp-dir-tag { color:var(--vfp-accent); background:rgba(57,107,215,.11); }
.vfp-batch-missing-row { color:var(--vfp-warning); font-size:11px; }
.vfp-batch-source > .vfp-cmp, .vfp-batch-source > .vfp-cmp[data-compact] { width:190px; max-width:190px; margin:0; padding:8px 9px 9px; border:1px solid var(--vfp-line); border-radius:10px; background:var(--vfp-soft); box-shadow:0 1px 2px rgba(16,24,40,.05); }
/* The template is the first tile of the row, so a 1:1 batch reads as
   template → task pairs instead of a tall centred column. */
.vfp-batch-leaf-source { flex:0 0 190px; }\n.vfp-batch-leaf-source .vfp-cmp { border-color:rgba(196,132,20,.34); background:rgba(196,132,20,.055); }
.vfp-batch-leaf-source .vfp-cmp-step { border-color:transparent; background:rgba(196,132,20,.14); color:var(--vfp-warning); }
.vfp-batch-leaf { margin:0; }
.vfp-batch-leaf { flex:0 0 190px; min-width:190px; }\n.vfp-batch-leaf .vfp-cmp { width:100%; max-height:none; overflow:visible; gap:7px; padding:8px 9px 9px; border:1px solid var(--vfp-line); border-radius:10px; background:var(--vfp-surface); box-shadow:0 1px 2px rgba(16,24,40,.05); }
.vfp-cmp[data-compact] .vfp-cmp-side { border-radius:7px; }
.vfp-cmp[data-compact] .vfp-cmp-side > header { padding:4px 8px; gap:6px; }
.vfp-cmp[data-compact] .vfp-cmp-step { padding:0 4px; line-height:15px; font-size:10px; }
.vfp-cmp[data-compact] .vfp-cmp-dir { font-size:10px; }
.vfp-cmp[data-compact] .vfp-cmp-side pre { padding:5px 0 6px; }
.vfp-cmp[data-compact] { width:100%; max-height:none; overflow:visible; padding:0; gap:6px; }
.vfp-cmp[data-compact] .vfp-cmp-head { padding-bottom:5px; flex-wrap:nowrap; gap:6px; align-items:baseline; }
.vfp-cmp[data-compact] .vfp-cmp-title { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vfp-cmp[data-compact] .vfp-cmp-diff, .vfp-cmp[data-compact] .vfp-cmp-same { margin-left:auto; flex:none; }
.vfp-cmp[data-compact] .vfp-cmp-head strong { font-size:12px; }
.vfp-cmp[data-compact] .vfp-cmp-side > header { padding:3px 7px; }
.vfp-cmp[data-compact] .vfp-cmp-side > header code { font-size:10px; }
/* Slim, self-effacing scrollbars inside a preview pane. */
.vfp-cmp-side pre::-webkit-scrollbar { width:9px; height:9px; }
.vfp-cmp-side pre::-webkit-scrollbar-track { background:transparent; }
.vfp-cmp-side pre::-webkit-scrollbar-corner { background:transparent; }
.vfp-cmp-side pre::-webkit-scrollbar-thumb { border:2px solid transparent; border-radius:99px; background:rgba(120,132,150,.30); background-clip:content-box; }
.vfp-cmp-side pre::-webkit-scrollbar-thumb:hover { background:rgba(120,132,150,.52); background-clip:content-box; }
.vfp-cmp[data-compact] .vfp-cmp-step { border-color:transparent; background:rgba(57,107,215,.07); color:var(--vfp-accent); }
.vfp-cmp[data-compact] .vfp-cmp-side[data-side="read"] .vfp-cmp-step { background:rgba(120,132,150,.10); color:var(--vfp-muted); }
.vfp-cmp[data-compact] .vfp-cmp-side pre { max-height:150px; }
.vfp-cmp[data-compact] .vfp-cmp-line { padding:0 7px; }
.vfp-batch-more { margin:2px 0 4px; }
.vfp-batch-more button { border:1px dashed var(--vfp-line); border-radius:6px; background:transparent; color:var(--vfp-muted); font:inherit; font-size:11px; padding:3px 8px; cursor:pointer; }
.vfp-batch-more button:hover { background:var(--vfp-soft); }
.vfp-batch-trigger { cursor:pointer; border-radius:8px; }
.vfp-batch-trigger[data-pinned] { outline:1px solid var(--vfp-accent); outline-offset:2px; }
.vfp-inherit-row { cursor:pointer; }
.vfp-inherit-row[data-pinned] { background:var(--vfp-selected); }/* The detail section styles any div holding a <span> as a two-column row; the
   ledger needs its own columns (name / badge / path / share). */
[data-dsh-vaspflow-panel] .vfp-build-detail-section>.vfp-inherit-template,
[data-dsh-vaspflow-panel] .vfp-build-detail-section>.vfp-inherit-extras { grid-template-columns:64px minmax(0,1fr) auto; }
@container vfp-panel (max-width:360px) {
  .vfp-inherit-bar { grid-template-columns:52px minmax(0,1fr); }
  .vfp-inherit-bar-count { grid-column:2; max-width:none; text-align:left; }
  .vfp-inherit-row { grid-template-columns:56px 40px minmax(0,1fr) auto; gap:6px; }
  .vfp-inherit-template { grid-template-columns:56px minmax(0,1fr) auto; gap:6px; }
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
