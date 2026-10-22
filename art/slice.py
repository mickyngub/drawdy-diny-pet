# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
import base64, io
from pathlib import Path
from PIL import Image

ART = Path(__file__).parent
OUT = ART.parent / "src" / "sprite-data.ts"
FRAMES = {
    "DINY_IDLE": "diny-2.png",
    "DINY_SHOUT": "diny-1.png",
    "DINY_HAPPY": "diny-happy.png",
    "DINY_WAVE": "diny-wave.png",
    "DINY_JUMP": "diny-jump.png",
    "DINY_FALL": "diny-fall.png",
    "DINY_TIRED": "diny-tired.png",
    "DINY_SLEEP": "diny-sleep.png",
    "DINY_HELD": "diny-held.png",
}
TARGET_W = 192

def alpha_box(im):
    return im.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()

def feet_x(im):
    a = im.getchannel("A").load()
    w, h = im.size
    _, _, _, bottom = alpha_box(im)
    xs = [x for y in range(int(bottom * 0.9), bottom) for x in range(w) if a[x, y] > 12]
    return sum(xs) / len(xs)

def to_webp_uri(im, quality=85):
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

frames = {name: Image.open(ART / file).convert("RGBA") for name, file in FRAMES.items()}
w, h = frames["DINY_IDLE"].size
boxes = [alpha_box(im) for im in frames.values()]
left = min(b[0] for b in boxes)
bottom = max(b[3] for b in boxes)
# The pet stands at the bottom centre of its box, so both frames move by the
# same amount until the feet touch the bottom edge and sit as near the middle
# as the sword allows; a flip then turns Diny round on the spot.
dx = min(round(feet_x(frames["DINY_IDLE"]) - w / 2), left)
dy = h - bottom
target_h = round(h * TARGET_W / w)
ts = []
for name, im in frames.items():
    shifted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shifted.paste(im, (-dx, dy))
    uri = to_webp_uri(shifted.resize((TARGET_W, target_h), Image.LANCZOS))
    ts.append(f'export const {name} =\n    "{uri}";')
    print(name, TARGET_W, target_h, len(uri) // 1024, "KB")
OUT.write_text("\n\n".join(ts) + "\n")
print("shifted", -dx, dy)
