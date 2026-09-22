#!/usr/bin/env python3
"""GenOffice 鸿蒙图标资源生成(可复现:源图 + 本脚本 → 三个资源)

用法:   python3 scripts/gen-icons.py
正确目录: 仓库根(脚本内按相对路径取源/写产物)
源:     thirdparty/genoffice/apps/shell/build/icons/1024x1024.png
        (官方图标:透明角 + 黑色圆角方 + 白色 G)
产物:   AppScope/resources/base/media/background.png   分层图标背景层(纯黑,系统裁形状)
        AppScope/resources/base/media/foreground.png   分层图标前景层(白 G,透明底)
        entry/src/main/resources/base/media/app_icon.png  ability 图标(原图形态)
依据:   前景 G 包围盒 588x630、中心 (512,512)=图心,630/1024≈62% 落在鸿蒙前景安全区
        (62.5%),圆形裁切不切内容(已用合成预览核验)。
依赖:   python3 + PIL + numpy
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "thirdparty/genoffice/apps/shell/build/icons/1024x1024.png"
APP_MEDIA = ROOT / "AppScope/resources/base/media"
ENTRY_MEDIA = ROOT / "entry/src/main/resources/base/media"


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: 图标源缺失 {SRC}(thirdparty/genoffice 未初始化?)", file=sys.stderr)
        return 1

    im = Image.open(SRC).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    white = (a[..., 0] > 200) & (a[..., 1] > 200) & (a[..., 2] > 200) & (a[..., 3] > 128)

    APP_MEDIA.mkdir(parents=True, exist_ok=True)
    ENTRY_MEDIA.mkdir(parents=True, exist_ok=True)

    Image.new("RGBA", (w, h), (0, 0, 0, 255)).save(APP_MEDIA / "background.png")

    fg = np.zeros((h, w, 4), np.uint8)
    fg[white] = [255, 255, 255, 255]
    Image.fromarray(fg, "RGBA").save(APP_MEDIA / "foreground.png")

    im.save(ENTRY_MEDIA / "app_icon.png")

    ys, xs = np.where(white)
    print(f"前景 {xs.max()-xs.min()+1}x{ys.max()-ys.min()+1} 中心 "
          f"({(xs.min()+xs.max())/2:.0f},{(ys.min()+ys.max())/2:.0f}) / 图心 ({(w-1)/2:.0f},{(h-1)/2:.0f})")
    print("产物: background.png / foreground.png / app_icon.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
