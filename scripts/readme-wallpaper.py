"""The wallpaper of the desktop-widget pictures (README, homepage, Store): 「D 새벽 능선」, the owner's pick (2026-11-14), drawn at the
picture's own pixel size so no curve is stretched, and N, the same ridges at night for a dark picture. The pictures never show the
user's own wallpaper (scripts/readme-desktop.cjs). Light enough that the widget glass stays light with dark text; a fine grain keeps
gradients from banding. Same seeds, same ridges at every size; the same drawing as the homepage draft's 위젯 배경/wallpaper.py, which
also holds the drafts not picked (A silk, B mesh, C hills, E).
usage: py -3 -I scripts/readme-wallpaper.py <out dir> <width> <height> [D N]   (default D N) -> <out dir>/wall-D.png, wall-N.png"""
import math, os, sys
import numpy as np
from PIL import Image

out, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
which = sys.argv[4:] or ['D', 'N']
os.makedirs(out, exist_ok=True)
u = np.linspace(0, 1, W, dtype=np.float32)[None, :].repeat(H, 0)
v = np.linspace(0, 1, H, dtype=np.float32)[:, None].repeat(W, 1)
aspect = W / H

def hexc(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def mix(a, b, t):
    t = t[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t

def glow(cx, cy, r):
    d2 = ((u - cx) * aspect) ** 2 + (v - cy) ** 2
    return np.exp(-d2 / (2 * r * r))

def curve(base, waves):
    c = np.full_like(u[0], base)
    for amp, freq, phase in waves:
        c = c + amp * np.sin(2 * math.pi * freq * u[0] + phase)
    return c[None, :].repeat(H, 0)

def slope(c):
    d = np.gradient(c[0]) * W  # dv/du
    return np.sqrt(1 + (d / aspect) ** 2)[None, :].repeat(H, 0)

def grain(img, seed, amount=1.6 / 255):
    rng = np.random.default_rng(seed)
    return img + rng.normal(0, amount, img.shape[:2])[..., None].astype(np.float32)

def sky(top, bottom, warm=None):
    img = mix(hexc(top)[None, None, :], hexc(bottom)[None, None, :], smooth(0, 1, v))
    if warm:  # (colour, centre u, centre v, radius, strength): a soft warm light low on one side
        img = mix(img, hexc(warm[0])[None, None, :], glow(warm[1], warm[2], warm[3]) * warm[4])
    return img

def save(img, name):
    img = np.clip(grain(img, len(name)), 0, 1)
    Image.fromarray((img * 255 + .5).astype(np.uint8), 'RGB').save(os.path.join(out, f'wall-{name}.png'), optimize=True)
    lum = (0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]).mean()
    print(name, W, H, 'mean luminance', round(float(lum), 3))

def ridge_line(base, seed, amps=(.05, .022, .009, .0035), freqs=(.38, .93, 2.1, 4.6)):
    """A ridge as mountains have it: a long slow swell with smaller rises on it, random but smooth (no notches)."""
    rng = np.random.default_rng(seed)
    return curve(base, [(a, f * rng.uniform(.85, 1.15), rng.uniform(0, 2 * math.pi)) for a, f in zip(amps, freqs)])

def layer(img, c, body_top, body_bottom, depth=.30, rim=.0025, light=.18):
    """A range of hills in front of what is drawn: a crisp but soft edge, a colour that pales towards its foot (haze), and a
    faint light along the crest."""
    s = slope(c); d = (v - c) * s
    alpha = smooth(-rim, rim, d)
    shade = mix(hexc(body_top)[None, None, :], hexc(body_bottom)[None, None, :], smooth(0, depth, d))
    shade = mix(shade, np.ones(3, np.float32)[None, None, :], np.exp(-((d - rim) / .006) ** 2) * light)
    return mix(img, shade, alpha)

# D — dawn, as the app's 「새벽 풍경」 stage (pale sky whitening to the horizon, a warm light low on the right, a hazy far range and
# slate-blue near hills), redrawn at the picture's own proportions with natural ridges.
if 'D' in which:
    img = sky('#d9e5f4', '#f1f4f8', ('#fcefe0', .88, .56, .22, .75))
    img = layer(img, ridge_line(.50, 11, amps=(.03, .014, .006, .0025)), '#dbe3ef', '#e8edf5', depth=.25, light=.10)
    img = layer(img, ridge_line(.62, 23, amps=(.045, .02, .008, .003)), '#c6d1e4', '#dbe2ee', depth=.28)
    img = layer(img, ridge_line(.76, 37, amps=(.05, .022, .009, .0035)), '#afbdd5', '#cdd6e6', depth=.30)
    img = mix(img, np.ones(3, np.float32)[None, None, :], smooth(.80, 1.0, v) * .25)  # morning mist at the foot
    save(img, 'D')

# N — D at blue hour, for a dark picture (the widget gallery's dark stage): the same ridges (same seeds and heights), the sky a deep
# slate blue with a faint warm trace low on the right, the ranges darker towards the front, a little mist at the foot.
if 'N' in which:
    img = sky('#1d2636', '#3a4254', ('#5b5160', .88, .58, .22, .55))
    img = layer(img, ridge_line(.50, 11, amps=(.03, .014, .006, .0025)), '#3c4558', '#444d60', depth=.25, light=.05)
    img = layer(img, ridge_line(.62, 23, amps=(.045, .02, .008, .003)), '#323b4e', '#3d4659', depth=.28, light=.06)
    img = layer(img, ridge_line(.76, 37, amps=(.05, .022, .009, .0035)), '#283245', '#353f52', depth=.30, light=.07)
    img = mix(img, hexc('#4a5266')[None, None, :], smooth(.82, 1.0, v) * .30)
    save(img, 'N')
