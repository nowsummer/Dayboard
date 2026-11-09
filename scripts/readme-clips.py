# The film of the public pages from its recorded scenes: images/demo.webp (the whole film) and images/clips/<name>.webp (each feature's
# scene alone, the same frames), in the layout of the public repository; English under images/en/. Runs scripts/readme-gif.py for each.
# The scenes are from scripts/readme-demo.cjs (<frames>/board, tasks, entry, quick, drag, notes, end) and scripts/readme-widget-scene.cjs.
# usage: py -3 scripts/readme-clips.py <frames folder> <desktop scene folder> <images folder> [--en] [--width 1315] [--clip-width 1100]
# Every frame lossless, the desktop scene's too: lossy, the dark glass over the wallpaper showed blocks (even at quality 96), and the
# scene is short enough that lossless costs little (the clip 3.3 MB).
import os
import subprocess
import sys

args = sys.argv[1:]


def option(name, default):
    if name not in args:
        return default
    at = args.index(name)
    value = args[at + 1]
    del args[at:at + 2]
    return value


width = option('--width', '1315')
clip_width = option('--clip-width', '1100')
english = '--en' in args
if english:
    args.remove('--en')
frames, desktop, images = args
base = os.path.join(images, 'en') if english else images
os.makedirs(os.path.join(base, 'clips'), exist_ok=True)
GIF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'readme-gif.py')


def run(*parts):
    subprocess.run([sys.executable, '-I', GIF, *parts], check=True)


scene = lambda name: os.path.join(frames, name)
# The film: each scene already ends on its own hold, so it runs straight into the next; the logo closes it.
run(scene('board'), os.path.join(base, 'demo.webp'), width, '--join', scene('tasks'), '--join', scene('entry'), '--join', scene('quick'),
    '--join', scene('drag'), '--join', scene('notes'), '--then', desktop, '--join', scene('end'), '--gap', '60', '--last', '400', '--thin', '80', '--lossless')  # every 80 ms at most: under 15 MB
for name in ('tasks', 'entry', 'quick', 'drag', 'notes'):
    # The settings sheets repaint their blurred page on every frame: every 70 ms at most keeps that clip under 6 MB.
    run(scene(name), os.path.join(base, 'clips', f'{name}.webp'), clip_width, *(('--thin', '70') if name == 'quick' else ()))
run(desktop, os.path.join(base, 'clips', 'widget.webp'), clip_width, '--lossless')
