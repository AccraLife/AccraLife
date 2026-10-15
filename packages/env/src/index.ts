import * as THREE from 'three';
import {
  type EnvService,
  type GameContext,
  type GameModule,
  type GameTime,
  type RenderService,
  type Weather,
  Rng,
  defineModule,
} from '@accra/core';
import {
  START_MINUTE_OF_DAY,
  holidayOn,
  monthOf,
  nightFactor,
  sunHeight,
  timeFromMinutes,
  weatherRng,
} from './clock';
import { LOOKS, type WeatherLook, pickWeather, seasonFor, trafficFactor } from './weather';

export * from './clock';
export * from './weather';

/**
 * ENV: environment (SRS section 6). Owns the game clock, calendar, weather and all lighting.
 * Every other module reads time from here, never from the system clock (ENV-003).
 */

const DAY_TOP = new THREE.Color(0x3f8fe0);
const DAY_BOTTOM = new THREE.Color(0xa7d3f5);
const DUSK_TOP = new THREE.Color(0x35508a);
const DUSK_BOTTOM = new THREE.Color(0xf2a65a);
const NIGHT_TOP = new THREE.Color(0x050a1c);
const NIGHT_BOTTOM = new THREE.Color(0x16213a);
const GRAY_TOP = new THREE.Color(0x7d8791);
const GRAY_BOTTOM = new THREE.Color(0xaeb6bd);
const HAZE_TOP = new THREE.Color(0xbfae92);
const HAZE_BOTTOM = new THREE.Color(0xd2bb94);
const WARM = new THREE.Color(0xffc98a);
const WHITE = new THREE.Color(0xfff4e0);

