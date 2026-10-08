#!/usr/bin/env python3
"""Draws the BillFlow icons: a bill holding a flowing wave, over flowing waves
on an indigo-to-cyan gradient. One artwork for the web app and the Android app.

Pure Python, no dependencies. Run from the repo root after changing the design:
    python3 scripts/icons.py
Writes frontend/public/billflow.svg, frontend/public/icons/*.png and
frontend/android/app/src/main/res/mipmap-*/ic_launcher*.png.
Rename the web files when the artwork changes: browsers keep icons cached
under their old URLs (favicon cache, installed PWAs) and ignore new content.
"""
import math, os, struct, zlib

ROOT = os.path.join(os.path.dirname(__file__), '..', 'frontend')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
WEB = os.path.join(ROOT, 'public')
INDIGO = (79, 70, 229)  # brand-600, also @color/ic_launcher_background (splash screen)
CYAN = (6, 182, 212)
WHITE = (255, 255, 255)
LINE = (199, 210, 254)  # brand-200
# density → (legacy icon px, adaptive layer px)
DENSITIES = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}

# ── artwork, in a unit square ──
BILL = (0.27, 0.73, 0.19, 0.81)  # x0, x1, top, bottom
TEETH, TOOTH = 4, 0.07
WAVE_X, WAVE_Y, WAVE_A, WAVE_W = (0.35, 0.65), 0.585, 0.055, 0.032


def mix(c, d, t):
    t = max(0.0, min(1.0, t))
    return tuple(c[i] + (d[i] - c[i]) * t for i in range(3))


def rrect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def gradient_t(x, y):
    return x * 0.55 + y * 0.75 - 0.1


def bg_wave(n, x):
    return (0.62 + 0.05 * math.sin(2 * math.pi * x * 1.05 + 0.4)) if n == 1 else (0.75 + 0.045 * math.sin(2 * math.pi * x * 1.05 + 2.3))


