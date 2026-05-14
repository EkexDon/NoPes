import os
from PIL import Image

in_dir = "src/assets/nopi"
for f in os.listdir(in_dir):
    if not f.endswith('.png'): continue
    path = os.path.join(in_dir, f)
    img = Image.open(path)
    w, h = img.size
    # Crop the bottom 35 pixels (where the text is)
    img = img.crop((0, 0, w, h - 35))
    img.save(path, "PNG")
print("Cropped text from bottom")
