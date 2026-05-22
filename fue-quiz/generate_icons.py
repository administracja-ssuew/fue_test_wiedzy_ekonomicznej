#!/usr/bin/env python3
"""
Generates icon-192.png, icon-512.png i apple-touch-icon.png dla PWA FUE Quiz.
Uruchom: python3 generate_icons.py
Wymagania: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

def make_icon(size, output_path):
    img = Image.new("RGBA", (size, size), (7, 2, 21, 255))
    draw = ImageDraw.Draw(img)

    # Tło – fioletowe kółko
    margin = int(size * 0.05)
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(107, 33, 232, 255)
    )

    # Wewnętrzne ciemniejsze kółko
    inner = int(size * 0.12)
    draw.ellipse(
        [inner, inner, size - inner, size - inner],
        fill=(79, 70, 229, 255)
    )

    # Tekst "FUE"
    font_size = int(size * 0.32)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    text = "FUE"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) / 2
    y = (size - text_h) / 2 - int(size * 0.04)
    draw.text((x, y), text, fill=(245, 197, 24, 255), font=font)

    # Małe "🐐" zastąp tekstem
    sub_font_size = int(size * 0.12)
    try:
        sub_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", sub_font_size)
    except:
        sub_font = font
    sub_text = "QUIZ"
    sbbox = draw.textbbox((0, 0), sub_text, font=sub_font)
    sw = sbbox[2] - sbbox[0]
    sx = (size - sw) / 2
    sy = y + text_h + int(size * 0.03)
    draw.text((sx, sy), sub_text, fill=(196, 181, 253, 255), font=sub_font)

    img.save(output_path, "PNG")
    print(f"  ✓ {output_path} ({size}x{size})")

os.makedirs("public", exist_ok=True)
print("Generowanie ikon PWA...")
make_icon(192, "public/icon-192.png")
make_icon(512, "public/icon-512.png")
make_icon(180, "public/apple-touch-icon.png")
print("\nGotowe! Ikony zapisane w /public/")
