"""Make the site's pictures from the channel's own art, so the site and the videos match.

Run from a checkout of venu-vena-studio (it reuses its Paper Garden code and Naveen's brand art):

    cd ../venu-vena-studio && PYTHONPATH=src python3 ../venuandvena/tools/make_art.py ../venuandvena/site/img

Writes WebP files: venu.webp and vena.webp (white-rimmed stickers cut from the channel banner),
wordmark.webp (the "Venu & Vena" lettering), hills.webp, sun.webp, cloud-1.webp, cloud-2.webp,
and the home-screen icons. Nothing here is newly generated art.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

from venu_vena.studio import publish
from venu_vena.studio.episodes.meet_a import Assets, anchor_of

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def trim(img: Image.Image, pad: int = 2) -> Image.Image:
    box = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    x0, y0, x1, y1 = box
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def save(img: Image.Image, name: str, width: int | None = None, quality: int = 80) -> None:
    if width and img.width != width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.save(out / name, "WEBP", quality=quality, alpha_quality=80, method=6)
    print(name, img.size, (out / name).stat().st_size // 1024, "KB")


# Characters and lettering, cut out of the banner exactly as the channel banner does it.
with Image.open(publish.BRAND / "youtube-banner.jpg") as im:
    art = publish._lift(im.convert("RGB").crop(publish.LOCKUP))
alpha = np.asarray(art.getchannel("A"))
h, w = alpha.shape
yy, xx = np.mgrid[0:h, 0:w]
venu = xx < 488
vena = (xx >= 1120) | ((xx >= 1095) & (yy >= 290))


def part(keep, pad=0):
    o = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    cut = art.copy()
    cut.putalpha(Image.fromarray(np.where(keep, alpha, 0).astype(np.uint8)))
    o.paste(cut, (pad, pad))
    return o


save(trim(publish._sticker(part(venu, 60), 9, 1), 4), "venu.webp", 520, 74)
save(trim(publish._sticker(part(vena, 60), 9, 2), 4), "vena.webp", 480, 74)
# The lettering without the tagline (the tagline is live text on the page).
letters = ~venu & ~vena & (yy < 300)
save(trim(part(letters)), "wordmark.webp", 820, 76)

# The Paper Garden sky pieces and hills from Meet A.
a = Assets()
sun, _ = anchor_of(a.sun)
save(trim(sun), "sun.webp", 200, 70)
for i, cl in enumerate(a.clouds[:2], 1):
    ci, _ = anchor_of(cl)
    save(trim(ci), f"cloud-{i}.webp", 320, 66)
hills = Image.new("RGBA", (3810, 1400), (0, 0, 0, 0))
for im, (ox, oy) in (a.far, a.mid, a.ground):
    hills.alpha_composite(im, (0, -oy - 300))
hills = trim(hills.crop((0, 0, 3810, 1080 - 300)), 0)
save(hills, "hills.webp", 2400, 58)

# Icons: Naveen's profile picture (the same one as the channel).
pic = publish.avatar()
for size, name in ((180, "apple-touch-icon.png"), (512, "icon-512.png")):
    pic.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)
    print(name)
pic.resize((64, 64), Image.LANCZOS).save(out / "favicon.png", optimize=True)
print("favicon.png")

# A torn cream paper strip with a white core (the wordmark sits on it, as on the banner),
# and a torn edge used as a mask for section edges (its colour comes from the page, so it
# works in dark mode too).
from venu_vena.studio.paper import piece  # noqa: E402

sw, sh = 1000, 300
strip, _ = piece(
    [(-sw / 2, -sh / 2), (sw / 2, -sh / 2), (sw / 2, sh / 2), (-sw / 2, sh / 2)],
    publish.PAPER, seed=9, tear=7, rim=7, texture=0.035, shadow=0.3, shadow_offset=(7, 11), blur=9,
)  # fmt: skip
save(trim(strip), "strip.webp", 900, 60)
ew, eh = 2400, 200
edge, _ = piece(
    [(-ew / 2, -eh / 2), (ew / 2, -eh / 2), (ew / 2, eh / 2), (-ew / 2, eh / 2)],
    (0, 0, 0), seed=21, tear=9, rim=0, texture=0.0, shadow=0.0,
)  # fmt: skip
a_ = trim(edge, 0).getchannel("A")
a_ = a_.crop((40, 0, a_.width - 40, 48)).resize((1200, 24), Image.LANCZOS)
mask = Image.new("LA", a_.size, (0, 0))
mask.putalpha(a_)
mask.save(out / "torn-edge.png", optimize=True)
print("torn-edge.png", mask.size)
