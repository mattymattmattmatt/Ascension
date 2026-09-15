"""pixel.py - tiny pixel-art helpers for the Ascension asset generator.

Sprites are authored as strings, one character per pixel, so the art lives
in readable source rather than in a binary nobody can diff. Characters map
to indices into the game's single 32-colour ramp; '.' is transparent.

The atlas ships in RAMP-INDEX colours. The runtime applies the phase LUT as
a per-pixel pass, which is how one set of sprites reads correctly in all six
palette tunings (GDD 15.2).
"""
from PIL import Image

# index 0-31 -> character. Keeps sprite strings readable.
CHARS = '0123456789abcdefghijklmnopqrstuv'
IDX = {c: i for i, c in enumerate(CHARS)}

# Mirrors RAMP in src/content/palettes.js. gen_assets.py asserts they match.
RAMP = [
    '#07090c', '#0e1319', '#161d26', '#222c38', '#33404f', '#4a5a6b',
    '#64788a', '#8ba0b0', '#b9cbd6', '#e8f2f5',
    '#0f5a4a', '#1a8f6d', '#35c98f', '#8ff0c4',
    '#123a5e', '#1d6ea8', '#3aa6e0', '#9adcff',
    '#5c1616', '#a8342a', '#e05c3a', '#ffb07a',
    '#5c4310', '#a8811c', '#e0b73a', '#ffe9a0',
    '#14471f', '#2c8a3c', '#63d271',
    '#7a5ccc', '#02030a', '#ffffff',
]
RGB = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in RAMP]


def parse(art):
    """Rows of characters -> list of rows of (index or None)."""
    rows = [r for r in art.strip('\n').split('\n')]
    w = max(len(r) for r in rows)
    out = []
    for r in rows:
        r = r.ljust(w, '.')
        out.append([None if c == '.' else IDX[c] for c in r])
    return out


class Canvas:
    """An index-buffer with the handful of primitives the art needs."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def set(self, x, y, i):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = i

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def rect(self, x, y, w, h, i):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, i)

    def frame(self, x, y, w, h, i):
        for xx in range(x, x + w):
            self.set(xx, y, i)
            self.set(xx, y + h - 1, i)
        for yy in range(y, y + h):
            self.set(x, yy, i)
            self.set(x + w - 1, yy, i)

    def hline(self, x, y, w, i):
        for xx in range(x, x + w):
            self.set(xx, y, i)

    def vline(self, x, y, h, i):
        for yy in range(y, y + h):
            self.set(x, yy, i)

    def line(self, x0, y0, x1, y1, i):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.set(x0, y0, i)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def blit(self, art, x, y):
        for dy, row in enumerate(parse(art) if isinstance(art, str) else art):
            for dx, v in enumerate(row):
                if v is not None:
                    self.set(x + dx, y + dy, v)

    def to_image(self):
        img = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        p = img.load()
        for y in range(self.h):
            for x in range(self.w):
                v = self.px[y][x]
                if v is not None:
                    p[x, y] = RGB[v] + (255,)
        return img


def sprite(art):
    rows = parse(art)
    c = Canvas(len(rows[0]), len(rows))
    c.blit(rows, 0, 0)
    return c
