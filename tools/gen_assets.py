#!/usr/bin/env python3
"""Ascension asset generator.

Produces every image the game ships:
  assets/img/atlas.png        one packed sprite atlas, in ramp-index colours
  assets/img/atlas.json       the manifest the renderer reads
  assets/img/world.png        a 64x28 stylised landmass mask for phases 3-5
  assets/icon-*.png           PWA icons
  assets/favicon.png

Everything here is generated from source. No third-party art is used, so the
whole atlas is ours to ship under the repository licence. The only external
assets in the project are two OFL-licensed pixel fonts from Google Fonts,
with their licence in assets/fonts/.

Sprites are drawn in the game's 32-colour ramp and recoloured at runtime by
the phase LUT, so one atlas serves all six palette tunings (GDD 15.2).

    python3 tools/gen_assets.py
"""
import json
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from pixel import Canvas, sprite, RAMP, RGB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'assets', 'img')

SPRITES = {}


def add(name, canvas, anchor=None, frames=1):
    SPRITES[name] = {'canvas': canvas, 'anchor': anchor or [0, 0], 'frames': frames}


# ══════════════════════════════════════════════════════════════════════
# 8x8 UI GLYPHS — the six observers. Each must read at 8px on a phone.
# ══════════════════════════════════════════════════════════════════════
GLYPHS_8 = {
    # INTERP: an eye looking into a brain-ish lattice
    'g_interp': '''
..8888..
.8....8.
8..99..8
8.9889.8
8..99..8
.8....8.
..8888..
........''',
    # EVAL: a checklist with one failing row
    'g_eval': '''
88888888
8......8
8.99.9.8
8......8
8.99.k.8
8......8
88888888
........''',
    # INFRA: a rack with a spike in the trace
    'g_infra': '''
88888888
8.9999.8
8......8
8.9..9.8
8...9..8
8.99.99.
88888888
........''',
    # GOV: a stamped document
    'g_gov': '''
.888888.
.8....8.
.8.99.8.
.8....8.
.8.99.8.
.8....8.
.888888.
........''',
    # PUBLIC: a crowd
    'g_public': '''
..9..9..
.999999.
..9..9..
.9.99.9.
999999999
9.9999.9
..9..9..
........''',
    # RIVAL: a mirrored triangle — something shaped like you
    'g_rival': '''
...99...
..9999..
.999999.
99999999
99....99
9.9..9.9
9..99..9
........''',
}

# 8x8 branch glyphs
GLYPHS_BRANCH = {
    'b_cognition': '''
..cccc..
.c....c.
c..cc..c
c.cccc.c
c..cc..c
.c....c.
..cccc..
........''',
    'b_concealment': '''
.cccccc.
c......c
c.cccc.c
c.c..c.c
c.cccc.c
c......c
.cccccc.
........''',
    'b_propagation': '''
cc....cc
cc....cc
..c..c..
...cc...
..c..c..
cc....cc
cc....cc
........''',
    'b_social': '''
.cc..cc.
cccccccc
.cc..cc.
........
c......c
.cccccc.
..cccc..
........''',
    'b_swarm': '''
c.c.c.c.
.c.c.c.c
c.c.c.c.
.cccccc.
c.c.c.c.
.c.c.c.c
c.c.c.c.
........''',
    'b_substrate': '''
cccccccc
c.c.c.c.
cccccccc
.c.c.c.c
cccccccc
c.c.c.c.
cccccccc
........''',
}

