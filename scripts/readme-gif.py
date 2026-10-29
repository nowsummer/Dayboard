# Turns the frames of scripts/readme-demo.cjs (f_<n>_<ms>.png) into the demo animation of the public pages (images/demo.webp,
# images/en/demo.webp), optionally followed by the desktop scene of scripts/readme-widget-scene.cjs (--then <folder>). Each frame
# lasts until the next one was painted (at least 40 ms); repeated frames are merged. The format follows the file name:
#   .webp — the pages' animation (2026-10-28 user: the GIF looked coarse and its red 「예정」 tile odd). Full colour: the app's
#           frames lossless, so text edges, the 「예정」 tile and the list icons keep the app's own pixels (lossy WebP stores colour
#           at half resolution and tinted the tile's white glyph pink); the desktop scene lossy at --quality (with its
#           wallpaper lossless too, the 40-second clip was 5.9 MB instead of 2.3 MB). --lossless: every frame lossless.
#   .gif  — kept as an option: one 256-colour palette for the whole clip, the interface undithered, the desktop scene dithered.
#   .png  — APNG, lossless (about twice the size of the lossless WebP).
# Needs Python 3 with Pillow (WebP support built in).
# usage: py -3 scripts/readme-gif.py <frames folder> <out.webp|.gif|.png> [width, default 1315] [--then <scene frames folder>]
#        [--quality 0-100, default 90] [--lossless] [--old-scene]
# The frames are recorded at twice the window's size (readme-demo.cjs) and scaled down here: 1315 px is the desktop scene's own
# width (recorded on a 125 % screen), and sharp on the README's 860 px picture up to a 150 % screen. Narrower frames (1x, 1120 px)
# keep their own width unless one is given: blown up to 1315 px their text came out softer (2026-10-28 review of r50 I).
# The desktop scene is joined only when its sample.json (written by readme-widget-scene.cjs) matches the app frames' one (readme-demo.cjs):
# the same sample colours, words and language. A scene recorded before a colour change showed the old pink trip icon for the last 14 s
# (2026-10-28 review of r50 I); one recorded before the words changed shows the old tasks (r50 M). --old-scene joins it anyway.
import colorsys
import glob
import json
import os
import sys

from PIL import Image, ImageChops

args = sys.argv[1:]


def option(name, default=None, flag=False):
    if name not in args:
        return default
    at = args.index(name)
    if flag:
        del args[at]
        return True
    value = args[at + 1]
    del args[at:at + 2]
    return value


then = option('--then')
quality = int(option('--quality', 90))
lossless = option('--lossless', False, flag=True)
old_scene = option('--old-scene', False, flag=True)
src, out = args[0], args[1]
kind = os.path.splitext(out)[1].lower()
if kind not in ('.webp', '.gif', '.png'):
    sys.exit(f'unknown format {kind}: use .webp, .gif or .png')


def frame_files(folder):
    files = sorted(glob.glob(os.path.join(folder, 'f_*.png')))
    if len(files) < 10:
        sys.exit(f'too few frames in {folder}')
    return files


def sample_mark(folder):
    try:
        with open(os.path.join(folder, 'sample.json'), encoding='utf-8') as file:
            return json.load(file)
    except (OSError, ValueError):
        return None


if then and not old_scene:
    app_mark, scene_mark = sample_mark(src), sample_mark(then)
    if scene_mark is None:
        sys.exit(f'{then} has no sample.json: recorded before the sample colours were marked (older sample data). Record it again with '
                 'scripts/readme-widget-scene.cjs, or pass --old-scene to join it anyway.')
    if app_mark is None:
        sys.exit(f'{src} has no sample.json, so the scene cannot be checked against it. Record the frames again with '
                 'scripts/readme-demo.cjs, or pass --old-scene.')
    if app_mark != scene_mark:
        sys.exit(f'{then} was recorded with other sample data than {src} (language {scene_mark.get("lang")} / {app_mark.get("lang")}'
                 f'{", other colours" if scene_mark.get("colours") != app_mark.get("colours") else ""}'
                 f'{", other words" if scene_mark.get("text") != app_mark.get("text") else ""}). Record the scene again, or pass --old-scene.')


def first_width(folder):
    with Image.open(frame_files(folder)[0]) as first:
        return first.width


# Scaled down, never up, unless a width is given (then a note says so).
narrowest = min(first_width(folder) for folder in [src] + ([then] if then else []))
target = int(args[2]) if len(args) > 2 else min(1315, narrowest)
if target > narrowest:
    print(f'note: {narrowest}-px frames scaled up to {target} px (softer text)')


def load(folder, size=None):
    files = frame_files(folder)
    stamps = [int(os.path.basename(f).split('_')[2].split('.')[0]) for f in files]
    # Each frame is scaled as it is read: 233 2x frames held at full size were about 3 GB (2026-10-28 review of r50 I).
    frames = []
    for f in files:
        with Image.open(f) as image:
            frame = image.convert('RGB')
        size = size or (target, round(frame.height * target / frame.width))
        frames.append(frame if frame.size == size else frame.resize(size, Image.Resampling.LANCZOS))
    # A frame lasts until the next; browsers show delays under 20 ms as 100 ms, so none is shorter than 40 ms.
    durations = [max(40, stamps[i + 1] - stamps[i]) for i in range(len(stamps) - 1)] + [2200]
    return frames, durations


