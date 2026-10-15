import { describe, expect, it } from 'vitest';
import { Rng } from '@accra/core';
import { type Sense, newBrain, paceFor, stepBrain, streetActivity } from './behavior';

const calm = (over: Partial<Sense> = {}): Sense => ({
  dt: 0.033,
  hour: 12,
  raining: false,
  distToPlayer: 80,
  playerRelYaw: 0,
  playerSpeed: 0,
  playerAhead: Infinity,
  honkDist: Infinity,
  arrived: false,
  ...over,
});

describe('street activity', () => {
  it('peaks at rush hours and is quiet at night', () => {
    expect(streetActivity(8)).toBe(1);
    expect(streetActivity(17)).toBe(1);
    expect(streetActivity(2)).toBeLessThan(streetActivity(12));
    expect(paceFor(7)).toBeGreaterThan(paceFor(12));
    expect(paceFor(23)).toBeLessThan(paceFor(12));
  });
});

describe('brain', () => {
  it('walks by default', () => {
    const rng = new Rng(1);
    const b = newBrain(rng);
    expect(stepBrain(b, calm(), rng).move).toBe(1);
  });

  it('sometimes pauses at corners, never mid-block', () => {
    const rng = new Rng(2);
    let paused = 0;
    for (let i = 0; i < 400; i++) {
      const b = newBrain(rng);
      stepBrain(b, calm({ arrived: true }), rng);
      if (b.mode === 'pause') paused++;
      const c = newBrain(rng);
      stepBrain(c, calm(), rng);
      expect(c.mode).toBe('walk');
    }
    expect(paused).toBeGreaterThan(10);
    expect(paused).toBeLessThan(120);
  });

  it('a pause ends and walking resumes', () => {
    const rng = new Rng(3);
    const b = newBrain(rng);
    b.mode = 'pause';
    b.timer = 0.2;
    expect(stepBrain(b, calm(), rng).move).toBe(0);
    for (let i = 0; i < 20; i++) stepBrain(b, calm(), rng);
    expect(b.mode).toBe('walk');
  });

  it('chatters and vendors stay put', () => {
    const rng = new Rng(4);
    const chat = newBrain(rng, 'chat');
    chat.timer = 30;
    const out = stepBrain(chat, calm(), rng);
    expect(out.move).toBe(0);
    expect(out.talking).toBe(true);
    expect(stepBrain(newBrain(rng, 'stand'), calm(), rng).move).toBe(0);
  });

  it('flinches and stops at a nearby horn, once per cooldown', () => {
    const rng = new Rng(5);
    const b = newBrain(rng);
    const out = stepBrain(b, calm({ honkDist: 10 }), rng);
    expect(out.startle).toBeGreaterThan(0.9);
    expect(out.move).toBe(0);
    for (let i = 0; i < 60; i++) stepBrain(b, calm(), rng);
    expect(b.startle).toBe(0);
    const again = stepBrain(b, calm({ honkDist: 10 }), rng);
    expect(again.startle).toBeLessThan(0.1);
    const far = stepBrain(newBrain(rng), calm({ honkDist: 80 }), rng);
    expect(far.startle).toBe(0);
  });

  it('waves at a nearby player, but not every time', () => {
    const rng = new Rng(6);
    let waved = 0;
    for (let i = 0; i < 300; i++) {
      const b = newBrain(rng);
      b.greetCooldown = 0;
      const out = stepBrain(b, calm({ distToPlayer: 3, playerRelYaw: 0.2 }), rng);
      if (out.wave) waved++;
    }
    expect(waved).toBeGreaterThan(40);
    expect(waved).toBeLessThan(200);
    const behind = newBrain(rng);
    behind.greetCooldown = 0;
    expect(stepBrain(behind, calm({ distToPlayer: 3, playerRelYaw: 3 }), rng).wave).toBe(false);
  });

  it('steps aside for a player walking at them', () => {
    const rng = new Rng(7);
    const b = newBrain(rng);
    const out = stepBrain(b, calm({ playerAhead: 1.2, playerSpeed: 3, distToPlayer: 1.2 }), rng);
    expect(out.move).toBe(0);
    expect(out.lookAtPlayer).toBe(true);
  });

  it('opens umbrellas in rain for some people and hurries the rest', () => {
    const rng = new Rng(8);
    let umbrellas = 0;
    for (let i = 0; i < 200; i++) {
      const b = newBrain(rng);
      const out = stepBrain(b, calm({ raining: true }), rng);
      if (out.umbrella) umbrellas++;
      else expect(out.move).toBeGreaterThan(1);
    }
    expect(umbrellas).toBeGreaterThan(50);
    expect(umbrellas).toBeLessThan(130);
    const b = newBrain(rng);
    b.umbrella = true;
    b.rainDecided = true;
    stepBrain(b, calm({ raining: false }), rng);
    expect(b.umbrella).toBe(false);
  });
});
