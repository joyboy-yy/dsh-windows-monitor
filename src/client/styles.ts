/**
 * Panel stylesheet.
 *
 * Inserted once per plugin fiber and removed on teardown. Every colour is a DSH
 * theme token so light/dark follow the app; nothing here reaches outside the
 * `.sm-` namespace.
 */
export const PANEL_CSS = `
.sm-root{position:fixed;right:14px;bottom:14px;z-index:80;pointer-events:none;font-family:inherit;color:var(--dsw-alias-label-primary)}
.sm-root>*{pointer-events:auto}
.sm-root.sm-settling{transition:left .18s cubic-bezier(.22,.61,.36,1),top .18s cubic-bezier(.22,.61,.36,1)}
.sm-pill,.sm-card{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.10),0 1px 2px rgba(0,0,0,.05);transition:opacity .16s ease,border-color .15s ease,box-shadow .15s ease}
.sm-root.sm-dragging .sm-pill,.sm-root.sm-dragging .sm-card{opacity:.72;cursor:grabbing}
.sm-root.sm-dragging .sm-head{cursor:grabbing}
.sm-pill{display:flex;align-items:center;gap:9px;height:30px;padding:0 11px;border-radius:999px;font:inherit;color:inherit;cursor:pointer;touch-action:none;user-select:none}
.sm-pill:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.06)}
.sm-hint{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sm-caret{display:flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.sm-micro{display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.sm-micro-label{font-size:9px;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}
.sm-micro-value{font-size:11px;font-weight:600}
.sm-micro-track{display:block;width:20px;height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.sm-micro-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.sm-micro-fill.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-micro-fill.bad{background:var(--dsw-alias-state-error-primary)}
.sm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.sm-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-dot.bad{background:var(--dsw-alias-state-error-primary);animation:sm-pulse 1.6s ease-in-out infinite}
.sm-dot.idle{background:var(--dsw-alias-label-secondary);opacity:.45}
@keyframes sm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes sm-spin{to{transform:rotate(360deg)}}
.sm-card{width:min(280px,calc(100vw - 24px));border-radius:10px;overflow:hidden}
.sm-head{display:flex;align-items:center;gap:8px;height:38px;padding:0 7px 0 12px;cursor:grab;touch-action:none;user-select:none}
.sm-title{flex:1;font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-chip{flex:none;font-size:10px;line-height:1;padding:3px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.sm-chip.warn{color:var(--dsw-alias-state-warn-primary)}
.sm-chip.bad{color:var(--dsw-alias-state-error-primary)}
.sm-icon{width:24px;height:24px;flex:none;display:flex;align-items:center;justify-content:center;padding:0;font:inherit;font-size:14px;line-height:1;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sm-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sm-icon:disabled{opacity:.45;cursor:default}
.sm-icon svg{display:block}
.sm-icon.spinning svg{animation:sm-spin .9s linear infinite}
.sm-body{border-top:1px solid var(--dsw-alias-border-l1);padding:12px}
.sm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.sm-metric{display:flex;flex-direction:column;gap:6px;min-width:0}
.sm-metric-head{display:flex;align-items:baseline;justify-content:space-between;gap:5px;min-width:0}
.sm-metric-label{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sm-metric-value{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
.sm-metric-value.warn{color:var(--dsw-alias-state-warn-primary)}
.sm-metric-value.bad{color:var(--dsw-alias-state-error-primary)}
.sm-track{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.sm-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.sm-fill.warn{background:var(--dsw-alias-state-warn-primary)}
.sm-fill.bad{background:var(--dsw-alias-state-error-primary)}
.sm-rows{display:flex;flex-direction:column;margin-top:12px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}
.sm-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:23px;font-size:11.5px}
.sm-row>span:first-child{flex:none;color:var(--dsw-alias-label-secondary)}
.sm-row>span:last-child{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.sm-alert{color:var(--dsw-alias-state-warn-primary)!important}
.sm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}
.sm-time{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sm-reset{padding:2px 5px;font:inherit;font-size:10.5px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sm-reset:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sm-error{padding:12px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);border-top:1px solid var(--dsw-alias-border-l1)}
.sm-pill:focus-visible,.sm-icon:focus-visible,.sm-reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media(max-width:520px){.sm-root{right:10px;bottom:10px}.sm-card{width:calc(100vw - 20px)}}
@media(prefers-reduced-motion:reduce){.sm-dot.bad{animation:none}.sm-icon.spinning svg{animation:none}.sm-micro-fill,.sm-fill,.sm-pill,.sm-card,.sm-root.sm-settling{transition:none}}
`
