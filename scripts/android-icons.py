#!/usr/bin/env python3
"""يولّد أيقونات أندرويد وشاشة البداية من أيقونات الويب في icons/.

    python3 scripts/android-icons.py

شغّله فقط بعد تغيير icons/*.png. يحتاج Pillow.
"""
import glob
import os
from PIL import Image, ImageDraw

RES = 'android/app/src/main/res'
BRAND = (14, 122, 81, 255)    # خلفية الأيقونة القابلة للقص
PAPER = (243, 242, 242, 255)  # خلفية شاشة البداية

maskable = Image.open('icons/icon-maskable-512.png').convert('RGBA')
plain = Image.open('icons/icon-512.png').convert('RGBA')

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

for name, k in DENSITIES.items():
    d = f'{RES}/mipmap-{name}'
    # الأيقونة التكيفية: لوحة 108dp، والمنطقة الآمنة 66dp.
    # المنطقة الآمنة في الأيقونة القابلة للقص 80% منها، فنصغّرها لتقع داخل الـ 66dp.
    fg = round(108 * k)
    inner = round(66 / 0.8 * k)
    canvas = Image.new('RGBA', (fg, fg), BRAND)
    off = (fg - inner) // 2
    canvas.paste(maskable.resize((inner, inner), Image.LANCZOS), (off, off))
    canvas.save(f'{d}/ic_launcher_foreground.png')

    # الأيقونات القديمة (قبل أندرويد 8)
    size = round(48 * k)
    legacy = plain.resize((size, size), Image.LANCZOS)
    legacy.save(f'{d}/ic_launcher.png')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    rnd = maskable.resize((size, size), Image.LANCZOS)
    rnd.putalpha(mask)
    rnd.save(f'{d}/ic_launcher_round.png')

# شاشة البداية: ورق فاتح وفي وسطه الأيقونة
for f in glob.glob(f'{RES}/drawable*/splash.png'):
    w, h = Image.open(f).size
    img = Image.new('RGBA', (w, h), PAPER)
    s = round(min(w, h) * 0.28)
    img.paste(plain.resize((s, s), Image.LANCZOS), ((w - s) // 2, (h - s) // 2))
    img.convert('RGB').save(f)

with open(f'{RES}/values/ic_launcher_background.xml', 'w') as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
             '    <color name="ic_launcher_background">#0E7A51</color>\n</resources>\n')
print('done')
