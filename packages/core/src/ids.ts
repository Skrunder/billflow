/**
 * Identifier helpers shared by every data source.
 *
 * Occurrence ids are DETERMINISTIC: UUIDv5(templateId + "/" + originalDate).
 * The phone and the server therefore give the same id to the same schedule
 * slot, so occurrences generated offline never duplicate the server's copy
 * when they sync. Everything else uses random v4 UUIDs.
 *
 * Pure TypeScript (no Node crypto / WebCrypto) so it is synchronous and
 * identical in Node, browsers and Android WebViews.
 */

/** Fixed namespace for occurrence ids (chosen when BillFlow was called SKR's Bill Calendar). Never change it. */
export const OCCURRENCE_NAMESPACE = 'b1c5a7e2-3f4d-5a6b-8c9d-0e1f2a3b4c5d';

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** SHA-1 digest (20 bytes). Used only for UUIDv5, never for security. */
export function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8;
  const msg = [...bytes, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (ml >>> (i * 8)) & 0xff);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off + 4 * i]! << 24) | (msg[off + 4 * i + 1]! << 16) | (msg[off + 4 * i + 2]! << 8) | msg[off + 4 * i + 3]!;
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  return out;
}

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Invalid UUID "${uuid}"`);
  const out: number[] = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function bytesToUuid(b: number[]): string {
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** RFC 4122 version-5 (name-based, SHA-1) UUID. */
export function uuidv5(name: string, namespace: string): string {
  const hash = sha1([...uuidToBytes(namespace), ...utf8Bytes(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash);
}

/** The id of the occurrence a template has on a given schedule slot. */
export function occurrenceId(templateId: string, originalDate: string): string {
  return uuidv5(`${templateId.toLowerCase()}/${originalDate}`, OCCURRENCE_NAMESPACE);
}

/** Random v4 UUID using the platform's secure random source. */
export function randomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  const b = Array.from(c.getRandomValues(new Uint8Array(16)));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return bytesToUuid(b);
}