def wave_points(n=48):
    x0, x1 = WAVE_X
    return [(x0 + (x1 - x0) * k / n, WAVE_Y - WAVE_A * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]


WAVE = wave_points()


def in_bill(x, y):
    x0, x1, top, bottom = BILL
    if not rrect(x, y, x0, top, x1, bottom + 1, 0.06) or y > bottom:
        return False
    f = ((x - x0) / ((x1 - x0) / TEETH)) % 1
    return y <= bottom - TOOTH * (1 - abs(2 * f - 1))


def glyph(x, y):
    """'paper', 'line', 'wave' or None."""
    if not in_bill(x, y):
        return None
    if rrect(x, y, 0.35, 0.285, 0.62, 0.335, 0.025) or rrect(x, y, 0.35, 0.375, 0.53, 0.425, 0.025):
        return 'line'
    if min((x - px) ** 2 + (y - py) ** 2 for px, py in WAVE) <= WAVE_W ** 2:
        return 'wave'
    return 'paper'


def background(x, y):
    c = mix(INDIGO, CYAN, gradient_t(x, y))
    if y > bg_wave(1, x):
        c = mix(c, WHITE, 0.18)
    if y > bg_wave(2, x):
        c = mix(c, WHITE, 0.22)
    return c


def paint(x, y):
    g = glyph(x, y)
    if g == 'paper':
        return WHITE
    if g == 'line':
        return LINE
    if g == 'wave':
        return mix(INDIGO, CYAN, (x - WAVE_X[0]) / (WAVE_X[1] - WAVE_X[0]))
    return background(x, y)


def scaled(f, s):
    """The artwork shrunk to s around the centre (for safe zones)."""
    return lambda u, v: f((u - 0.5) / s + 0.5, (v - 0.5) / s + 0.5)


def full_icon(shape, s=1.0):
    def color(u, v):
        if shape == 'square' and not rrect(u, v, 0, 0, 1, 1, 0.22):
            return None
        if shape == 'circle' and (u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25:
            return None
        g = scaled(glyph, s)(u, v)
        return scaled(paint, s)(u, v) if g else background(u, v)
    return color


def render(path, size, color):
    ss = 3
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            r = g = b = a = 0
            for p in range(ss):
                for q in range(ss):
                    c = color((i + (p + 0.5) / ss) / size, (j + (q + 0.5) / ss) / size)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            row += bytes([int(r / a), int(g / a), int(b / a), round(255 * a / (ss * ss))]) if a else bytes(4)
        rows.append(bytes(row))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', os.path.relpath(path))


def svg():
    """The same artwork as a 64×64 SVG (favicon and in-app logo)."""
    u = lambda v: f'{v * 64:.2f}'.rstrip('0').rstrip('.')
    x0, x1, top, bottom = BILL
    step = (x1 - x0) / TEETH
    zig = ' '.join(f'L{u(x1 - step * (k + 0.5))} {u(bottom - TOOTH)} L{u(x1 - step * (k + 1))} {u(bottom)}' for k in range(TEETH))
    bill = f'M{u(x0)} {u(top + 0.06)} a{u(0.06)} {u(0.06)} 0 0 1 {u(0.06)} -{u(0.06)} H{u(x1 - 0.06)} a{u(0.06)} {u(0.06)} 0 0 1 {u(0.06)} {u(0.06)} V{u(bottom)} {zig} Z'
    def band(n):
        pts = ' '.join(f'L{u(k / 32)} {u(bg_wave(n, k / 32))}' for k in range(33))
        return f'M0 64 {pts} L64 64 Z'
    wave = 'M' + ' L'.join(f'{u(x)} {u(y)}' for x, y in wave_points(24))
    # gradient_t = 0 → 1 along (0.55, 0.75)
    d = 0.55 ** 2 + 0.75 ** 2
    gx0, gy0, gx1, gy1 = (0.1 * 0.55 / d, 0.1 * 0.75 / d, 1.1 * 0.55 / d, 1.1 * 0.75 / d)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Generated by scripts/icons.py -->
  <defs>
    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="{u(gx0)}" y1="{u(gy0)}" x2="{u(gx1)}" y2="{u(gy1)}">
      <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="wave" gradientUnits="userSpaceOnUse" x1="{u(WAVE_X[0])}" y1="0" x2="{u(WAVE_X[1])}" y2="0">
      <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <clipPath id="shape"><rect width="64" height="64" rx="{u(0.22)}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="64" height="64" fill="url(#bg)"/>
    <path d="{band(1)}" fill="#fff" fill-opacity="0.18"/>
    <path d="{band(2)}" fill="#fff" fill-opacity="0.22"/>
  </g>
  <path d="{bill}" fill="#fff"/>
  <rect x="{u(0.35)}" y="{u(0.285)}" width="{u(0.27)}" height="{u(0.05)}" rx="{u(0.025)}" fill="#c7d2fe"/>
  <rect x="{u(0.35)}" y="{u(0.375)}" width="{u(0.18)}" height="{u(0.05)}" rx="{u(0.025)}" fill="#c7d2fe"/>
  <path d="{wave}" fill="none" stroke="url(#wave)" stroke-width="{u(WAVE_W * 2)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''


if __name__ == '__main__':
    with open(os.path.join(WEB, 'billflow.svg'), 'w') as f:
        f.write(svg())
    print('wrote frontend/public/billflow.svg')
    icons = os.path.join(WEB, 'icons')
    render(os.path.join(icons, 'billflow-192.png'), 192, full_icon('square'))
    render(os.path.join(icons, 'billflow-512.png'), 512, full_icon('square'))
    # Maskable: full bleed, artwork inside the 80% safe zone.
    render(os.path.join(icons, 'billflow-maskable-512.png'), 512, full_icon(None, 0.8))
    render(os.path.join(icons, 'billflow-apple-touch.png'), 180, full_icon(None, 0.86))

    for density, (icon, layer) in DENSITIES.items():
        d = os.path.join(RES, f'mipmap-{density}')
        os.makedirs(d, exist_ok=True)
        render(os.path.join(d, 'ic_launcher.png'), icon, full_icon('square'))
        render(os.path.join(d, 'ic_launcher_round.png'), icon, full_icon('circle', 0.92))
        # Adaptive icon (Android 8+): 108dp layers, artwork inside the 66dp safe zone.
        render(os.path.join(d, 'ic_launcher_background.png'), layer, background)
        render(os.path.join(d, 'ic_launcher_foreground.png'), layer, lambda u, v: scaled(paint, 0.62)(u, v) if scaled(glyph, 0.62)(u, v) else None)
        # Android 13+ themed icon: one colour, the lines and wave cut out of the bill.
        render(os.path.join(d, 'ic_launcher_monochrome.png'), layer, lambda u, v: WHITE if scaled(glyph, 0.62)(u, v) == 'paper' else None)
