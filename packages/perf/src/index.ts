import {
  type GameContext,
  type GameModule,
  type PerfService,
  type QualityTier,
  type RenderService,
  defineModule,
} from '@accra/core';
import * as THREE from 'three';

/**
 * PRF: rendering and performance (SRS section 15).
 * Owns the renderer, scene, camera, quality tiers and the frame statistics.
 */

interface TierPreset {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  viewRadius: number;
  crowdDensity: number;
  trafficDensity: number;
}

export const TIER_PRESETS: Record<QualityTier, TierPreset> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    antialias: false,
    viewRadius: 2,
    crowdDensity: 0.35,
    trafficDensity: 0.4,
  },
  medium: {
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    antialias: true,
    viewRadius: 3,
    crowdDensity: 0.7,
    trafficDensity: 0.7,
  },
  high: {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    antialias: true,
    viewRadius: 3,
    crowdDensity: 1,
    trafficDensity: 1,
  },
};

/** Guess a tier from the device (PRF-010). The player can override it in settings. */
export function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext | null): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const mobile = /android|iphone|ipad|mobile/i.test(nav.userAgent);
  let gpu = '';
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  }
  if (mobile) return 'low';
  if (/swiftshader|llvmpipe|software/.test(gpu)) return 'low';
  if (/nvidia|geforce|rtx|radeon rx|apple m\d|apple gpu/.test(gpu) && cores >= 6) return 'high';
  if (cores >= 8 && memory >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}

export function createPerfModule(): GameModule {
  let ctx: GameContext;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let detected: QualityTier = 'medium';
  let currentTier: QualityTier = 'medium';

  let fps = 60;
  let frameMs = 16.7;
  let lastRender = performance.now();
  let lowFpsSeconds = 0;
  const moduleMs: Record<string, number> = {};

  const effectiveTier = (): QualityTier =>
    ctx.config.quality === 'auto' ? detected : ctx.config.quality;

  const applyTier = (resetDensities: boolean): void => {
    currentTier = effectiveTier();
    const preset = TIER_PRESETS[currentTier];
    if (resetDensities) {
      ctx.config.viewRadius = preset.viewRadius;
      ctx.config.crowdDensity = preset.crowdDensity;
      ctx.config.trafficDensity = preset.trafficDensity;
    }
    renderer.shadowMap.enabled = preset.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    applySize();
    ctx.events.emit('settingsChanged', { key: 'tier' });
  };

  const applySize = (): void => {
    const preset = TIER_PRESETS[currentTier];
    const ratio = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap) * ctx.config.resolutionScale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  };

  const renderService: RenderService = {
    get renderer() {
      return renderer;
    },
    get scene() {
      return scene;
    },
    get camera() {
      return camera;
    },
    tier: () => currentTier,
    shadowsEnabled: () => TIER_PRESETS[currentTier].shadows,
    shadowMapSize: () => TIER_PRESETS[currentTier].shadowMapSize,
  };

  const perfService: PerfService = {
    fps: () => fps,
    frameMs: () => frameMs,
    drawCalls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
    moduleMs: () => moduleMs,
  };

  return defineModule({
    id: 'perf',
    version: '0.1.0',
    dependsOn: [],
    alwaysUpdate: true,

    init(context) {
      ctx = context;

      const probe = document.createElement('canvas');
      const probeGl = probe.getContext('webgl2') ?? probe.getContext('webgl');
      detected = detectTier(probeGl);

      const canvas = document.createElement('canvas');
      canvas.id = 'game-canvas';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
      (document.getElementById('game-root') ?? document.body).appendChild(canvas);

      const antialias = TIER_PRESETS[effectiveTier()].antialias;
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x8ec5ff);
      camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 2000);
      camera.position.set(0, 20, 40);
      scene.add(camera);

      // Settings saved by the player win; otherwise the tier decides the densities.
      applyTier(!ctx.config.userTuned);

      window.addEventListener('resize', applySize);
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        ctx.events.emit('notify', { text: 'Graphics context lost. Reloading...', kind: 'warn' });
        setTimeout(() => window.location.reload(), 1200);
      });

      ctx.events.on('settingsChanged', ({ key }) => {
        if (key === 'quality') applyTier(true);
        if (key === 'resolutionScale') applySize();
      });

      ctx.services.register('render', renderService);
      ctx.services.register('perf', perfService);

      // Render last: every other hook updates the scene first.
      ctx.onRender(1000, () => {
        const now = performance.now();
        const dt = now - lastRender;
        lastRender = now;
        frameMs = frameMs * 0.9 + dt * 0.1;
        fps = 1000 / Math.max(frameMs, 0.001);

        renderer.render(scene, camera);

        // Adaptive quality (PRF-011): shed load if the frame rate stays low.
        if (ctx.state.phase === 'playing') {
          lowFpsSeconds = fps < 24 ? lowFpsSeconds + dt / 1000 : 0;
          if (lowFpsSeconds > 5 && ctx.config.quality === 'auto') {
            lowFpsSeconds = 0;
            if (ctx.config.viewRadius > 2) {
              ctx.config.viewRadius -= 1;
              ctx.events.emit('settingsChanged', { key: 'viewRadius' });
              ctx.events.emit('notify', { text: 'Lowered view distance to keep the game smooth.', kind: 'info' });
            } else if (ctx.config.crowdDensity > 0.2) {
              ctx.config.crowdDensity = Math.max(0.2, ctx.config.crowdDensity - 0.2);
              ctx.config.trafficDensity = Math.max(0.2, ctx.config.trafficDensity - 0.2);
              ctx.events.emit('settingsChanged', { key: 'crowdDensity' });
            }
          }
        }
      });
    },

    update() {
      // Pull module timings from the host for the debug overlay.
      const game = (window as unknown as { __accraGame?: { moduleTimings(): Record<string, number> } }).__accraGame;
      if (game) Object.assign(moduleMs, game.moduleTimings());
    },

    dispose() {
      window.removeEventListener('resize', applySize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  });
}
