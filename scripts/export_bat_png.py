#!/usr/bin/env python3
"""Rasterise the bat logo (from bat-logo.pixels.json) into transparent PNGs + favicon.

Produces, in web/public/:
  bat-512.png bat-256.png bat-128.png bat-64.png bat-32.png   (square, transparent)
  bat-logo-wide.png                                           (natural aspect)
and in web/app/:
  icon.png (512, Next.js app icon)   apple-icon.png (180)   favicon.ico (multi-size)
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "web", "public", "bat-logo")  # all logo assets live here
APP = os.path.join(HERE, "..", "web", "app")

WHITE = (255, 255, 255, 255)  # white on transparent

data = json.load(open(os.path.join(DIR, "bat-logo.pixels.json")))
W, H, PIX = data["W"], data["H"], data["pixels"]

def native_for(color):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for x, y in PIX:
        img.putpixel((x, y), color)
    return img

def render(native, size, margin=0.12):
    """Crisp square icon: NEAREST-scale the native bat to fit, centred, transparent."""
    inner = max(1, round(size * (1 - 2 * margin)))
    factor = inner / max(W, H)
    new = (max(1, round(W * factor)), max(1, round(H * factor)))
    scaled = native.resize(new, Image.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - new[0]) // 2, (size - new[1]) // 2), scaled)
    return canvas

os.makedirs(DIR, exist_ok=True)
os.makedirs(APP, exist_ok=True)
native = native_for(WHITE)

# white PNG set + wide logo, all in web/public/bat-logo/
for s in (512, 256, 128, 64, 32):
    render(native, s).save(os.path.join(DIR, f"bat-{s}.png"))
native.resize((W * 12, H * 12), Image.NEAREST).save(os.path.join(DIR, "bat-logo-wide.png"))
ico = render(native, 64, margin=0.06)
ico.save(os.path.join(DIR, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# Next.js app icons + favicon (must live in web/app/), white
render(native, 512).save(os.path.join(APP, "icon.png"))
render(native, 180, margin=0.10).save(os.path.join(APP, "apple-icon.png"))
ico.save(os.path.join(APP, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

print("wrote white PNG set + wide + favicon to web/public/bat-logo/, app icons to web/app/")
