#!/usr/bin/env python3
"""Draws the Android launcher icons (same artwork as the web app's PWA icons).

Pure Python, no dependencies. Run from the repo root after changing the design:
    python3 scripts/android/icons.py
Writes frontend/android/app/src/main/res/mipmap-*/ic_launcher*.png.
"""
import os, struct, zlib

RES = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'android', 'app', 'src', 'main', 'res')
BG = (79, 70, 229)      # brand indigo, also @color/ic_launcher_background
WHITE = (255, 255, 255)
BAND = (199, 210, 254)
# density → (legacy icon px, adaptive layer px)
DENSITIES = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}


def rrect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def seg(px, py, ax, ay, bx, by, w):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= w * w


def artwork(x, y):
    """The calendar-with-check glyph in a unit square: 'body', 'band', 'ring', 'check' or None."""
    part = None
    if rrect(x, y, 0.19, 0.25, 0.81, 0.82, 0.08):
        part = 'band' if y < 0.40 else 'body'
    for rx in (0.34, 0.66):
        if rrect(x, y, rx - 0.035, 0.15, rx + 0.035, 0.32, 0.035):
            part = 'ring'
    if part in ('body', 'band') and (seg(x, y, 0.36, 0.62, 0.46, 0.72, 0.045) or seg(x, y, 0.46, 0.72, 0.66, 0.50, 0.045)):
        part = 'check'
    return part


def legacy(u, v, round_):
    """Pre-Android 8 icon: indigo rounded square (or circle) with the glyph."""
    if round_ and (u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25:
        return None
    if not round_ and not rrect(u, v, 0, 0, 1, 1, 0.22):
        return None
    part = artwork(u, v)
    return {None: BG, 'body': WHITE, 'band': BAND, 'ring': WHITE, 'check': BG}[part]


def layer(u, v, mono):
    """Adaptive-icon foreground (108dp canvas, glyph inside the 66dp safe zone)."""
    s = 0.62
    part = artwork((u - 0.5) / s + 0.5, (v - 0.5) / s + 0.5)
    if mono:  # Android 13+ themed icon: one colour, the check cut out
        return WHITE if part in ('body', 'band', 'ring') else None
    return {None: None, 'body': WHITE, 'band': BAND, 'ring': WHITE, 'check': BG}[part]


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
            row += bytes([r // a, g // a, b // a, round(255 * a / (ss * ss))]) if a else bytes(4)
        rows.append(bytes(row))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


for density, (icon, fg) in DENSITIES.items():
    d = os.path.join(RES, f'mipmap-{density}')
    os.makedirs(d, exist_ok=True)
    render(os.path.join(d, 'ic_launcher.png'), icon, lambda u, v: legacy(u, v, False))
    render(os.path.join(d, 'ic_launcher_round.png'), icon, lambda u, v: legacy(u, v, True))
    render(os.path.join(d, 'ic_launcher_foreground.png'), fg, lambda u, v: layer(u, v, False))
    render(os.path.join(d, 'ic_launcher_monochrome.png'), fg, lambda u, v: layer(u, v, True))
    print('wrote', d)
