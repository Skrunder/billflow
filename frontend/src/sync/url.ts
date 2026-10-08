/**
 * Server addresses entered in "Connect to server". Plain http:// is accepted
 * only for addresses on a home network; anything reachable from the internet
 * must use https:// (the password and all data would otherwise be readable
 * on the way).
 */

export class ServerUrlError extends Error {}

/** True for loopback, private (RFC 1918 / ULA), link-local and local-only host names. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || h.endsWith('.internal')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  // A single-label name ("nas", "unraid") only resolves on the local network.
  return !h.includes('.');
}

/** "192.168.1.5:7070" → { url: "http://192.168.1.5:7070", insecure: true }. */
export function normalizeServerUrl(input: string): { url: string; insecure: boolean } {
  const raw = input.trim();
  if (!raw) throw new ServerUrlError('Enter the address of your server.');
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new ServerUrlError('That is not a valid address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ServerUrlError('The address must start with http:// or https://.');
  if (parsed.username || parsed.password) throw new ServerUrlError('Leave the user name and password out of the address.');
  const insecure = parsed.protocol === 'http:';
  if (insecure && !isPrivateHost(parsed.hostname)) {
    throw new ServerUrlError('Plain http:// only works on your home network. Use https:// for this address.');
  }
  // People often paste the API address or a page of the app.
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '').replace(/\/(login|settings)$/, '');
  return { url: `${parsed.protocol}//${parsed.host}${path}`, insecure };
}
