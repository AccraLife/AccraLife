import { describe, expect, it } from 'vitest';
import { EventBus } from './eventBus';
import { defineModule, orderModules } from './module';
import { Rng, hashCoords, noise2, valueNoise2 } from './rng';
import { ServiceRegistry } from './services';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('restores state', () => {
    const a = new Rng(7);
    a.next();
    const state = a.getState();
    const x = a.next();
    a.setState(state);
    expect(a.next()).toBe(x);
  });

  it('stays in range', () => {
    const r = new Rng(99);
    for (let i = 0; i < 500; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('hash and noise are stable', () => {
    expect(hashCoords(1, 2, 3)).toBe(hashCoords(1, 2, 3));
    expect(hashCoords(1, 2, 3)).not.toBe(hashCoords(1, 3, 2));
    const n = noise2(5, 10, -4);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
    const v = valueNoise2(5, 1.5, 2.25);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('EventBus', () => {
  interface E {
    ping: { n: number };
  }

  it('delivers payloads and supports unsubscribe', () => {
    const bus = new EventBus<E>();
    const seen: number[] = [];
    const off = bus.on('ping', (p) => seen.push(p.n));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(seen).toEqual([1]);
  });

  it('once fires a single time', () => {
    const bus = new EventBus<E>();
    let count = 0;
    bus.once('ping', () => count++);
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 1 });
    expect(count).toBe(1);
  });

  it('a throwing handler does not stop the others', () => {
    const bus = new EventBus<E>();
    let ok = false;
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', () => {
      ok = true;
    });
    const original = console.error;
    console.error = () => {};
    bus.emit('ping', { n: 1 });
    console.error = original;
    expect(ok).toBe(true);
  });
});

describe('orderModules', () => {
  const mod = (id: string, dependsOn: string[] = []) => defineModule({ id, version: '0.0.0', dependsOn });

  it('puts dependencies first', () => {
    const order = orderModules([mod('c', ['b']), mod('b', ['a']), mod('a')]).map((m) => m.id);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('detects cycles', () => {
    expect(() => orderModules([mod('a', ['b']), mod('b', ['a'])])).toThrow(/cycle/);
  });

  it('detects missing dependencies', () => {
    expect(() => orderModules([mod('a', ['nope'])])).toThrow(/missing/);
  });

  it('rejects duplicate ids', () => {
    expect(() => orderModules([mod('a'), mod('a')])).toThrow(/duplicate/);
  });
});

describe('ServiceRegistry', () => {
  it('throws for unregistered services and blocks double registration', () => {
    const reg = new ServiceRegistry();
    expect(() => reg.get('world')).toThrow(/not registered/);
    expect(reg.tryGet('world')).toBeUndefined();
    const fake = { now: () => ({}) } as never;
    reg.register('env', fake);
    expect(() => reg.register('env', fake)).toThrow(/already/);
    expect(reg.has('env')).toBe(true);
  });
});
