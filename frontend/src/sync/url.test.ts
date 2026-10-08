import { describe, expect, it } from 'vitest';
import { isPrivateHost, normalizeServerUrl } from './url';

describe('server addresses', () => {
  it('accepts what people type and cleans it up', () => {
    expect(normalizeServerUrl(' 192.168.85.232:7070 ')).toEqual({ url: 'http://192.168.85.232:7070', insecure: true });
    expect(normalizeServerUrl('https://bills.example.com/')).toEqual({ url: 'https://bills.example.com', insecure: false });
    expect(normalizeServerUrl('https://example.com/bills/api/v1')).toEqual({ url: 'https://example.com/bills', insecure: false });
    expect(normalizeServerUrl('http://nas:8080/login')).toEqual({ url: 'http://nas:8080', insecure: true });
  });

  it('allows plain http only on the home network', () => {
    for (const h of ['10.0.0.2', '172.20.1.1', '192.168.0.10', '127.0.0.1', 'localhost', 'unraid', 'nas.local', 'fd12:3456::1', '100.101.102.103']) expect(isPrivateHost(h)).toBe(true);
    for (const h of ['8.8.8.8', '172.32.0.1', 'bills.example.com', '2001:db8::1']) expect(isPrivateHost(h)).toBe(false);
    expect(() => normalizeServerUrl('http://bills.example.com')).toThrow('https://');
    expect(() => normalizeServerUrl('ftp://192.168.1.2')).toThrow();
    expect(() => normalizeServerUrl('https://user:pw@example.com')).toThrow();
    expect(() => normalizeServerUrl('')).toThrow();
  });
});
