import os
from PIL import Image

out_dir = "src/assets/nopi"
os.makedirs(out_dir, exist_ok=True)

img = Image.open("pets_sheet.png")
w, h = img.size
cols = 7
rows = 7

dx = w / cols
dy = h / rows

idx = 0
for r in range(rows):
    for c in range(cols):
        left = c * dx
        top = r * dy
        right = left + dx
        bottom = top + dy
        cropped = img.crop((left, top, right, bottom))
        cropped.save(f"{out_dir}/pet_{idx:02d}.png")
        idx += 1
print("Done")
