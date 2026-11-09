# The desktop pictures, put together from their layers (scripts/readme-widget-scene.cjs, readme-widgets.cjs): the wallpaper as Dayboard
# reads it and each widget's frames as they are (its window paints the wallpaper around its card itself), with the film's caption on
# the desktop under them. Nothing is taken from the screen (2026-10-29: the 1.2.1 English scene, recorded from the screen, went
# public over the user's own Chrome window).
# A frame is made whenever a layer changed, at most one per 45 ms; the newest picture of each layer is used.
# usage: py -3 scripts/readme-scene-compose.py <layers folder> <out folder>   → <out>/f_<n>_<ms>.png
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

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

# ---- The film's scene: every widget's newest picture over the wallpaper, and the caption ----
kinds = meta['kinds']
newest = {}  # per widget: (file, picture); only the newest of each is needed again


def picture_of(layer):
    kept = newest.get(layer['kind'])
    if not kept or kept[0] != layer['file']:
        with Image.open(os.path.join(layers_dir, layer['file'])) as image:
            kept = (layer['file'], image.convert('RGB'))
        newest[layer['kind']] = kept
    return kept[1]


# The caption in the place and size the app scenes draw theirs (readme-demo.cjs PAGE: 20 px type semibold, 11 x 24 px padding, 14 px
# corners, 26 px off the foot), for this picture's scale and width — a light pill here, where the app's dark one sank into the dark
# wallpaper. Drawn three times the size and scaled down for clean edges.
def caption_pill(caption):
    k = W / caption['widthDip']  # physical pixels per point of the picture
    grow = 3
    font = ImageFont.truetype(caption['font'], round(20 * k * grow))
    font.set_variation_by_axes([600])
    text = caption['text']
    text_w = font.getlength(text)
    pad_x, pad_y, line = 24 * k * grow, 11 * k * grow, 28 * k * grow
    w, h = round(text_w + 2 * pad_x), round(line + 2 * pad_y)
    pill = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(pill)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=round(14 * k * grow), fill=(255, 255, 255, 235))
    draw.text((w / 2, h / 2), text, font=font, fill=(29, 29, 31, 255), anchor='mm')
    pill = pill.resize((round(w / grow), round(h / grow)), Image.Resampling.LANCZOS)
    return pill, ((W - pill.width) // 2, H - pill.height - round(26 * k))


caption = meta.get('caption')
pill, pill_at = caption_pill(caption) if caption else (None, None)
FADE = 320  # ms, as the app scenes' caption

moments = []  # (t, {kind: layer})
current = {}
for layer in layers:
    current = {**current, layer['kind']: layer}
    if any(kind not in current for kind in kinds):
        continue
    if moments and layer['t'] - moments[-1][0] < 45:
        moments[-1] = (moments[-1][0], current)  # within 45 ms: the newer pictures replace the frame's
    else:
        moments.append((layer['t'], current))
if not moments:
    sys.exit('not every widget painted a frame')
# The fade has frames of its own, while the widgets stand still.
if caption and caption.get('at'):
    times = [caption['at'] + step for step in range(0, FADE + 46, 45)]
    for t in times:
        before = [m for m in moments if m[0] <= t]
        if before and all(abs(m[0] - t) >= 23 for m in moments):
            moments.append((t, before[-1][1]))
    moments.sort(key=lambda m: m[0])


for index, (t, state) in enumerate(moments, 1):
    frame = background.copy()
    for kind in kinds:
        layer = state[kind]
        frame.paste(picture_of(layer), (layer['x'], layer['y']))
    if pill:
        alpha = 1.0 if not caption.get('at') else min(1.0, max(0.0, (t - caption['at']) / FADE))
        if alpha > 0:
            shown = pill.copy()
            shown.putalpha(shown.getchannel('A').point(lambda v: round(v * alpha)))
            frame.paste(shown, pill_at, shown)
    frame.save(os.path.join(out, f'f_{index:05d}_{t}.png'), optimize=False, compress_level=3)
print(f'[compose] {len(moments)} frames, {W}x{H}, {(moments[-1][0] - moments[0][0]) / 1000:.1f} s in {out}')
