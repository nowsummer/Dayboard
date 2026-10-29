# The desktop scene's frames, put together from its layers (scripts/readme-widget-scene.cjs): the wallpaper as Dayboard reads it,
# the app window's frames with the rounded corners and soft shadow Windows 11 gives a window, and the widget's frames as they are
# (its window paints the wallpaper around its card itself). Nothing is taken from the screen (2026-10-29: the 1.2.1 English scene,
# recorded from the screen, went public over the user's own Chrome window).
# A frame is made whenever a layer changed, at most one per 45 ms; the newest picture of each layer is used.
# usage: py -3 scripts/readme-scene-compose.py <layers folder> <out folder>   → <out>/f_<n>_<ms>.png
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

layers_dir, out = sys.argv[1], sys.argv[2]
with open(os.path.join(layers_dir, 'meta.json'), encoding='utf-8') as file:
    meta = json.load(file)
scale = float(meta['scale'])
scene = meta['scene']
W, H = int(scene['width']), int(scene['height'])
os.makedirs(out, exist_ok=True)

# ---- The wallpaper (color behind a picture that does not fill the monitor, a tiled one repeated from its origin) ----
background = Image.new('RGB', (W, H), meta.get('color') or '#000000')
paper = meta.get('wallpaper')
if paper:
    with Image.open(os.path.join(layers_dir, paper['file'])) as source:
        picture = source.convert('RGB')
    left, top = paper['left'] - scene['x'], paper['top'] - scene['y']
    if paper.get('repeat'):
        pw, ph = picture.size
        for y in range(top % ph - ph, H, ph):
            for x in range(left % pw - pw, W, pw):
                background.paste(picture, (x, y))
    else:
        background.paste(picture, (left, top))

# ---- The app window's outline: Windows 11 rounds a window's corners (8 px) and casts a soft shadow under it ----
RADIUS = round(8 * scale)
masks = {}


def outline(size):
    if size not in masks:
        mask = Image.new('L', size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=RADIUS, fill=255)
        blur = round(18 * scale)
        shadow = Image.new('L', (size[0] + blur * 4, size[1] + blur * 4), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((blur * 2, blur * 2, blur * 2 + size[0] - 1, blur * 2 + size[1] - 1), radius=RADIUS, fill=90)
        masks[size] = (mask, shadow.filter(ImageFilter.GaussianBlur(blur)), blur * 2)
    return masks[size]


cache = {}


def picture_of(layer):
    name = layer['file']
    if name not in cache:
        cache.clear()  # only the newest picture of each layer is needed again
        with Image.open(os.path.join(layers_dir, name)) as image:
            cache[name] = image.convert('RGB')
    return cache[name]


layers = sorted(meta['layers'], key=lambda item: item['t'])
missing = [item['file'] for item in layers if not os.path.exists(os.path.join(layers_dir, item['file']))]
if missing:
    sys.exit(f'{len(missing)} layer pictures were not written, e.g. {missing[0]}')

# ---- A photo (scripts/readme-widgets.cjs): every layer once, as it is ----
if meta.get('photo'):
    photo = background.copy()
    for layer in layers:
        with Image.open(os.path.join(layers_dir, layer['file'])) as image:
            photo.paste(image.convert('RGB'), (layer['x'], layer['y']))
    photo.save(os.path.join(out, meta['photo']), optimize=True)
    print(f'[compose] {meta["photo"]} {W}x{H}')
    sys.exit(0)

if not any(item['kind'] == 'app' for item in layers):
    sys.exit('no frames of the app window were recorded')

# ---- The timeline ----
moments = []  # (t, {kind: layer})
current = {}
for layer in layers:
    current = {**current, layer['kind']: layer}
    if 'app' not in current:
        continue
    if moments and layer['t'] - moments[-1][0] < 45:
        moments[-1] = (moments[-1][0], current)  # within 45 ms: the newer pictures replace the frame's
    else:
        moments.append((layer['t'], current))

for index, (t, state) in enumerate(moments, 1):
    frame = background.copy()
    app = state['app']
    picture = picture_of(app)
    mask, shadow, pad = outline(picture.size)
    black = Image.new('RGB', shadow.size, (0, 0, 0))
    frame.paste(black, (app['x'] - pad, app['y'] - pad + round(6 * scale)), shadow)
    frame.paste(picture, (app['x'], app['y']), mask)
    widget = state.get('widget')
    if widget:
        frame.paste(picture_of(widget), (widget['x'], widget['y']))
    frame.save(os.path.join(out, f'f_{index:05d}_{t}.png'), optimize=False, compress_level=3)
print(f'[compose] {len(moments)} frames, {W}x{H}, {(moments[-1][0] - moments[0][0]) / 1000:.1f} s in {out}')
