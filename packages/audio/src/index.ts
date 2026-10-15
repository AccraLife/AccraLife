import { type GameContext, type GameModule, defineModule } from '@accra/core';

/**
 * AUD: sound (SRS section 14, first slice).
 * Everything is synthesised with WebAudio, so there are no audio files to ship or license.
 * City hum, night crickets, rain, footsteps, coin and UI blips, vehicle horns and a tiny "Highlife FM" radio (press R).
 * The AudioContext is created on the first user gesture, as browsers require.
 */

const STATION = 'Highlife FM';
// A minor pentatonic-ish scale in Hz, with a lilting bass pattern.
const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
const BASS = [110, 110, 130.81, 98];

export function createAudioModule(): GameModule {
  let ctx: GameContext;
  let ac: AudioContext | null = null;
  let master: GainNode;
  let hum: GainNode;
  let crickets: GainNode;
  let rain: GainNode;
  let radioGain: GainNode;
  let noise: AudioBuffer;
  let radioOn = false;
  let radioTimer = 0;
  let nextBeat = 0;
  let beat = 0;
  let night = 0;
  let rainLevel = 0;
  const offs: Array<() => void> = [];
  const cleanup: Array<() => void> = [];

  const makeNoise = (audio: AudioContext): AudioBuffer => {
    const buf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  const noiseSource = (audio: AudioContext): AudioBufferSourceNode => {
    const src = audio.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    return src;
  };

  const build = (): void => {
    if (ac) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ac = new Ctor();
    noise = makeNoise(ac);
    master = ac.createGain();
    master.gain.value = ctx.config.masterVolume;
    master.connect(ac.destination);

    // City hum: low-passed noise.
    hum = ac.createGain();
    hum.gain.value = 0.0;
    const humFilter = ac.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 380;
    const humSrc = noiseSource(ac);
    humSrc.connect(humFilter).connect(hum).connect(master);
    humSrc.start();

    // Rain: high-passed noise.
    rain = ac.createGain();
    rain.gain.value = 0;
    const rainFilter = ac.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1400;
    const rainSrc = noiseSource(ac);
    rainSrc.connect(rainFilter).connect(rain).connect(master);
    rainSrc.start();

    // Crickets: a high tone chopped by a fast LFO.
    crickets = ac.createGain();
    crickets.gain.value = 0;
    const cricketTone = ac.createOscillator();
    cricketTone.frequency.value = 4300;
    const chop = ac.createGain();
    chop.gain.value = 0;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 7;
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(chop.gain);
    chop.gain.value = 0.5;
    cricketTone.connect(chop).connect(crickets).connect(master);
    cricketTone.start();
    lfo.start();

    radioGain = ac.createGain();
    radioGain.gain.value = 0.35;
    radioGain.connect(master);

    cleanup.push(() => {
      for (const s of [humSrc, rainSrc, cricketTone, lfo]) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
    });
  };

  const blip = (freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0): void => {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  const burst = (freq: number, dur: number, vol: number): void => {
    if (!ac) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  };

  const horn = (x: number, z: number): void => {
    if (!ac) return;
    const p = ctx.services.get('player').position();
    const d = Math.hypot(p.x - x, p.z - z);
    const vol = Math.max(0, 0.22 * (1 - d / 90));
    if (vol <= 0.005) return;
    blip(392, 0.35, 'square', vol);
    blip(494, 0.35, 'square', vol * 0.8);
  };

  const scheduleRadio = (): void => {
    if (!ac || !radioOn) return;
    const bpm = 104;
    const eighth = 60 / bpm / 2;
    while (nextBeat < ac.currentTime + 0.3) {
      const step = beat % 16;
      const t = Math.max(nextBeat, ac.currentTime) - ac.currentTime;
      if (step % 4 === 0) {
        const bass = BASS[(beat >> 2) % BASS.length] as number;
        radioNote(bass, eighth * 3, 'triangle', 0.5, t);
      }
      // A lilting highlife-like figure on the off-beats.
      if (step % 2 === 1 || step === 0 || step === 6 || step === 10) {
        const idx = (step * 3 + (beat >> 4) * 2) % SCALE.length;
        radioNote(SCALE[idx] as number, eighth * 0.9, 'sine', 0.28, t);
      }
      if (step % 4 === 2) burstRadio(t);
      nextBeat += eighth;
      beat++;
    }
  };

  const radioNote = (freq: number, dur: number, type: OscillatorType, vol: number, delay: number): void => {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(radioGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  /** Body impacts: a low thump when someone hits the ground, a crunch for cars, a soft oof for bumps. */
  const bodySound = (strength: number, kind: string, thud: boolean, gain: number): void => {
    if (!ac) return;
    const k = Math.min(1, strength / 9) * gain;
    if (thud) {
      burst(120, 0.14 + 0.1 * k, 0.5 * k + 0.1 * gain);
      blip(70, 0.18, 'sine', 0.35 * k);
      return;
    }
    if (kind === 'vehicle') {
      burst(260, 0.25, 0.6 * gain);
      blip(90, 0.3, 'sawtooth', 0.2 * gain);
    } else if (kind === 'wall') {
      burst(180, 0.1, 0.35 * k + 0.1);
    } else if (kind === 'bump' || kind === 'shove') {
      burst(400, 0.07, 0.25 * k + 0.08);
      blip(210, 0.12, 'triangle', 0.18 * gain);
    }
  };

  const burstRadio = (delay: number): void => {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(radioGain);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  };

  const setRadio = (on: boolean): void => {
    if (!ac || on === radioOn) return;
    radioOn = on;
    if (on) {
      nextBeat = ac.currentTime + 0.05;
      beat = 0;
      radioTimer = window.setInterval(scheduleRadio, 100);
    } else {
      window.clearInterval(radioTimer);
    }
    ctx.events.emit('radioChanged', { station: on ? STATION : null });
    ctx.events.emit('notify', { text: on ? `Radio on: ${STATION}` : 'Radio off', kind: 'info' });
  };

  const mix = (): void => {
    if (!ac) return;
    const t = ac.currentTime;
    hum.gain.setTargetAtTime(0.05 * (1 - 0.6 * night), t, 0.5);
    crickets.gain.setTargetAtTime(0.012 * night * (1 - rainLevel), t, 1);
    rain.gain.setTargetAtTime(0.16 * rainLevel, t, 0.6);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR' && !e.repeat && ctx.state.phase === 'playing') setRadio(!radioOn);
  };
  const unlock = (): void => {
    build();
    void ac?.resume();
  };

  return defineModule({
    id: 'audio',
    version: '0.1.0',
    dependsOn: ['env', 'player'],

    init(context) {
      ctx = context;
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      cleanup.push(() => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      });
      offs.push(
        ctx.events.on('lightingChanged', (e) => {
          night = e.night;
          rainLevel = e.rain;
          mix();
        }),
        ctx.events.on('settingsChanged', ({ key }) => {
          if (key === 'masterVolume' && ac) master.gain.setTargetAtTime(ctx.config.masterVolume, ac.currentTime, 0.05);
        }),
        ctx.events.on('phaseChanged', ({ phase }) => {
          if (!ac) return;
          if (phase === 'paused') void ac.suspend();
          else void ac.resume();
        }),
        ctx.events.on('footstep', ({ surface }) => {
          if (surface === 'road') burst(700, 0.08, 0.12);
          else if (surface === 'sidewalk') burst(1400, 0.06, 0.1);
          else burst(450, 0.1, 0.1);
        }),
        ctx.events.on('moneyChanged', ({ delta }) => {
          if (delta > 0) {
            blip(880, 0.12, 'triangle', 0.15);
            blip(1320, 0.18, 'triangle', 0.12, 0.08);
          } else if (delta < 0) {
            blip(520, 0.1, 'triangle', 0.1);
          }
        }),
        ctx.events.on('notify', ({ kind }) => {
          if (kind === 'warn') blip(240, 0.18, 'sawtooth', 0.06);
          else if (kind === 'good') blip(660, 0.12, 'sine', 0.1);
        }),
        ctx.events.on('honk', ({ x, z }) => horn(x, z)),
        ctx.events.on('impact', ({ strength, kind, thud }) => bodySound(strength, kind, thud, 1)),
        ctx.events.on('npcImpact', ({ x, z, strength, kind, thud }) => {
          const p = ctx.services.tryGet('player')?.position();
          const d = p ? Math.hypot(p.x - x, p.z - z) : 0;
          if (d < 40) bodySound(strength, kind, thud, 1 / (1 + d * 0.25));
        }),
        ctx.events.on('powerChanged', ({ on }) => blip(on ? 300 : 150, 0.3, 'square', 0.05)),
      );
    },

    start() {
      mix();
    },

    dispose() {
      for (const off of offs) off();
      window.clearInterval(radioTimer);
      for (const fn of cleanup) fn();
      void ac?.close();
      ac = null;
    },
  });
}
