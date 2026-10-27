# Turns the frames of scripts/readme-demo.cjs (f_<n>_<ms>.png) into the demo GIF of the public pages (images/demo.gif,
# images/en/demo.gif). Each frame lasts until the next one was painted; one palette for the whole clip (no flicker between
# frames), no dithering (flat interface colours stay clean); repeated frames are merged. Needs Python 3 with Pillow.
# usage: py -3 scripts/readme-gif.py <frames folder> <out.gif> [width, default 960]
import glob
import os
import sys

from PIL import Image, ImageChops

src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, 'f_*.png')))
if len(files) < 10:
    sys.exit(f'too few frames in {src}')
stamps = [int(os.path.basename(f).split('_')[2].split('.')[0]) for f in files]
target = int(sys.argv[3]) if len(sys.argv) > 3 else 960
frames = [Image.open(f).convert('RGB') for f in files]
if frames[0].width != target:
    size = (target, round(frames[0].height * target / frames[0].width))
    frames = [frame.resize(size, Image.Resampling.LANCZOS) for frame in frames]
# A frame lasts until the next; browsers show delays under 20 ms as 100 ms, so none is shorter than 40 ms.
durations = [max(40, stamps[i + 1] - stamps[i]) for i in range(len(stamps) - 1)] + [2200]

width, height = frames[0].size
sample = frames[:: max(1, len(frames) // 16)]
montage = Image.new('RGB', (width, height * len(sample)))
for i, frame in enumerate(sample):
    montage.paste(frame, (0, height * i))
# Small accent areas (the red 「예정」 tile, list icons) were merged into a neighbour by the median cut — the red tile came out orange
# (2026-10-27 user). The clip's saturated colours that cover a few hundred pixels or more get entries of their own first.
import colorsys
counts = {}
for frame in sample:
    for count, rgb in frame.getcolors(maxcolors=width * height) or []:
        r, g, b = rgb
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= 0.45 and v >= 0.35:
            counts[rgb] = counts.get(rgb, 0) + count
accents = []
for rgb, count in sorted(counts.items(), key=lambda item: -item[1]):
    if count < 300 or len(accents) >= 48:
        break
    if all(sum((a - b) ** 2 for a, b in zip(rgb, other)) > 18 ** 2 for other in accents):
        accents.append(rgb)
base = montage.quantize(colors=255 - len(accents), method=Image.Quantize.MEDIANCUT).getpalette()[: (255 - len(accents)) * 3]
palette = Image.new('P', (1, 1))
palette.putpalette(base + [channel for rgb in accents for channel in rgb] + [0, 0, 0] * (256 - (255 - len(accents)) - len(accents)))

kept, times = [], []
for frame, ms in zip(frames, durations):
    q = frame.quantize(palette=palette, dither=Image.Dither.NONE)
    if kept and ImageChops.difference(kept[-1].convert('RGB'), q.convert('RGB')).getbbox() is None:
        times[-1] += ms
        continue
    kept.append(q)
    times.append(ms)
# GIF delays are in hundredths of a second.
times = [max(40, round(ms / 10) * 10) for ms in times]
kept[0].save(out, save_all=True, append_images=kept[1:], duration=times, loop=0, optimize=True, disposal=1)
print(f'{out}: {len(kept)} frames, {sum(times) / 1000:.1f} s, {os.path.getsize(out) / 1e6:.2f} MB, {width}x{height}')
