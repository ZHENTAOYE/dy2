"""Contact sheet for review: python scripts/contact_sheet.py out.jpg a.jpg b.jpg ... (2 columns, labelled)."""
import sys, os
from PIL import Image, ImageDraw

out, *imgs = sys.argv[1:]
cols = 2
tiles = [Image.open(p).convert("RGB") for p in imgs]
tw, th = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw + (cols - 1) * 6, rows * (th + 26)), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (p, t) in enumerate(zip(imgs, tiles)):
    x = (i % cols) * (tw + 6)
    y = (i // cols) * (th + 26)
    d.text((x + 6, y + 6), os.path.basename(p), fill=(255, 255, 0))
    sheet.paste(t.resize((tw, th)), (x, y + 26))
sheet.save(out, quality=88)
print(out, sheet.size)
