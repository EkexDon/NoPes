import os
from PIL import Image

in_dir = "src/assets/nopi"

for f in os.listdir(in_dir):
    if not f.endswith('.png'): continue
    path = os.path.join(in_dir, f)
    img = Image.open(path).convert("RGBA")
    datas = img.getdata()

    newData = []
    for item in datas:
        # change all white (also shades of white)
        # to transparent
        if item[0] > 230 and item[1] > 230 and item[2] > 230:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)

    img.putdata(newData)
    img.save(path, "PNG")
print("Made backgrounds transparent.")
