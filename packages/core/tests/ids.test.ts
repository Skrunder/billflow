import { describe, expect, it } from 'vitest';
import { occurrenceId, randomUuid, sha1, uuidv5 } from '../src/ids.js';

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('ids', () => {
  it('computes SHA-1 correctly (FIPS 180 test vectors)', () => {
    expect(hex(sha1(bytes('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1([]))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  it('matches reference UUIDv5 values (Python uuid.uuid5)', () => {
    expect(uuidv5('hello', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('9342d47a-1bab-5709-9869-c840b2eac501');
    expect(uuidv5('https://example.com/x', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')).toBe('49517db3-5541-5e91-9cd4-395dd68a97ac');
  });

  it('gives each (template, slot) one stable occurrence id', () => {
    const t = '45AF4F88-6397-46F7-9C4A-AADA1C66AC5B';
    const a = occurrenceId(t, '2026-10-15');
    expect(a).toBe(occurrenceId(t.toLowerCase(), '2026-10-15'));
    expect(a).not.toBe(occurrenceId(t, '2026-11-15'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates random v4 UUIDs', () => {
    const a = randomUuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomUuid()).not.toBe(a);
  });
});