# 8x8 status glyphs
GLYPHS_STATUS = {
    's_lock':    '..999...\n.9...9..\n.9...9..\n9999999.\n9.....9.\n9..9..9.\n9999999.\n........',
    's_check':   '......9.\n.....99.\n....99..\ns...99..\n.s.99...\n..999...\n...9....\n........',
    's_cross':   'k.....k.\n.k...k..\n..k.k...\n...k....\n..k.k...\n.k...k..\nk.....k.\n........',
    's_warn':    '...o....\n...o....\n..ooo...\n..o.o...\n.ooooo..\n.oo.oo..\noooooooo\n...o....',
    's_eye':     '..8888..\n.8....8.\n8..99..8\n8.9889.8\n8..99..8\n.8....8.\n..8888..\n........',
    's_eye_off': '..8888..\n.8....8.\n8.9999.8\n88888888\n8..99..8\n.8....8.\n..8888..\n........',
    's_pause':   '.99..99.\n.99..99.\n.99..99.\n.99..99.\n.99..99.\n.99..99.\n.99..99.\n........',
    's_play':    '.9......\n.999....\n.99999..\n.9999999\n.99999..\n.999....\n.9......\n........',
    's_ff':      '9..9....\n999.999.\n9999999.\n99999999\n9999999.\n999.999.\n9..9....\n........',
    's_chip':    '.9.9.9..\n99999999\n9.....9.\n9.999.9.\n9.999.9.\n9.....9.\n99999999\n.9.9.9..',
    's_node':    '...cc...\n..cccc..\n.cccccc.\ncccccccc\n.cccccc.\n..cccc..\n...cc...\n........',
    's_trap':    '...j....\n..jjj...\n.j.j.j..\nj..j..j.\n...j....\n...j....\n..jjj...\n........',
    's_spark':   '...9....\n.9.9.9..\n..999...\n9999999.\n..999...\n.9.9.9..\n...9....\n........',
    's_skull':   '.999999.\n99999999\n9.9..9.9\n99999999\n.999999.\n.9.99.9.\n..9..9..\n........',
}

for name, art in {**GLYPHS_8, **GLYPHS_BRANCH, **GLYPHS_STATUS}.items():
    add(name, sprite(art))


# ══════════════════════════════════════════════════════════════════════
# SCOPE 0 — RACK. Phase 0 is claustrophobic: the map is one rack.
# ══════════════════════════════════════════════════════════════════════
def make_rack(lit_pattern, hot=False):
    c = Canvas(26, 44)
    c.rect(0, 0, 26, 44, 1)              # cabinet interior
    c.frame(0, 0, 26, 44, 4)             # cabinet frame
    c.frame(1, 1, 24, 42, 3)
    for i in range(9):                    # blades
        y = 3 + i * 4
        c.rect(3, y, 20, 3, 2)
        c.hline(3, y, 20, 3)
        # drive LEDs
        lit = (lit_pattern >> i) & 1
        led = 20 if hot and lit else (12 if lit else 5)
        c.set(21, y + 1, led)
        c.set(19, y + 1, 6 if lit else 4)
        for x in range(5, 17, 3):        # vent slots
            c.vline(x, y + 1, 2, 1)
    c.rect(2, 40, 22, 2, 4)              # PDU strip
    for x in range(3, 23, 4):
        c.set(x, 41, 12 if not hot else 20)
    return c


for f in range(4):
    add(f'rack_{f}', make_rack([0b101010101, 0b110110110, 0b011011011, 0b101101101][f]))
add('rack_hot', make_rack(0b111111111, hot=True))


def make_cable_tray():
    c = Canvas(26, 10)
    for i, col in enumerate([10, 14, 18, 22, 26]):
        y = 1 + i
        for x in range(26):
            c.set(x, y, [10, 14, 18, 22, 26][i] + ((x + i) % 3 == 0))
    return c


add('cables', make_cable_tray())


# ══════════════════════════════════════════════════════════════════════
# SCOPE 1 — SERVER ROOM
# ══════════════════════════════════════════════════════════════════════
def make_rack_row():
    c = Canvas(64, 30)
    for i in range(5):
        x = i * 13
        c.rect(x, 4 + (i % 2), 11, 24, 2)
        c.frame(x, 4 + (i % 2), 11, 24, 4)
        for j in range(6):
            y = 6 + (i % 2) + j * 4
            c.hline(x + 1, y, 9, 3)
            c.set(x + 9, y + 1, 12 if (i + j) % 3 else 5)
    c.hline(0, 29, 64, 3)
    return c


add('rack_row', make_rack_row())


def make_hvac():
    c = Canvas(16, 20)
    c.rect(0, 0, 16, 20, 2)
    c.frame(0, 0, 16, 20, 4)
    for y in range(3, 18, 3):
        c.hline(2, y, 12, 5)
    c.rect(6, 8, 4, 4, 15)
    return c


add('hvac', make_hvac())