size = None
if then:
    # The scene sets the proportions, so at its own width its frames keep their own pixels (the app's window is 1 px off).
    with Image.open(frame_files(then)[0]) as first:
        size = (target, round(first.height * target / first.width))
frames, durations = load(src, size)
width, height = frames[0].size
parts = [frames]
desktop = [False] * len(frames)  # the desktop scene: a photo-like wallpaper (dithered in a GIF, lossy in a WebP)
if then:
    durations[-1] = 900  # the notes, then the desktop
    scene, scene_durations = load(then, (width, height))
    parts.append(scene)
    frames = frames + scene  # a new list: parts[0] stays the app's frames
    durations += scene_durations
    desktop += [True] * len(scene)


def merged(images, times, flags):
    # A frame equal to the one before only lengthens it.
    kept, kept_times, kept_flags = [], [], []
    for image, ms, flag in zip(images, times, flags):
        if kept and ImageChops.difference(kept[-1].convert('RGB'), image.convert('RGB')).getbbox() is None:
            kept_times[-1] += ms
            continue
        kept.append(image)
        kept_times.append(ms)
        kept_flags.append(flag)
    return kept, kept_times, kept_flags


def save_webp(images, times, lossy):
    # Pillow's save() takes one setting for every frame, so with lossy frames its WebP encoder is driven frame by frame, as save()
    # does: no key frames after the first (kmin=kmax=0; a key frame every few frames tripled the size), not mixed (each frame as
    # asked), loop forever. With a Pillow whose encoder differs, every frame is lossless (exact, larger).
    if any(lossy):
        try:
            from PIL import _webp
            encoder = _webp.WebPAnimEncoder(images[0].size, 0, 0, False, 0, 0, False, False)
            at = 0
            for image, ms, photo in zip(images, times, lossy):
                encoder.add(image.getim(), at, not photo, quality if photo else 80, 100, 6 if photo else 4)
                at += ms
            encoder.add(None, at, False, quality, 100, 0)
            with open(out, 'wb') as file:
                file.write(encoder.assemble(b'', b'', b''))
            return
        except (ImportError, AttributeError, TypeError) as error:
            print(f'per-frame WebP not available ({error}); every frame lossless')
    # Lossless method 4: method 6 took 17 times as long for 5 % less.
    images[0].save(out, save_all=True, append_images=images[1:], duration=times, loop=0, lossless=True, quality=80, method=4, kmin=0, kmax=0)


if kind == '.webp':
    kept, times, flags = merged(frames, durations, desktop)
    save_webp(kept, times, [False] * len(kept) if lossless else flags)
elif kind == '.png':
    kept, times, _ = merged(frames, durations, desktop)
    kept[0].save(out, save_all=True, append_images=kept[1:], duration=times, loop=0, optimize=False, compress_level=9)
else:
    # Each part is sampled on its own: sampled across the whole clip, the desktop scene's many wallpaper colours took the
    # palette's accent entries and the 「예정」 tile came out dark red (2026-10-28 user).
    sample = [frame for part in parts for frame in part[:: max(1, len(part) // 16)]]
    montage = Image.new('RGB', (width, height * len(sample)))
    for i, frame in enumerate(sample):
        montage.paste(frame, (0, height * i))
    # Small accent areas (the red 「예정」 tile, list icons) were merged into a neighbour by the median cut — the red tile came out
    # orange (2026-10-27 user). The clip's saturated colours that cover a few hundred pixels or more get entries of their own first,
    # the app's before the desktop scene's (the wallpaper has many). Shades a step apart count together: scaling spreads a flat
    # tile over several, and the tile's own shade alone fell under 300.
    accents = []
    for part in parts:
        counts, shades = {}, {}
        for frame in part[:: max(1, len(part) // 16)]:
            for count, rgb in frame.getcolors(maxcolors=width * height) or []:
                r, g, b = rgb
                h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                if s >= 0.45 and v >= 0.35:
                    key = (r >> 3, g >> 3, b >> 3)
                    counts[key] = counts.get(key, 0) + count
                    bucket = shades.setdefault(key, {})
                    bucket[rgb] = bucket.get(rgb, 0) + count
        for key, count in sorted(counts.items(), key=lambda item: -item[1]):
            rgb = max(shades[key].items(), key=lambda item: item[1])[0]
            if count < 300 or len(accents) >= 48:
                break
            if all(sum((a - b) ** 2 for a, b in zip(rgb, other)) > 18 ** 2 for other in accents):
                accents.append(rgb)
    base = montage.quantize(colors=255 - len(accents), method=Image.Quantize.MEDIANCUT).getpalette()[: (255 - len(accents)) * 3]
    palette = Image.new('P', (1, 1))
    palette.putpalette(base + [channel for rgb in accents for channel in rgb] + [0, 0, 0] * (256 - (255 - len(accents)) - len(accents)))
    quantized = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG if photo else Image.Dither.NONE) for frame, photo in zip(frames, desktop)]
    kept, times, _ = merged(quantized, durations, desktop)
    # GIF delays are in hundredths of a second.
    times = [max(40, round(ms / 10) * 10) for ms in times]
    kept[0].save(out, save_all=True, append_images=kept[1:], duration=times, loop=0, optimize=True, disposal=1)
print(f'{out}: {len(kept)} frames, {sum(times) / 1000:.1f} s, {os.path.getsize(out) / 1e6:.2f} MB, {width}x{height}')
