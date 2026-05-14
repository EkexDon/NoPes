import cv2
import numpy as np
import os
import shutil

# Create directory for sprites
out_dir = "src/assets/nopi"
if os.path.exists(out_dir):
    shutil.rmtree(out_dir)
os.makedirs(out_dir)

# Read the image
img = cv2.imread("pets_sheet.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# Threshold to isolate non-white areas
# The background is white (255). We want things that are < 240.
_, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

# Dilate to connect parts of the same pet
kernel = np.ones((15, 15), np.uint8)
dilated = cv2.dilate(thresh, kernel, iterations=2)

# Find contours
contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

boxes = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    # Filter out text / noise (pets should be at least 40x40)
    if w > 40 and h > 40 and h < 200:
        boxes.append((x, y, w, h))

# Sort from top to bottom, then left to right
# Group by rows: if y values are within 50 pixels of each other, they are in the same row
rows = []
for box in sorted(boxes, key=lambda b: b[1]):
    x, y, w, h = box
    placed = False
    for row in rows:
        # If the y is close to the average y of the row
        if abs(y - np.mean([b[1] for b in row])) < 50:
            row.append(box)
            placed = True
            break
    if not placed:
        rows.append([box])

# Sort each row left to right
final_boxes = []
for row in rows:
    final_boxes.extend(sorted(row, key=lambda b: b[0]))

print(f"Found {len(final_boxes)} valid pet sprites.")

# Extract and save
for idx, (x, y, w, h) in enumerate(final_boxes):
    # Add a small margin
    margin = 5
    x1 = max(0, x - margin)
    y1 = max(0, y - margin)
    x2 = min(img.shape[1], x + w + margin)
    y2 = min(img.shape[0], y + h + margin)
    
    pet_img = img[y1:y2, x1:x2]
    cv2.imwrite(os.path.join(out_dir, f"pet_{idx+1}.png"), pet_img)

print("Saved sprites to", out_dir)