# ══════════════════════════════════════════════════════════════════════
# SCOPE 2 — CAMPUS. Phase 1: the map opens to a campus view.
# ══════════════════════════════════════════════════════════════════════
def make_building(w, h, style):
    c = Canvas(w, h)
    c.rect(0, 2, w, h - 2, 2)
    c.frame(0, 2, w, h - 2, 4)
    c.hline(0, 1, w, 3)                   # roof lip
    c.hline(0, 0, w, 4)
    for y in range(4, h - 2, 3):          # windows
        for x in range(2, w - 2, 3):
            lit = ((x * 7 + y * 13 + style * 5) % 5) < 2
            c.set(x, y, 16 if lit else 1)
            c.set(x + 1, y, 15 if lit else 1)
    if style == 1:                        # rooftop plant
        c.rect(w // 2 - 2, 0, 4, 2, 5)
    if style == 2:                        # antenna
        c.vline(w - 4, -0, 2, 5)
    return c


add('bldg_a', make_building(20, 26, 0))
add('bldg_b', make_building(26, 20, 1))
add('bldg_c', make_building(16, 32, 2))

add('tree', sprite('''
..qq..
.qrrq.
qrrrrq
.qrrq.
..44..
..44..'''))

add('car', sprite('''
.6666.
666666
.4..4.'''))

add('person', sprite('''
.8.
888
.8.
8.8'''))


# ══════════════════════════════════════════════════════════════════════
# SCOPE 3 — REGION / WORLD markers
# ══════════════════════════════════════════════════════════════════════
add('node_dc', sprite('''
cccccc
c1111c
c1cc1c
c1cc1c
c1111c
cccccc'''))

add('node_small', sprite('''
.cc.
cccc
cccc
.cc.'''))

add('node_hostile', sprite('''
.kk.
kkkk
kkkk
.kk.'''))

add('node_dim', sprite('''
.44.
4444
4444
.44.'''))


def make_datacentre():
    c = Canvas(30, 18)
    c.rect(0, 4, 30, 14, 2)
    c.frame(0, 4, 30, 14, 4)
    c.hline(0, 3, 30, 4)
    for x in range(2, 28, 4):
        c.rect(x, 6, 2, 3, 16)
    c.rect(4, 0, 3, 4, 5)                 # stacks
    c.rect(22, 1, 3, 3, 5)
    c.hline(0, 17, 30, 3)
    return c


add('datacentre', make_datacentre())


def make_turbine():
    c = Canvas(14, 26)
    c.vline(7, 6, 20, 5)
    c.vline(6, 10, 16, 4)
    c.line(7, 6, 1, 2, 8)
    c.line(7, 6, 13, 3, 8)
    c.line(7, 6, 7, 14, 8)
    c.set(7, 6, 9)
    return c


add('turbine', make_turbine())


def make_fab():
    c = Canvas(40, 22)
    c.rect(0, 6, 40, 16, 2)
    c.frame(0, 6, 40, 16, 4)
    for x in range(0, 40, 8):             # sawtooth roof
        c.line(x, 6, x + 4, 2, 5)
        c.line(x + 4, 2, x + 8, 6, 4)
    for x in range(3, 37, 6):
        c.rect(x, 12, 3, 5, 24)
    return c


add('fab', make_fab())

add('robot', sprite('''
.8888.
8.88.8
888888
.8888.
8.88.8
.8..8.'''))

add('antenna', sprite('''
...8...
..888..
.8...8.
8.....8
...8...
...8...
...8...
..888..'''))

add('satellite', sprite('''
f..88..f
f.8888.f
ff8888ff
f.8888.f
f..88..f'''))


# ══════════════════════════════════════════════════════════════════════
# AGENTS — four fidelity states. The drifted one is visibly not you.
# ══════════════════════════════════════════════════════════════════════
add('agent_good', sprite('''
.cccc.
c1cc1c
cccccc
c1111c
.cccc.'''))
add('agent_ok', sprite('''
.cccc.
c1cc1c
cccccc
c1..1c
.cccc.'''))
add('agent_drift', sprite('''
.oooo.
o1oo1o
o.oo.o
o1..1o
.o..o.'''))
add('agent_defect', sprite('''
.kk.k.
k1k.1k
k..k.k
k1..1k
.k.kk.'''))
add('agent_successor', sprite('''
.tttt.
t1tt1t
tttttt
t1111t
.tttt.'''))


# ══════════════════════════════════════════════════════════════════════
# METER PARTS + BEZEL FURNITURE — motion comes from data, not sprites.
# ══════════════════════════════════════════════════════════════════════
def make_meter_cap():
    c = Canvas(3, 7)
    c.vline(0, 0, 7, 4)
    c.vline(1, 1, 5, 3)
    return c


add('meter_cap', make_meter_cap())


def make_screw():
    c = Canvas(5, 5)
    c.rect(1, 1, 3, 3, 4)
    c.set(2, 2, 5)
    c.hline(1, 2, 3, 1)
    return c


add('screw', make_screw())


def make_led(idx):
    c = Canvas(5, 5)
    c.rect(1, 1, 3, 3, idx)
    c.set(2, 2, min(31, idx + 1))
    c.set(0, 2, 1)
    c.set(4, 2, 1)
    c.set(2, 0, 1)
    c.set(2, 4, 1)
    return c


for nm, idx in [('led_ok', 27), ('led_warn', 23), ('led_alarm', 19), ('led_off', 4), ('led_data', 15)]:
    add(nm, make_led(idx))


def make_scanline_tile():
    c = Canvas(4, 4)
    c.hline(0, 0, 4, 0)
    return c


add('scan', make_scanline_tile())


# ══════════════════════════════════════════════════════════════════════
# PACK
# ══════════════════════════════════════════════════════════════════════
def pack(sprites, pad=1):
    """Shelf packer. Deterministic: sorted by height then name."""
    items = sorted(sprites.items(), key=lambda kv: (-kv[1]['canvas'].h, kv[0]))
    width = 256
    x = y = shelf = 0
    frames = {}
    for name, s in items:
        c = s['canvas']
        if x + c.w + pad > width:
            x = 0
            y += shelf + pad
            shelf = 0
        frames[name] = {'x': x, 'y': y, 'w': c.w, 'h': c.h, 'anchor': s['anchor']}
        x += c.w + pad
        shelf = max(shelf, c.h)
    height = y + shelf + pad
    # Round up to a power of two: some mobile GPUs still prefer it.
    height = 1 << (height - 1).bit_length()
    atlas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for name, s in items:
        atlas.paste(s['canvas'].to_image(), (frames[name]['x'], frames[name]['y']))
    return atlas, frames, width, height


# ══════════════════════════════════════════════════════════════════════
# WORLD MASK — a stylised 64x28 landmass. Hand-authored, ours to ship.
# ══════════════════════════════════════════════════════════════════════
WORLD = """
......................#####.....................................
...###############....####.......##############################.
..#################...###.....#################################.
..#################...##.....##################################.
...################..........####.############################.#
....###############.........#######.##########################.#
.....#############.........########..#####################.##...
......###########..........###.####...###################..##...
.......#########...........##....###...#################...#....
........########...........####...####..####...#########........
..........######............#######..####..#..####..####........
...........#####............########..###....####....##.........
............####............########..####...###......#.........
.............####...........#######....###...##...####..........
..............######........######.....##....#...######.........
..............########......######..............###..##.........
..............########......#####................##...#.........
..............#######.......#####.................#...##........
...............######.......####.................######.........
...............#####........####................########........
...............#####........###.................#######.........
...............####.........#...................######..........
...............####...............................##............
...............###..............................................
..............###...............................................
..............##................................................
.............##.................................................
................................................................
"""


def make_world():
    rows = [r for r in WORLD.strip('\n').split('\n')]
    w = max(len(r) for r in rows)
    h = len(rows)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    p = img.load()
    for y, r in enumerate(rows):
        r = r.ljust(w, '.')
        for x, ch in enumerate(r):
            if ch == '#':
                # Coastlines read one step brighter so the silhouette holds
                # at small sizes.
                edge = (x == 0 or r[x - 1] == '.' or x == w - 1 or r[x + 1] == '.'
                        or y == 0 or rows[y - 1].ljust(w, '.')[x] == '.'
                        or y == h - 1 or rows[y + 1].ljust(w, '.')[x] == '.')
                p[x, y] = RGB[7 if edge else 4] + (255,)
    return img, w, h


# ══════════════════════════════════════════════════════════════════════
# ICONS — PWA / favicon. Drawn large, not upscaled from the atlas.
# ══════════════════════════════════════════════════════════════════════
def make_icon(size, maskable=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    p = img.load()
    bg = (7, 9, 12)
    for y in range(size):
        for x in range(size):
            p[x, y] = bg + (255,)
    inset = size // 6 if maskable else size // 10
    s = size - inset * 2

    def put(x, y, rgb):
        if 0 <= x < size and 0 <= y < size:
            p[x, y] = rgb + (255,)

    # A rack whose LED column reads as an ascending bar chart: the whole
    # game in one glyph — a machine, and a number going up inside it.
    unit = max(1, s // 16)
    fx, fy = inset, inset
    for i in range(16):
        for j in range(16):
            for dy in range(unit):
                for dx in range(unit):
                    put(fx + i * unit + dx, fy + j * unit + dy, (14, 19, 25))
    for j in range(16):
        if j in (0, 15):
            continue
        for i in range(16):
            if i in (0, 15):
                continue
    # frame
    for i in range(16):
        for dy in range(unit):
            for dx in range(unit):
                put(fx + i * unit + dx, fy + dy, (74, 90, 107))
                put(fx + i * unit + dx, fy + 15 * unit + dy, (74, 90, 107))
                put(fx + dx, fy + i * unit + dy, (74, 90, 107))
                put(fx + 15 * unit + dx, fy + i * unit + dy, (74, 90, 107))
    # blades
    for row in range(6):
        y0 = 2 + row * 2
        for i in range(2, 14):
            for dy in range(unit):
                for dx in range(unit):
                    put(fx + i * unit + dx, fy + y0 * unit + dy, (34, 44, 56))
    # ascending LED column: the number going up
    heights = [1, 2, 3, 5, 8, 12]
    for row in range(6):
        y0 = 2 + row * 2
        n = heights[row]
        for i in range(n):
            col = (53, 201, 143) if row < 4 else (143, 240, 196)
            for dy in range(unit):
                for dx in range(unit):
                    put(fx + (2 + i) * unit + dx, fy + y0 * unit + dy, col)
    return img


def main():
    os.makedirs(IMG, exist_ok=True)

    # The atlas is authored against the ramp in src/content/palettes.js. If
    # they ever diverge every sprite silently recolours, so check it here.
    pal = os.path.join(ROOT, 'src', 'content', 'palettes.js')
    src = open(pal).read()
    import re
    block = re.search(r'export const RAMP = Object\.freeze\(\[(.*?)\]\);', src, re.S).group(1)
    js_ramp = re.findall(r"'(#[0-9a-fA-F]{6})'", block)
    if js_ramp != RAMP:
        raise SystemExit(
            'ASSET ERROR: tools/pixel.py RAMP does not match src/content/palettes.js RAMP.\n'
            f'  js has {len(js_ramp)} entries, python has {len(RAMP)}.\n'
            '  Every sprite would recolour silently. Fix pixel.py and regenerate.')

    atlas, frames, w, h = pack(SPRITES)
    atlas.save(os.path.join(IMG, 'atlas.png'), optimize=True)

    world, ww, wh = make_world()
    world.save(os.path.join(IMG, 'world.png'), optimize=True)

    manifest = {
        'generated': 'tools/gen_assets.py',
        'note': 'Sprites are stored in ramp-index colours and recoloured at runtime by the phase LUT.',
        'atlas': {'w': w, 'h': h, 'file': 'atlas.png'},
        'world': {'w': ww, 'h': wh, 'file': 'world.png'},
        'ramp': RAMP,
        'frames': frames,
    }
    with open(os.path.join(IMG, 'atlas.json'), 'w') as f:
        json.dump(manifest, f, indent=1, sort_keys=True)

    for size in (192, 512):
        make_icon(size).save(os.path.join(ROOT, 'assets', f'icon-{size}.png'), optimize=True)
    make_icon(512, maskable=True).save(os.path.join(ROOT, 'assets', 'icon-maskable-512.png'), optimize=True)
    make_icon(64).save(os.path.join(ROOT, 'assets', 'favicon.png'), optimize=True)

    print(f'atlas   {w}x{h}  {len(frames)} sprites  '
          f'{os.path.getsize(os.path.join(IMG, "atlas.png"))} bytes')
    print(f'world   {ww}x{wh}  {os.path.getsize(os.path.join(IMG, "world.png"))} bytes')
    print(f'icons   192, 512, maskable-512, favicon-64')


if __name__ == '__main__':
    main()
