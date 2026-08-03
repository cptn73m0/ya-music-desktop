# -*- coding: utf-8 -*-
"""Генерация иконки приложения в эстетике Яндекс Музыки.

Чёрный квадрат со скруглёнными углами + жёлтая молния.
Результат: assets/icon.ico (мультиразмерный Windows ICO).
"""
from pathlib import Path

from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).resolve().parent.parent
OUT = BASE_DIR / "assets" / "icon.ico"

BLACK = (15, 15, 18)          # глубокий чёрно-серый (ЯМ-тема)
YELLOW = (255, 219, 77)       # #FFDB4D — акцент Яндекса


def draw_icon(size: int) -> Image.Image:
    canvas = size * 4  # рендерим в 4x, потом сгладим при уменьшении
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # скруглённый чёрный фон
    radius = int(canvas * 0.18)
    d.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=radius, fill=BLACK)

    # жёлтая молния (по центру)
    cx = canvas // 2
    s = canvas  # масштаб
    pts = [
        (cx + (s * 0.10), s * 0.06),   # верх правее
        (cx - (s * 0.17), s * 0.535),  # левый угол (середина влево)
        (cx - (s * 0.02), s * 0.535),  # вниз центр
        (cx - (s * 0.12), s * 0.74),   # левый нижний №1
        (cx + (s * 0.10), s * 0.94),   # вниз правее
        (cx - (s * 0.04), s * 0.74),   # центр низ
        (cx + (s * 0.17), s * 0.42),   # правый край №1
        (cx + (s * 0.00), s * 0.42),   # центр
        (cx + (s * 0.10), s * 0.06),   # замыкаем верх
    ]
    d.polygon(pts, fill=YELLOW)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    sizes = [256, 128, 64, 48, 32, 24, 16]
    frames = [draw_icon(s) for s in sizes]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        format="ICO",
        sizes=[(f.width, f.height) for f in frames],
        bitmap_format="png",
    )
    print(f"Saved -> {OUT}")


if __name__ == "__main__":
    main()