const RAIN_DROPS = 1800;
const STAR_COUNT = 700;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createEnvModule(): GameModule {
  let ctx: GameContext;
  let render: RenderService;

  let total = START_MINUTE_OF_DAY;
  let frac = 0;
  let time: GameTime = timeFromMinutes(total);
  let weather: Weather = 'clear';
  let rng = weatherRng(0);
  const visualRng = new Rng(0xbeef);

  const cur: WeatherLook = { ...LOOKS.clear };
  let night = 0;
  let flash = 0;
  let flashTimer = 8;
  let lightingTimer = 0;
  let focusX = 0;
  let focusZ = 0;

  let sky: THREE.Group;
  let dome: THREE.Mesh;
  let stars: THREE.Points;
  let sunDisc: THREE.Mesh;
  let moonDisc: THREE.Mesh;
  let sun: THREE.DirectionalLight;
  let moon: THREE.DirectionalLight;
  let hemi: THREE.HemisphereLight;
  let rainLines: THREE.LineSegments;
  const rainPos = new Float32Array(RAIN_DROPS * 6);
  const rainHead = new Float32Array(RAIN_DROPS * 3);
  const offs: Array<() => void> = [];

  const top = new THREE.Color();
  const bottom = new THREE.Color();
  const tmp = new THREE.Color();
  const sunDir = new THREE.Vector3();

  const hourFloat = (): number => time.hour + (time.minute + frac) / 60;

  const setWeather = (next: Weather): void => {
    if (next === weather) return;
    const previous = weather;
    weather = next;
    ctx.events.emit('weatherChanged', { weather: next, previous });
  };

  const stepMinute = (): void => {
    total += 1;
    time = timeFromMinutes(total);
    ctx.events.emit('minuteTick', { time });
    if (time.minute === 0) {
      ctx.events.emit('hourChanged', { time });
      if (rng.chance(0.3)) setWeather(pickWeather(seasonFor(monthOf(time)), rng));
      if (time.hour === 0) ctx.events.emit('dayChanged', { time });
    }
  };

  const service: EnvService = {
    now: () => time,
    weather: () => weather,
    nightFactor: () => night,
    speed: () => ctx.config.gameMinutesPerRealSecond,
    setSpeed(v) {
      ctx.config.gameMinutesPerRealSecond = Math.max(0, Math.min(30, v));
    },
    setWeather,
    advanceMinutes(minutes) {
      const n = Math.max(0, Math.floor(minutes));
      for (let i = 0; i < n; i++) stepMinute();
    },
    setTimeOfDay(hour) {
      const minuteOfDay = time.hour * 60 + time.minute;
      const delta = (Math.round(hour * 60) - minuteOfDay + 1440) % 1440;
      service.advanceMinutes(delta);
    },
    isHoliday: () => holidayOn(time.date),
  };

  const createSky = (): void => {
    sky = new THREE.Group();
    sky.name = 'sky';
    dome = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: { topColor: { value: new THREE.Color() }, bottomColor: { value: new THREE.Color() } },
        vertexShader: 'varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 topColor;\nuniform vec3 bottomColor;\nvarying float vH;\nvoid main() {\n  float t = pow(clamp(vH, 0.0, 1.0), 0.55);\n  gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);\n#include <colorspace_fragment>\n}\n',
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -10;
    sky.add(dome);

    const starPos = new Float32Array(STAR_COUNT * 3);
    const starRng = new Rng(77);
    for (let i = 0; i < STAR_COUNT; i++) {
      const y = starRng.range(0.04, 1);
      const a = starRng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      starPos[i * 3] = Math.cos(a) * r * 1700;
      starPos[i * 3 + 1] = y * 1700;
      starPos[i * 3 + 2] = Math.sin(a) * r * 1700;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    stars.renderOrder = -9;
    sky.add(stars);

    sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(55, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false, depthWrite: false }),
    );
    moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(38, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, depthWrite: false }),
    );
    sunDisc.renderOrder = -8;
    moonDisc.renderOrder = -8;
    sky.add(sunDisc, moonDisc);
    render.scene.add(sky);
  };

  const createLights = (): void => {
    sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.castShadow = render.shadowsEnabled();
    const size = render.shadowMapSize();
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = -110;
    cam.right = 110;
    cam.top = 110;
    cam.bottom = -110;
    cam.near = 20;
    cam.far = 620;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    render.scene.add(sun, sun.target);

    moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    render.scene.add(moon, moon.target);

    hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5b5040, 0.8);
    render.scene.add(hemi);
  };

  const createRain = (): void => {
    const r = new Rng(31);
    for (let i = 0; i < RAIN_DROPS; i++) {
      rainHead[i * 3] = r.range(-35, 35);
      rainHead[i * 3 + 1] = r.range(0, 40);
      rainHead[i * 3 + 2] = r.range(-35, 35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    rainLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xbfd4ee, transparent: true, opacity: 0.35, depthWrite: false, fog: false }),
    );
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    render.scene.add(rainLines);
  };

  const updateRain = (dt: number): void => {
    const cam = render.camera.position;
    rainLines.visible = cur.rain > 0.02;
    if (!rainLines.visible) return;
    const count = Math.max(1, Math.floor(RAIN_DROPS * cur.rain));
    rainLines.geometry.setDrawRange(0, count * 2);
    rainLines.position.set(cam.x, cam.y - 14, cam.z);
    for (let i = 0; i < count; i++) {
      let y = (rainHead[i * 3 + 1] as number) - 34 * dt;
      if (y < 0) y += 40;
      rainHead[i * 3 + 1] = y;
      const x = rainHead[i * 3] as number;
      const z = rainHead[i * 3 + 2] as number;
      rainPos[i * 6] = x;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 2] = z;
      rainPos[i * 6 + 3] = x + 0.12;
      rainPos[i * 6 + 4] = y + 1.2;
      rainPos[i * 6 + 5] = z + 0.05;
    }
    (rainLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  };

  const updateLighting = (dt: number): void => {
    // Ease the look towards the current weather.
    const target = LOOKS[weather];
    const k = 1 - Math.exp(-dt * 0.35);
    cur.cloud += (target.cloud - cur.cloud) * k;
    cur.rain += (target.rain - cur.rain) * k;
    cur.haze += (target.haze - cur.haze) * k;
    cur.visibility += (target.visibility - cur.visibility) * k;

    const h = hourFloat();
    night = nightFactor(h);
    const sy = sunHeight(h);
    const a = ((h - 6) / 12) * Math.PI;
    sunDir.set(Math.cos(a), Math.sin(a), 0.22).normalize();

    // Sky colours: day to night, a warm band at the horizon around sunrise and sunset, then weather.
    const twilight = clamp01(1 - Math.abs(sy) / 0.28);
    top.copy(DAY_TOP).lerp(NIGHT_TOP, night);
    bottom.copy(DAY_BOTTOM).lerp(NIGHT_BOTTOM, night);
    top.lerp(DUSK_TOP, twilight * 0.7);
    bottom.lerp(DUSK_BOTTOM, twilight * 0.85);
    const daylight = 1 - night * 0.85;
    tmp.copy(GRAY_TOP).multiplyScalar(daylight);
    top.lerp(tmp, cur.cloud * 0.85);
    tmp.copy(GRAY_BOTTOM).multiplyScalar(daylight);
    bottom.lerp(tmp, cur.cloud * 0.85);
    tmp.copy(HAZE_TOP).multiplyScalar(daylight);
    top.lerp(tmp, cur.haze * 0.7);
    tmp.copy(HAZE_BOTTOM).multiplyScalar(daylight);
    bottom.lerp(tmp, cur.haze * 0.7);

    // Lightning.
    if (weather === 'thunderstorm') {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flash = 1;
        flashTimer = visualRng.range(4, 12);
      }
    }
    flash = Math.max(0, flash - dt * 4);
    if (flash > 0) bottom.lerp(WHITE, flash * 0.5);

    const mat = dome.material as THREE.ShaderMaterial;
    (mat.uniforms.topColor as { value: THREE.Color }).value.copy(top);
    (mat.uniforms.bottomColor as { value: THREE.Color }).value.copy(bottom);
    const scene = render.scene;
    const camPos = render.camera.position;
    sky.position.copy(camPos);
    sunDisc.position.copy(sunDir).multiplyScalar(1500);
    moonDisc.position.copy(sunDir).multiplyScalar(-1500);
    sunDisc.visible = sy > -0.08 && cur.cloud < 0.9;
    moonDisc.visible = sy < 0.05 && night > 0.2 && cur.cloud < 0.8;
    (stars.material as THREE.PointsMaterial).opacity = clamp01(night * (1 - cur.cloud * 1.2));

    // Fog hides chunk pop-in and shrinks in rain and haze.
    const baseFar = (ctx.config.viewRadius + 0.5) * 160;
    const far = baseFar * (0.35 + 0.65 * cur.visibility);
    if (!(scene.fog instanceof THREE.Fog)) scene.fog = new THREE.Fog(bottom.getHex(), far * 0.3, far);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(bottom);
    fog.near = far * 0.3;
    fog.far = far;
    scene.background = null;

    // Lights.
    tmp.copy(WARM).lerp(WHITE, Math.min(1, Math.max(0, (sy - 0.1) / 0.4)));
    sun.color.copy(tmp);
    sun.intensity = 2.6 * clamp01(sy * 1.8) * (1 - 0.78 * cur.cloud);
    sun.castShadow = render.shadowsEnabled() && sy > 0.12 && cur.cloud < 0.92;
    const tx = Math.round(focusX / 4) * 4;
    const tz = Math.round(focusZ / 4) * 4;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx + sunDir.x * 250, sunDir.y * 250, tz + sunDir.z * 250);

    moon.intensity = sy < 0 ? 0.3 * night * (1 - cur.cloud * 0.6) : 0;
    moon.target.position.set(tx, 0, tz);
    moon.position.set(tx - sunDir.x * 200, Math.max(40, -sunDir.y * 200), tz - sunDir.z * 200);

    hemi.color.copy(top).lerp(WHITE, 0.45);
    hemi.intensity = (0.22 + 0.78 * (1 - night)) * (1 - 0.25 * cur.cloud) + flash * 2.5;

    lightingTimer += dt;
    if (lightingTimer >= 0.25) {
      lightingTimer = 0;
      ctx.events.emit('lightingChanged', { night, rain: cur.rain });
    }
  };

  return defineModule({
    id: 'env',
    version: '0.1.0',
    dependsOn: ['perf'],

    init(context) {
      ctx = context;
      render = ctx.services.get('render');
      rng = weatherRng(ctx.config.seed);
      Object.assign(cur, LOOKS.clear);

      createSky();
      createLights();
      createRain();

      offs.push(
        ctx.events.on('playerMoved', (e) => {
          focusX = e.x;
          focusZ = e.z;
        }),
      );
      ctx.services.register('env', service);

      ctx.onRender(50, (dt) => {
        updateLighting(dt);
        updateRain(dt);
      });
      updateLighting(0.016);
      ctx.events.emit('lightingChanged', { night, rain: cur.rain });
    },

    start() {
      total = START_MINUTE_OF_DAY;
      frac = 0;
      time = timeFromMinutes(total);
      weather = 'clear';
      Object.assign(cur, LOOKS.clear);
    },

    update(dt) {
      frac += dt * ctx.config.gameMinutesPerRealSecond;
      let guard = 0;
      while (frac >= 1 && guard < 120) {
        frac -= 1;
        guard++;
        stepMinute();
      }
    },

    serialize() {
      return { total, weather, rngState: rng.getState() };
    },

    deserialize(data) {
      const d = data as { total?: number; weather?: Weather; rngState?: number } | null;
      if (!d) return;
      if (typeof d.total === 'number') {
        total = Math.max(0, Math.floor(d.total));
        frac = 0;
        time = timeFromMinutes(total);
      }
      if (d.weather && d.weather in LOOKS) {
        weather = d.weather;
        Object.assign(cur, LOOKS[weather]);
      }
      if (typeof d.rngState === 'number') rng.setState(d.rngState);
    },

    dispose() {
      for (const off of offs) off();
      render.scene.remove(sky, sun, sun.target, moon, moon.target, hemi, rainLines);
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      sunDisc.geometry.dispose();
      (sunDisc.material as THREE.Material).dispose();
      moonDisc.geometry.dispose();
      (moonDisc.material as THREE.Material).dispose();
      rainLines.geometry.dispose();
      (rainLines.material as THREE.Material).dispose();
    },
  });
}

export { trafficFactor };
