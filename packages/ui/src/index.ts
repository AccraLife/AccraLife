import {
  type Appearance,
  type GameConfig,
  type GameContext,
  type GameModule,
  type GameTime,
  GAME_VERSION,
  BODY_BUILDS,
  BOTTOM_COLORS,
  BUILD_LABELS,
  HAIR_LABELS,
  HAIR_STYLES,
  OUTFITS,
  OUTFIT_LABELS,
  type NeedId,
  SHIRT_COLORS,
  SKIN_TONES,
  WEATHER_LABELS,
  defaultAppearance,
  defineModule,
  formatClock,
} from '@accra/core';
import { cssHex, h } from './dom';
import { MARKER_COLORS, MARKER_NAMES, drawMap } from './map';
import { saveSettings } from './settings';
import { CSS } from './styles';

export * from './settings';

/**
 * UIX: menus and HUD (SRS section 13).
 * Plain DOM over the canvas. The UI never changes game state directly: it calls services and
 * listens to events, so it can be redesigned without touching other modules.
 */

export interface UiOptions {
  /** Called once when a game begins (new or continued) so every module runs start(). */
  startModules(): void;
}

type View = 'main' | 'creator' | 'settings' | 'controls' | 'credits' | 'pause' | 'saves';

const NEEDS: NeedId[] = ['hunger', 'thirst', 'energy', 'hygiene', 'mood'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOTS = ['slot1', 'slot2', 'slot3'];

export function createUiModule(options: UiOptions): GameModule {
  let ctx: GameContext;
  let root: HTMLElement;
  let style: HTMLStyleElement;
  const offs: Array<() => void> = [];
  const cleanup: Array<() => void> = [];

  // HUD elements
  let hud: HTMLElement;
  let timeEl: HTMLElement;
  let metaEl: HTMLElement;
  let holidayEl: HTMLElement;
  let moneyEl: HTMLElement;
  let debtEl: HTMLElement;
  let deltaEl: HTMLElement;
  let missionTitle: HTMLElement;
  let missionStep: HTMLElement;
  let missionProgress: HTMLElement;
  let promptEl: HTMLElement;
  let notesEl: HTMLElement;
  let flagsEl: HTMLElement;
  let powerFlag: HTMLElement;
  let radioFlag: HTMLElement;
  let activityEl: HTMLElement;
  let debugEl: HTMLElement;
  let overlay: HTMLElement;
  let miniCanvas: HTMLCanvasElement;
  const needFills = new Map<NeedId, HTMLElement>();

  let district = '';
  let player = { x: 0, z: 0, yaw: Math.PI / 2 };
  let appearance: Appearance = defaultAppearance();
  let mapRequested = false;
  let hasGameStarted = false;
  let miniTimer = 0;
  let deltaTimer = 0;
  let activityTimer = 0;

  const eco = () => ctx.services.get('economy');

  // ---------- helpers ----------
  const lockPointer = (): void => {
    const canvas = document.getElementById('game-canvas');
    try {
      const r = canvas?.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* drag-to-look fallback in PLY */
    }
  };

  const notify = (text: string, kind: 'info' | 'good' | 'warn' = 'info'): void => {
    const el = h('div', { class: `note ui-panel ${kind}` }, text);
    notesEl.append(el);
    while (notesEl.children.length > 4) notesEl.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), 4500);
    window.setTimeout(() => el.remove(), 5200);
  };

  const closeOverlay = (): void => {
    overlay.replaceChildren();
    overlay.classList.add('ui-hidden');
  };

  const openOverlay = (kind: 'menu' | 'pause', ...content: Node[]): void => {
    overlay.className = `overlay ${kind}`;
    overlay.replaceChildren(...content);
  };

  const setConfig = <K extends keyof GameConfig>(key: K, value: GameConfig[K], tunesGraphics = false): void => {
    ctx.config[key] = value;
    if (tunesGraphics) ctx.config.userTuned = true;
    saveSettings(ctx.config);
    ctx.events.emit('settingsChanged', { key });
  };

  const resume = (): void => {
    closeOverlay();
    mapRequested = false;
    ctx.setPhase('playing');
    lockPointer();
  };

  // ---------- screens ----------
  const backTo = (): View => (ctx.state.phase === 'menu' ? 'main' : 'pause');

  const modal = (...children: Node[]): HTMLElement => h('div', { class: 'modal ui-panel' }, ...children);
  const back = (): HTMLElement => h('button', { class: 'btn', onclick: () => show(backTo()) }, 'Back');

  const slider = (
    label: string,
    key: 'masterVolume' | 'mouseSensitivity' | 'crowdDensity' | 'trafficDensity' | 'resolutionScale',
    min: number,
    max: number,
    step: number,
    graphics = false,
  ): HTMLElement =>
    h(
      'div',
      { class: 'row' },
      h('span', {}, label),
      h('input', {
        type: 'range',
        min,
        max,
        step,
        value: ctx.config[key],
        oninput: (e: Event) => setConfig(key, Number((e.target as HTMLInputElement).value), graphics),
      }),
    );

  const select = <T extends string>(
    label: string,
    value: T,
    choices: ReadonlyArray<[T, string]>,
    onchange: (v: T) => void,
  ): HTMLElement =>
    h(
      'div',
      { class: 'row' },
      h('span', {}, label),
      h(
        'select',
        { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value as T) },
        ...choices.map(([v, text]) => h('option', { value: v, selected: v === value }, text)),
      ),
    );

  const settingsView = (): HTMLElement =>
    modal(
      h('h2', {}, 'Settings'),
      select('Graphics quality', ctx.config.quality, [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], (v) =>
        setConfig('quality', v, true),
      ),
      select('View distance', String(ctx.config.viewRadius), [['1', 'Short'], ['2', 'Medium'], ['3', 'Far']], (v) =>
        setConfig('viewRadius', Number(v), true),
      ),
      slider('Resolution', 'resolutionScale', 0.5, 1, 0.05, true),
      slider('Crowd density', 'crowdDensity', 0, 1, 0.1),
      slider('Traffic density', 'trafficDensity', 0, 1, 0.1),
      slider('Volume', 'masterVolume', 0, 1, 0.05),
      slider('Mouse sensitivity', 'mouseSensitivity', 0.3, 3, 0.1),
      h(
        'div',
        { class: 'row' },
        h('span', {}, 'Show debug overlay (F3)'),
        h('input', {
          type: 'checkbox',
          checked: ctx.config.showDebug,
          onchange: (e: Event) => setConfig('showDebug', (e.target as HTMLInputElement).checked),
        }),
      ),
      back(),
    );

  const controlsView = (): HTMLElement =>
    modal(
      h('h2', {}, 'Controls'),
      h(
        'table',
        { class: 'keys' },
        ...(
          [
            ['W A S D / arrows', 'Walk'],
            ['Shift', 'Run (uses energy)'],
            ['Space', 'Jump'],
            ['Mouse', 'Look (click the game to capture)'],
            ['Wheel', 'Camera distance'],
            ['E', 'Interact (eat, drink, work, sleep, ride)'],
            ['M', 'Full map'],
            ['R', 'Radio on / off'],
            ['F3', 'Debug overlay'],
            ['Esc', 'Pause'],
          ] as const
        ).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))),
      ),
      back(),
    );

  const creditsView = (): HTMLElement =>
    modal(
      h('h2', {}, 'About Accra Life'),
      h('p', { class: 'sub' }, `Version ${GAME_VERSION}. An early prototype of a life simulation set in Accra, Ghana.`),
      h(
        'p',
        { class: 'small' },
        'The streets, buildings and landmarks in this version are stylised placeholders, not accurate maps. Shop names are fictional. Real places and cultural details will be added with local review.',
      ),
      h('p', { class: 'small' }, 'Built with Three.js. All sound is generated live in your browser.'),
      back(),
    );

  const creatorView = (): HTMLElement => {
    const swatch = (hex: number, on: boolean, pick: () => void): HTMLElement =>
      h('div', { class: `swatch${on ? ' on' : ''}`, style: `background:${cssHex(hex)}`, onclick: pick });
    const redraw = (): void => show('creator');
    const apply = (): void => ctx.services.get('player').setAppearance(appearance);
    apply();
    return modal(
      h('h2', {}, 'Create your character'),
      h(
        'div',
        { class: 'row' },
        h('span', {}, 'Name'),
        h('input', {
          type: 'text',
          maxlength: 16,
          value: appearance.name,
          oninput: (e: Event) => {
            const v = (e.target as HTMLInputElement).value.trim();
            appearance = { ...appearance, name: v || 'Kwame' };
          },
        }),
      ),
      h('div', { class: 'row' }, h('span', {}, 'Skin tone'), h('div', { class: 'swatches' }, ...SKIN_TONES.map((c, i) =>
        swatch(c, appearance.skin === i, () => { appearance = { ...appearance, skin: i }; apply(); redraw(); })))),
      h('div', { class: 'row' }, h('span', {}, 'Main colour'), h('div', { class: 'swatches' }, ...SHIRT_COLORS.map((c, i) =>
        swatch(c, appearance.shirt === i, () => { appearance = { ...appearance, shirt: i }; apply(); redraw(); })))),
      select('Outfit', appearance.outfit ?? 'tee', OUTFITS.map((o) => [o, OUTFIT_LABELS[o]] as [typeof o, string]), (v) => {
        appearance = { ...appearance, outfit: v };
        apply();
      }),
      h('div', { class: 'row' }, h('span', {}, 'Trousers'), h('div', { class: 'swatches' }, ...BOTTOM_COLORS.map((c, i) =>
        swatch(c, (appearance.bottom ?? 0) === i, () => { appearance = { ...appearance, bottom: i }; apply(); redraw(); })))),
      select('Build', appearance.build ?? 'average', BODY_BUILDS.map((b) => [b, BUILD_LABELS[b]] as [typeof b, string]), (v) => {
        appearance = { ...appearance, build: v };
        apply();
      }),
      select('Hair', appearance.hair, HAIR_STYLES.map((s) => [s, HAIR_LABELS[s]] as [typeof s, string]), (v) => {
        appearance = { ...appearance, hair: v };
        apply();
      }),
      h('button', { class: 'btn primary', onclick: () => beginGame(null) }, 'Start'),
      h('button', { class: 'btn', onclick: () => show('main') }, 'Back'),
    );
  };

  const savesView = (): HTMLElement => {
    const box = modal(h('h2', {}, ctx.state.phase === 'menu' ? 'Continue' : 'Save and load'), h('p', { class: 'small' }, 'Loading...'));
    void ctx.services
      .get('save')
      .list()
      .then((list) => {
        const bySlot = new Map(list.map((s) => [s.slot, s]));
        const canSave = ctx.state.phase !== 'menu';
        const parts: Node[] = [h('h2', {}, canSave ? 'Save and load' : 'Continue')];
        for (const slot of ['auto', ...SLOTS]) {
          const info = bySlot.get(slot);
          const title = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(4)}`;
          parts.push(
            h('div', { class: 'slotline' }, info ? `${info.label}  |  ${new Date(info.savedAt).toLocaleString()}` : 'Empty'),
            h('div', { class: 'row' },
              h('button', { class: 'btn', disabled: !info, onclick: () => beginGame(slot) }, `Load: ${title}`),
              canSave && slot !== 'auto'
                ? h('button', { class: 'btn', onclick: () => void doSave(slot) }, 'Save here')
                : null,
            ),
          );
        }
        parts.push(
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => void exportAny() }, 'Export latest'),
            h('button', { class: 'btn', onclick: () => importFile() }, 'Import file'),
          ),
          h('button', { class: 'btn', onclick: () => show(backTo()) }, 'Back'),
        );
        box.replaceChildren(...parts);
      });
    return box;
  };

  const doSave = async (slot: string): Promise<void> => {
    try {
      await ctx.services.get('save').save(slot);
      notify('Game saved.', 'good');
      show('saves');
    } catch (error) {
      console.error(error);
      notify('Could not save the game.', 'warn');
    }
  };

  const exportAny = async (): Promise<void> => {
    const list = await ctx.services.get('save').list();
    const latest = list[0];
    if (latest) await ctx.services.get('save').exportSave(latest.slot);
    else notify('Nothing to export yet.', 'warn');
  };

  const importFile = (): void => {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ok = await ctx.services.get('save').importSave(file, 'slot3');
      notify(ok ? 'Imported into Slot 3.' : 'That file could not be imported.', ok ? 'good' : 'warn');
      show('saves');
    });
    input.click();
  };

  const mainMenu = (): HTMLElement => {
    const box = modal(
      h('h1', {}, 'Accra Life'),
      h('div', { class: 'sub' }, 'Walk, work and live in the city.'),
      h('button', { class: 'btn primary', onclick: () => show('creator') }, 'New game'),
    );
    const cont = h('button', { class: 'btn', disabled: true, onclick: () => show('saves') }, 'Continue');
    box.append(cont);
    void ctx.services.get('save').list().then((l) => { cont.disabled = l.length === 0; });
    box.append(
      h('button', { class: 'btn', onclick: () => show('settings') }, 'Settings'),
      h('button', { class: 'btn', onclick: () => show('controls') }, 'Controls'),
      h('button', { class: 'btn', onclick: () => show('credits') }, 'About'),
      h('div', { class: 'small' }, `v${GAME_VERSION} prototype`),
    );
    return box;
  };

  const pauseMenu = (): HTMLElement =>
    modal(
      h('h2', {}, 'Paused'),
      h('button', { class: 'btn primary', onclick: resume }, 'Resume'),
      h('button', { class: 'btn', onclick: () => show('saves') }, 'Save / load'),
      h('button', { class: 'btn', onclick: () => show('settings') }, 'Settings'),
      h('button', { class: 'btn', onclick: () => show('controls') }, 'Controls'),
      h('button', { class: 'btn', onclick: () => void quitToMenu() }, 'Quit to menu'),
    );

  const quitToMenu = async (): Promise<void> => {
    try {
      await ctx.services.get('save').save('auto');
    } catch {
      /* leaving anyway */
    }
    location.reload();
  };

  const mapView = (): HTMLElement => {
    const size = 640;
    const canvas = h('canvas', { width: size, height: size });
    const g = canvas.getContext('2d');
    const world = ctx.services.get('world');
    if (g) {
      const b = world.bounds;
      drawMap(g, size, world, { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, scale: size / (b.maxX - b.minX) }, player, {
        labels: true,
        dot: 5,
      });
    }
    const legend = h('div', { class: 'map-legend' }, ...Object.keys(MARKER_NAMES).map((k) =>
      h('span', {}, h('i', { style: `background:${cssHex(MARKER_COLORS[k] ?? 0xffffff)}` }), MARKER_NAMES[k] ?? k)));
    return h('div', { class: 'map-wrap ui-panel' }, h('h2', {}, `Map: ${district || 'Accra'}`), canvas, legend,
      h('button', { class: 'btn', onclick: resume }, 'Close (M)'));
  };

  function show(view: View): void {
    const kind = ctx.state.phase === 'menu' ? 'menu' : 'pause';
    const content =
      view === 'main' ? mainMenu()
      : view === 'creator' ? creatorView()
      : view === 'settings' ? settingsView()
      : view === 'controls' ? controlsView()
      : view === 'credits' ? creditsView()
      : view === 'saves' ? savesView()
      : pauseMenu();
    openOverlay(kind, content);
  }

  async function beginGame(slot: string | null): Promise<void> {
    closeOverlay();
    lockPointer();
    options.startModules();
    hasGameStarted = true;
    if (slot) {
      const ok = await ctx.services.get('save').load(slot);
      if (!ok) notify('That save could not be loaded. Starting fresh.', 'warn');
    } else {
      ctx.services.get('player').setAppearance(appearance);
    }
    ctx.setPhase('playing');
  }

  // ---------- HUD ----------
  const buildHud = (): void => {
    timeEl = h('div', { class: 'time' }, '07:00');
    metaEl = h('div', { class: 'meta' });
    holidayEl = h('div', { class: 'holiday' });
    moneyEl = h('div', { class: 'amount' }, '');
    debtEl = h('div', { class: 'debt' });
    deltaEl = h('div', { class: 'delta' });
    missionTitle = h('div', { class: 'title' });
    missionStep = h('div', { class: 'step' });
    missionProgress = h('div', { class: 'progress' });
    promptEl = h('div', { class: 'hud-prompt ui-panel ui-hidden' });
    notesEl = h('div', { class: 'hud-notes' });
    powerFlag = h('div', { class: 'flag ui-panel warn ui-hidden' }, 'Power cut');
    radioFlag = h('div', { class: 'flag ui-panel ui-hidden' });
    flagsEl = h('div', { class: 'hud-flags' }, powerFlag, radioFlag);
    activityEl = h('div', { class: 'activity' });
    debugEl = h('div', { class: 'debug ui-panel ui-hidden' });
    miniCanvas = h('canvas', { width: 156, height: 156 });

    const needsBox = h('div', { class: 'hud-needs ui-panel' });
    for (const need of NEEDS) {
      const fill = h('div', { class: 'fill', style: 'width:100%' });
      needFills.set(need, fill);
      needsBox.append(h('div', { class: 'need' }, h('span', { class: 'name' }, need), h('div', { class: 'bar' }, fill)));
    }
    const healthFill = h('div', { class: 'fill', style: 'width:100%' });
    needFills.set('health' as NeedId, healthFill);
    needsBox.append(h('div', { class: 'need' }, h('span', { class: 'name' }, 'health'), h('div', { class: 'bar' }, healthFill)));

    hud = h('div', { class: 'ui-hidden' },
      h('div', { class: 'hud-clock ui-panel' }, timeEl, metaEl, holidayEl),
      h('div', { class: 'hud-mission ui-panel' }, missionTitle, missionStep, missionProgress),
      h('div', { class: 'hud-money ui-panel' }, moneyEl, debtEl, deltaEl),
      h('div', { class: 'hud-minimap' }, miniCanvas),
      needsBox, promptEl, notesEl, flagsEl, debugEl,
    );
    hud.style.cssText = 'position:absolute;inset:0;';
    overlay = h('div', { class: 'overlay ui-hidden' });
    root.append(hud, activityEl, overlay);
  };

  const setNeed = (need: string, value: number): void => {
    const fill = needFills.get(need as NeedId);
    if (!fill) return;
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    fill.className = `fill${value < 15 ? ' crit' : value < 35 ? ' low' : ''}`;
  };

  const updateClock = (t: GameTime): void => {
    timeEl.textContent = formatClock(t);
    const weather = ctx.services.get('env').weather();
    metaEl.textContent = `${DAYS[t.weekday] ?? ''} ${t.date}  |  ${WEATHER_LABELS[weather]}${district ? `  |  ${district}` : ''}`;
    const holiday = ctx.services.get('env').isHoliday();
    holidayEl.textContent = holiday ?? '';
    setNeed('health', ctx.services.get('life').health());
  };

  const showDebug = (): void => {
    const on = ctx.config.showDebug && (ctx.state.phase === 'playing' || ctx.state.phase === 'paused');
    debugEl.classList.toggle('ui-hidden', !on);
    if (!on) return;
    const perf = ctx.services.get('perf');
    const world = ctx.services.get('world');
    const ms = perf.moduleMs();
    const lines = [
      `${perf.fps().toFixed(0)} fps  ${perf.frameMs().toFixed(1)} ms  draws ${perf.drawCalls()}  tris ${(perf.triangles() / 1000).toFixed(0)}k`,
      `chunks ${world.loadedChunkCount()}  pos ${player.x.toFixed(0)}, ${player.z.toFixed(0)}  quality ${ctx.services.get('render').tier()}`,
      Object.entries(ms).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  '),
    ];
    debugEl.textContent = lines.join('\n');
  };

  const bindEvents = (): void => {
    const on = ctx.events.on.bind(ctx.events);
    offs.push(
      on('minuteTick', ({ time }) => updateClock(time)),
      on('weatherChanged', () => updateClock(ctx.services.get('env').now())),
      on('districtEntered', ({ name }) => {
        district = name;
        notify(`Entering ${name}`);
      }),
      on('districtExited', () => (district = '')),
      on('playerMoved', (p) => (player = p)),
      on('moneyChanged', ({ balance, delta }) => {
        moneyEl.textContent = eco().format(balance);
        const debt = eco().debt();
        debtEl.textContent = debt > 0 ? `Owe ${eco().format(debt)}` : '';
        if (delta !== 0) {
          deltaEl.textContent = `${delta > 0 ? '+' : ''}${eco().format(delta)}`;
          deltaEl.className = `delta ${delta > 0 ? 'up' : 'down'}`;
          window.clearTimeout(deltaTimer);
          deltaTimer = window.setTimeout(() => (deltaEl.textContent = ''), 2500);
        }
      }),
      on('needChanged', ({ need, value }) => setNeed(need, value)),
      on('missionChanged', ({ title, step, progress }) => {
        missionTitle.textContent = title;
        missionStep.textContent = step ?? 'Explore the city, or save up for next week\'s rent.';
        missionProgress.textContent = progress;
      }),
      on('promptChanged', ({ text }) => {
        promptEl.classList.toggle('ui-hidden', !text);
        promptEl.replaceChildren(...(text ? [h('kbd', {}, 'E'), text] : []));
      }),
      on('notify', ({ text, kind }) => notify(text, kind ?? 'info')),
      on('powerChanged', ({ on: powered }) => powerFlag.classList.toggle('ui-hidden', powered)),
      on('radioChanged', ({ station }) => {
        radioFlag.classList.toggle('ui-hidden', !station);
        radioFlag.textContent = station ? `Radio: ${station}` : '';
      }),
      on('activityStarted', ({ label, seconds }) => {
        activityEl.textContent = label;
        activityEl.classList.add('on');
        window.clearTimeout(activityTimer);
        activityTimer = window.setTimeout(() => activityEl.classList.remove('on'), seconds * 1000);
      }),
      on('settingsChanged', ({ key }) => {
        if (key === 'showDebug') showDebug();
      }),
      on('phaseChanged', ({ phase }) => {
        hud.classList.toggle('ui-hidden', phase === 'menu' || phase === 'loading');
        if (phase === 'menu') show('main');
        else if (phase === 'paused') {
          if (mapRequested) openOverlay('pause', mapView());
          else show('pause');
        } else if (phase === 'playing') closeOverlay();
      }),
    );
  };

  const onKey = (e: KeyboardEvent): void => {
    const phase = ctx.state.phase;
    if (e.code === 'F3') {
      e.preventDefault();
      setConfig('showDebug', !ctx.config.showDebug);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyM' && hasGameStarted) {
      if (phase === 'playing') {
        mapRequested = true;
        if (document.pointerLockElement) document.exitPointerLock();
        ctx.setPhase('paused');
      } else if (phase === 'paused' && mapRequested) resume();
    } else if (e.code === 'Escape' && phase === 'paused') {
      if (mapRequested) resume();
      else if (overlay.querySelector('.modal h2')?.textContent === 'Paused') resume();
    }
  };

  const drawMini = (): void => {
    const phase = ctx.state.phase;
    if (phase !== 'playing') return;
    const g = miniCanvas.getContext('2d');
    if (g) drawMap(g, 156, ctx.services.get('world'), { cx: player.x, cz: player.z, scale: 0.5 }, player, { labels: false, dot: 3 });
    showDebug();
  };

  return defineModule({
    id: 'ui',
    version: '0.1.0',
    dependsOn: ['world', 'env', 'player', 'life', 'economy', 'save', 'perf'],
    alwaysUpdate: true,

    init(context) {
      ctx = context;
      root = document.getElementById('ui-root') ?? document.body.appendChild(h('div', { id: 'ui-root' }));
      style = h('style', {}, CSS);
      document.head.append(style);
      buildHud();
      bindEvents();
      window.addEventListener('keydown', onKey);
      cleanup.push(() => window.removeEventListener('keydown', onKey));
      // The page may already be in the menu phase if UI initialised late.
      if (ctx.state.phase === 'menu') show('main');
    },

    update(dt) {
      miniTimer += dt;
      if (miniTimer >= 0.1) {
        miniTimer = 0;
        drawMini();
      }
    },

    dispose() {
      for (const off of offs) off();
      for (const fn of cleanup) fn();
      style?.remove();
      root?.replaceChildren();
    },
  });
}
