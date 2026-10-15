import { describe, expect, it } from 'vitest';
import { checksumOf, makeEnvelope, parseEnvelope, slotLabel } from './envelope';

const mods = { economy: { version: '0.1.0', data: { balance: 12.5 } }, life: { version: '0.1.0', data: { hunger: 80 } } };

describe('save envelope', () => {
  it('round trips', () => {
    const env = makeEnvelope('0.1.0', 'Day 1', mods, 1000);
    const parsed = parseEnvelope(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope.modules.economy?.data).toEqual({ balance: 12.5 });
  });

  it('detects edits', () => {
    const env = makeEnvelope('0.1.0', 'Day 1', mods, 1000);
    const text = JSON.stringify(env).replace('12.5', '99999');
    const parsed = parseEnvelope(text);
    expect(parsed.ok).toBe(false);
  });

  it('rejects junk and newer formats', () => {
    expect(parseEnvelope('not json').ok).toBe(false);
    expect(parseEnvelope('null').ok).toBe(false);
    expect(parseEnvelope('{"format":999,"modules":{}}').ok).toBe(false);
    expect(parseEnvelope('{"modules":{}}').ok).toBe(false);
  });

  it('checksum is stable and sensitive', () => {
    expect(checksumOf('abc')).toBe(checksumOf('abc'));
    expect(checksumOf('abc')).not.toBe(checksumOf('abd'));
  });

  it('formats labels', () => {
    expect(slotLabel(0, 7, 5, 'GHS 60.00')).toBe('Day 1, 07:05 - GHS 60.00');
  });
});
