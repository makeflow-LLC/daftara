#!/usr/bin/env python3
"""يولّد أيقونات التطبيق (PNG) بدون أي مكتبة خارجية.

    python3 icons/make-icons.py

ينتج: icon-192.png, icon-512.png, icon-maskable-512.png
شغّله فقط إذا أردت تغيير شكل الأيقونة أو ألوانها.
"""
import struct
import zlib
import os

BRAND = (14, 124, 90)        # #0e7c5a
BRAND_DARK = (10, 93, 67)    # #0a5d43
PAPER = (255, 255, 255)
LINE = (201, 211, 206)
RED = (198, 40, 40)
GREEN = (22, 121, 79)

SS = 3  # عيّنات فرعية لتنعيم الحواف


def rr(x, y, x0, y0, x1, y1, r):
    """هل النقطة داخل مستطيل بزوايا دائرية؟ (إحداثيات 0..1)"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def sample(x, y, inset):
    """لون النقطة (x,y) بإحداثيات 0..1. inset يصغّر الرسم لأيقونة maskable."""
    # الخلفية تملأ المربع كاملًا
    c = BRAND

    def m(v):
        return 0.5 + (v - 0.5) * inset

    # الدفتر
    px0, px1 = m(0.20), m(0.80)
    py0, py1 = m(0.18), m(0.82)
    if rr(x, y, px0, py0, px1, py1, 0.05 * inset):
        c = PAPER
        # كعب الدفتر على اليمين (اتجاه من اليمين لليسار)
        sx0 = px1 - 0.10 * inset
        if x >= sx0:
            c = BRAND_DARK
        else:
            w0, w1 = px0 + 0.06 * inset, sx0 - 0.05 * inset
            rows = [
                (0.30, LINE, 1.00),
                (0.44, RED, 0.70),
                (0.58, GREEN, 0.50),
                (0.72, LINE, 0.85),
            ]
            for ry, col, frac in rows:
                cy = m(ry)
                h = 0.035 * inset
                if abs(y - cy) <= h / 2 and w0 <= x <= w0 + (w1 - w0) * frac:
                    c = col
    return c


def render(size, inset=1.0):
    n = size * SS
    rows = []
    inv = 1.0 / n
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = 0
            for sy in range(SS):
                y = (py * SS + sy + 0.5) * inv
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) * inv
                    c = sample(x, y, inset)
                    r += c[0]
                    g += c[1]
                    b += c[2]
            k = SS * SS
            row += bytes((r // k, g // k, b // k))
        rows.append(row)
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print(path, os.path.getsize(path), 'bytes')


here = os.path.dirname(os.path.abspath(__file__))
for size, inset, name in ((192, 1.0, 'icon-192.png'),
                          (512, 1.0, 'icon-512.png'),
                          (512, 0.72, 'icon-maskable-512.png')):
    write_png(os.path.join(here, name), size, render(size, inset))
