import os
from PIL import Image

out_dir = "src/assets/nopi"
os.makedirs(out_dir, exist_ok=True)

img = Image.open("pets_sheet.png")

# Convert to RGBA to preserve transparency
if img.mode != 'RGBA':
    img = img.convert('RGBA')

w, h = img.size
cols = 7
rows = 7

dx = w / cols
dy = h / rows

def trim_transparency(image):
    """Remove transparent borders and return trimmed image"""
    if image.mode != 'RGBA':
        return image
    
    # Get alpha channel
    alpha = image.split()[-1]
    
    # Get bounding box of non-transparent pixels
    bbox = alpha.getbbox()
    
    if bbox:
        return image.crop(bbox)
    return image

idx = 0
for r in range(rows):
    for c in range(cols):
        left = c * dx
        top = r * dy
        right = left + dx
        bottom = top + dy
        
        # Crop the cell
        cropped = img.crop((left, top, right, bottom))
        
        # Trim transparent borders
        trimmed = trim_transparency(cropped)
        
        # Create a fixed size canvas (64x64) and center the pet
        canvas = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
        
        # Calculate position to center the trimmed image
        x = (64 - trimmed.width) // 2
        y = (64 - trimmed.height) // 2
        
        # Paste onto canvas
        canvas.paste(trimmed, (x, y), trimmed if trimmed.mode == 'RGBA' else None)
        
        # Save with transparency
        canvas.save(f"{out_dir}/pet_{idx:02d}.png", 'PNG')
        idx += 1

print(f"Done! Generated {idx} pet images in {out_dir}")
