import { describe, expect, it } from 'vitest';
import { supportsSync } from './client';

describe('server version check', () => {
  it('needs 1.2.0 or newer', () => {
    for (const v of ['1.2.0', '1.2.1', '1.10.0', '2.0.0', '1.3.0-beta.1']) expect(supportsSync(v)).toBe(true);
    for (const v of ['1.0.0', '1.1.0', '1.1.9', '0.9', undefined, '', 'dev']) expect(supportsSync(v)).toBe(false);
  });
});
