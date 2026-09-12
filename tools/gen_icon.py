#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成应用图标与安装包美术资源。

产出:
  build/icon.ico              应用图标 (16/24/32/48/64/128/256 多尺寸)
  build/icon.png              512px 预览图
  build/installerHeader.bmp   NSIS 安装向导顶部条 (150x57)
  build/installerSidebar.bmp  NSIS 安装向导左侧图 (164x314)
  src/renderer/assets/logo.svg 界面用矢量 Logo

设计理念: 圆角方块 + 一条向上的推送箭头 + 底部的分支/提交点,
          表达"把文件夹里的东西推上去"。纯几何绘制, 不依赖字体。

用法: python tools/gen_icon.py
"""
import math
import os
import struct
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit("需要 Pillow: python -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ASSETS = os.path.join(ROOT, "src", "renderer", "assets")

# ---------------------------------------------------------------- 配色
BG_TOP = (45, 164, 106)      # 明亮绿
BG_BOTTOM = (23, 106, 68)    # 深绿
ACCENT = (255, 255, 255)
SHADOW = (10, 46, 30)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vertical_gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        px[0, y] = lerp(top, bottom, y / max(1, h - 1))
    return img.resize((w, h), Image.BILINEAR)


def rounded_mask(size, radius, supersample=4):
    """返回一张抗锯齿的圆角矩形遮罩 (L 模式)。"""
    w, h = size
    big = (w * supersample, h * supersample)
    m = Image.new("L", big, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, big[0] - 1, big[1] - 1],
                        radius=radius * supersample, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def draw_glyph(size, pad_ratio=0.0):
    """在透明画布上画白色图形: 向上箭头 + 底部提交点。返回 RGBA。"""
    s = size
    SS = 4  # 超采样, 保证小尺寸也干净
    W = s * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 以 0..100 的设计坐标系布局, 再换算到像素
    def P(x, y):
        return (x / 100.0 * W, y / 100.0 * W)

    stem_w = 19.0                 # 箭杆宽度
    head_w = 46.0                 # 箭头宽度
    head_h = 30.0                 # 箭头高度
    top = 20.0                    # 箭头尖端 y
    stem_bottom = 66.0            # 箭杆底部 y
    head_base = top + head_h      # 箭头底部 y

    # 箭杆
    d.rectangle([P(50 - stem_w / 2, head_base - 2)[0], P(0, head_base - 2)[1],
                 P(50 + stem_w / 2, stem_bottom)[0], P(0, stem_bottom)[1]],
                fill=ACCENT + (255,))
    # 箭头(三角)
    d.polygon([P(50, top), P(50 + head_w / 2, head_base), P(50 - head_w / 2, head_base)],
              fill=ACCENT + (255,))

    # 底部三个提交点(表示 git 的提交历史), 中间那个大一点
    dot_y = 83.0
    for cx, r in ((24.0, 5.2), (50.0, 7.4), (76.0, 5.2)):
        d.ellipse([P(cx - r, dot_y - r)[0], P(0, dot_y - r)[1],
                   P(cx + r, dot_y + r)[0], P(0, dot_y + r)[1]],
                  fill=ACCENT + (255,))
    # 连接线
    d.line([P(24, dot_y), P(76, dot_y)], fill=ACCENT + (170,), width=int(2.0 / 100 * W))

    img = img.resize((s, s), Image.LANCZOS)
    return img


def make_icon(size):
    """生成一张完整的应用图标 (RGBA)。"""
    base = vertical_gradient((size, size), BG_TOP, BG_BOTTOM).convert("RGBA")

    # 顶部高光, 让方块不那么平
    gloss = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.ellipse([-size * 0.35, -size * 0.95, size * 1.35, size * 0.62],
               fill=(255, 255, 255, 34))
    base = Image.alpha_composite(base, gloss)

    base.putalpha(rounded_mask((size, size), radius=int(size * 0.235)))

    # 内部白色图形
    glyph = draw_glyph(size)
    # 给图形加一点点暗色投影, 提升在亮背景上的辨识度
    sh = glyph.split()[3].point(lambda v: int(v * 0.35))
    shadow = Image.new("RGBA", (size, size), SHADOW + (0,))
    shadow.putalpha(sh)
    off = max(1, int(size * 0.022))
    base = Image.alpha_composite(base, shadow.transform(
        (size, size), Image.AFFINE, (1, 0, -off, 0, 1, -off), resample=Image.BILINEAR))
    base = Image.alpha_composite(base, glyph)
    return base


def write_ico(path, images):
    """手写 ICO 容器, 保证顺序与尺寸完全可控。"""
    entries = []
    blobs = []
    offset = 6 + 16 * len(images)
    for im in images:
        import io
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        w, h = im.size
        entries.append(struct.pack(
            "<BBBBHHII",
            0 if w >= 256 else w,
            0 if h >= 256 else h,
            0, 0, 1, 32, len(data), offset))
        blobs.append(data)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(images)))
        for e in entries:
            f.write(e)
        for b in blobs:
            f.write(b)


def make_sidebar(w=164, h=314):
    """NSIS 左侧竖图: 渐变底 + 居中 Logo + 底部小字块。"""
    img = vertical_gradient((w, h), (32, 34, 38), (18, 19, 22)).convert("RGBA")

    # 斜向光带
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-w * 0.6, -h * 0.15, w * 1.5, h * 0.55], fill=(45, 164, 106, 66))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img = Image.alpha_composite(img, glow)

    logo_size = 84
    logo = make_icon(logo_size)
    img.alpha_composite(logo, ((w - logo_size) // 2, 62))

    # 底部色条, 与安装向导主题呼应
    bar = Image.new("RGBA", (w, 6), (45, 164, 106, 255))
    img.alpha_composite(bar, (0, h - 6))

    return img.convert("RGB")


def make_header(w=150, h=57):
    """NSIS 顶部横条: 左侧小 Logo + 右侧留白(由安装器渲染标题)。"""
    img = Image.new("RGB", (w, h), (255, 255, 255))
    logo_size = 38
    logo = make_icon(logo_size)
    img.paste(logo, (10, (h - logo_size) // 2), logo)
    d = ImageDraw.Draw(img)
    # 一条细的绿色下划线
    d.rectangle([0, h - 3, w, h - 1], fill=(45, 164, 106))
    return img


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2da46a"/>
      <stop offset="1" stop-color="#176a44"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" rx="23.5" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="40.5" y="46" width="19" height="20"/>
    <polygon points="50,20 73,50 27,50"/>
    <circle cx="24" cy="83" r="5.2"/>
    <circle cx="50" cy="83" r="7.4"/>
    <circle cx="76" cy="83" r="5.2"/>
  </g>
  <line x1="24" y1="83" x2="76" y2="83" stroke="#fff" stroke-opacity="0.66" stroke-width="2"/>
</svg>
"""


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [make_icon(s) for s in sizes]

    ico = os.path.join(BUILD, "icon.ico")
    write_ico(ico, images)
    print("OK  ", ico)

    png = os.path.join(BUILD, "icon.png")
    make_icon(512).save(png)
    print("OK  ", png)

    hdr = os.path.join(BUILD, "installerHeader.bmp")
    make_header().save(hdr, format="BMP")
    print("OK  ", hdr)

    side = os.path.join(BUILD, "installerSidebar.bmp")
    make_sidebar().save(side, format="BMP")
    print("OK  ", side)

    svg = os.path.join(ASSETS, "logo.svg")
    with open(svg, "w", encoding="utf-8") as f:
        f.write(SVG)
    print("OK  ", svg)


if __name__ == "__main__":
    main()
