"""生成应用图标（纯标准库 PNG 编码）。只需运行一次：python fetcher/make_icons.py"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"


def png(size, maskable=False):
    rows = []
    c1, c2 = (79, 70, 229), (14, 165, 233)  # 靛蓝 → 天蓝渐变
    r_corner = 0 if maskable else size * 0.22
    star_r = size * (0.30 if maskable else 0.36)
    cx = cy = size / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            # 圆角矩形外部透明
            dx = max(r_corner - x, 0, x - (size - 1 - r_corner))
            dy = max(r_corner - y, 0, y - (size - 1 - r_corner))
            if r_corner and dx * dx + dy * dy > r_corner * r_corner:
                row += b"\x00\x00\x00\x00"
                continue
            t = (x + y) / (2 * size)
            col = [round(a + (b - a) * t) for a, b in zip(c1, c2)]
            # 四角星：|x|^0.5 + |y|^0.5 <= 1（astroid 形状）
            px, py = abs(x - cx) / star_r, abs(y - cy) / star_r
            if px <= 1 and py <= 1 and math.sqrt(px) + math.sqrt(py) <= 1:
                col = [255, 255, 255]
            # 右上角小星
            sx, sy = abs(x - size * 0.74) / (star_r * 0.32), abs(y - size * 0.27) / (star_r * 0.32)
            if sx <= 1 and sy <= 1 and math.sqrt(sx) + math.sqrt(sy) <= 1:
                col = [255, 255, 255]
            row += bytes(col) + b"\xff"
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon-192.png").write_bytes(png(192))
    (OUT / "icon-512.png").write_bytes(png(512))
    (OUT / "maskable-512.png").write_bytes(png(512, maskable=True))
    (OUT / "apple-touch-icon.png").write_bytes(png(180, maskable=True))  # iOS 自己加圆角
    print("icons written to", OUT)
