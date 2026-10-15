/** All UI styling lives here so the UI package ships as one unit with no CSS build step. */
export const CSS = `
#ui-root { position: fixed; inset: 0; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f4efe6; user-select: none; }
#ui-root * { box-sizing: border-box; }
.ui-hidden { display: none !important; }
.ui-panel { background: rgba(18, 16, 14, 0.72); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; backdrop-filter: blur(4px); }

.hud-clock { position: absolute; top: 12px; left: 12px; padding: 8px 12px; min-width: 190px; }
.hud-clock .time { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
.hud-clock .meta { font-size: 12px; opacity: 0.8; margin-top: 2px; }
.hud-clock .holiday { font-size: 12px; color: #ffd23b; margin-top: 2px; }

.hud-mission { position: absolute; top: 96px; left: 12px; padding: 8px 12px; max-width: min(260px, calc(100vw - 196px)); }
.hud-mission .title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; }
.hud-mission .step { font-size: 14px; margin-top: 3px; }
.hud-mission .progress { font-size: 11px; opacity: 0.7; margin-top: 2px; }

.hud-money { position: absolute; top: 12px; right: 12px; padding: 8px 14px; text-align: right; }
.hud-money .amount { font-size: 20px; font-weight: 700; color: #7be08a; }
.hud-money .debt { font-size: 12px; color: #ff8a7a; }
.hud-money .delta { font-size: 12px; opacity: 0.9; height: 14px; }
.hud-money .delta.up { color: #7be08a; } .hud-money .delta.down { color: #ff9c8a; }

.hud-minimap { position: absolute; top: 76px; right: 12px; width: 156px; height: 156px; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.18); background: #24211d; }
.hud-minimap canvas { width: 100%; height: 100%; display: block; }

.hud-needs { position: absolute; left: 12px; bottom: 12px; padding: 10px 12px; width: 210px; }
.need { display: flex; align-items: center; gap: 8px; font-size: 11px; margin: 4px 0; }
.need .name { width: 52px; opacity: 0.85; text-transform: capitalize; }
.need .bar { flex: 1; height: 8px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; }
.need .fill { height: 100%; background: #7be08a; transition: width 0.4s, background 0.4s; }
.need .fill.low { background: #ffb347; } .need .fill.crit { background: #ff5a4a; }

.hud-prompt { position: absolute; left: 50%; bottom: 90px; transform: translateX(-50%); padding: 10px 18px; font-size: 16px; text-align: center; }
.hud-prompt kbd { background: #f4efe6; color: #1b1814; border-radius: 4px; padding: 1px 7px; margin-right: 8px; font-weight: 700; }

.hud-notes { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; width: min(520px, 90vw); }
.note { padding: 8px 14px; font-size: 14px; animation: noteIn 0.25s ease-out; text-align: center; }
.note.good { border-color: rgba(123,224,138,0.6); } .note.warn { border-color: rgba(255,179,71,0.8); }
.note.out { opacity: 0; transition: opacity 0.6s; }
@keyframes noteIn { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }

.hud-flags { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; }
.flag { padding: 4px 10px; font-size: 12px; }
.flag.warn { color: #ffb347; }

.activity { position: absolute; inset: 0; background: #000; display: flex; align-items: center; justify-content: center; font-size: 22px; opacity: 0; transition: opacity 0.4s; pointer-events: none; }
.activity.on { opacity: 1; pointer-events: auto; }

.overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto; background: rgba(8,7,6,0.55); }
.overlay.menu { background: linear-gradient(180deg, rgba(8,7,6,0.2), rgba(8,7,6,0.75)); }
.modal { width: min(460px, 92vw); max-height: 92vh; overflow: auto; padding: 22px 26px; }
.modal h1 { margin: 0 0 4px; font-size: 34px; letter-spacing: 1px; }
.modal h2 { margin: 0 0 12px; font-size: 20px; }
.modal .sub { opacity: 0.75; margin-bottom: 16px; font-size: 14px; }
.btn { display: block; width: 100%; margin: 8px 0; padding: 11px 14px; font: inherit; font-size: 15px; color: #f4efe6; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; cursor: pointer; text-align: center; }
.btn:hover { background: rgba(255,255,255,0.16); } .btn.primary { background: #c8402f; border-color: #e0604d; } .btn.primary:hover { background: #dc5140; }
.btn:disabled { opacity: 0.4; cursor: default; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 10px 0; font-size: 14px; }
.row input[type=range] { width: 190px; } .row select, .row input[type=text] { background: #2a2622; color: #f4efe6; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 5px 8px; font: inherit; }
.swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.swatch.on { border-color: #fff; box-shadow: 0 0 0 2px #c8402f; }
.keys { width: 100%; border-collapse: collapse; font-size: 14px; } .keys td { padding: 5px 4px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.keys td:first-child { width: 120px; font-weight: 700; }
.slotline { font-size: 12px; opacity: 0.7; margin: -4px 0 6px; text-align: center; }
.small { font-size: 12px; opacity: 0.7; }

.map-wrap { pointer-events: auto; padding: 14px; }
.map-wrap canvas { display: block; width: min(80vmin, 640px); height: min(80vmin, 640px); border-radius: 8px; }
.map-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; margin-top: 8px; }
.map-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }

.debug { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); padding: 6px 10px; font: 12px ui-monospace, Menlo, monospace; white-space: pre; }
`;
