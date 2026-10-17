#!/usr/bin/env python3
"""Draw the app icons (standard library only): navy square, two white ski tracks, a blue band.

    python3 tools/make_icons.py

Writes public/icons/icon-192.png, icon-512.png and apple-touch-icon.png (180).
Artwork stays inside the central 80 % so the icons survive maskable cropping.
"""
import os
import struct
import zlib

SITE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
NAVY = (0x0c, 0x3d, 0x54)
BLUE = (0x00, 0x5d, 0xaa)
WHITE = (255, 255, 255)
SS = 3  # supersampling per axis, for smooth edges


def coverage(x, y, size):
    """Colour (r, g, b) at a point in unit coordinates 0..1."""
    # Blue band across the lower part.
    if 0.70 <= y <= 0.80 and 0.14 <= x <= 0.86:
        return BLUE
    # Two parallel diagonal tracks, running bottom-left to top-right.
    for offset in (-0.09, 0.09):
        d = abs((x - 0.5) + (y - 0.45) - offset * 2) / 2 ** 0.5  # distance to a 45-degree line
        if d <= 0.028 and 0.16 <= y <= 0.64:
            return WHITE
    return NAVY


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type: none
        for px in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = coverage((px + (sx + .5) / SS) / size, (py + (sy + .5) / SS) / size, size)
                    r += c[0]; g += c[1]; b += c[2]
            n = SS * SS
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return b''.join(rows)


def png(size):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(render(size), 9)) + chunk(b'IEND', b'')


def main():
    out = os.path.join(SITE_DIR, 'icons')
    os.makedirs(out, exist_ok=True)
    for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
        with open(os.path.join(out, name), 'wb') as f:
            f.write(png(size))
        print(f'wrote icons/{name}')


if __name__ == '__main__':
    main()
