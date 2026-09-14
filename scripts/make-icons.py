#!/usr/bin/env python3
"""
Draws Stockpot's app icons.

Kept as a script rather than committed-and-forgotten PNGs so the mark can be
adjusted without a design tool, and so it is obvious how it was made.

    pip install Pillow && python scripts/make-icons.py
"""

from PIL import Image, ImageDraw

PLUM = (124, 47, 80, 255)      # accent, the app's brand colour
CREAM = (251, 247, 245, 255)   # ground
WHITE = (255, 255, 255, 255)

S = 1024  # working size


def draw_pot(draw: ImageDraw.ImageDraw, colour, scale: float = 1.0, dy: int = 0) -> None:
    """A stockpot: lid, knob, two handles, straight-sided body.

    Deliberately plain — at 48px on a home screen, a silhouette reads and a
    detailed illustration turns to mush.
    """
    def s(v: float) -> float:
        return (v - S / 2) * scale + S / 2

    def box(x0, y0, x1, y1):
        return [s(x0), s(y0) + dy, s(x1), s(y1) + dy]

    # Handles first, so the body overlaps them and they read as attached.
    draw.rounded_rectangle(box(138, 470, 248, 546), radius=38 * scale, fill=colour)
    draw.rounded_rectangle(box(776, 470, 886, 546), radius=38 * scale, fill=colour)

    # Body, square-shouldered with a softened base.
    draw.rounded_rectangle(
        box(232, 440, 792, 782), radius=76 * scale, fill=colour,
        corners=(False, False, True, True),
    )

    # Lid and knob.
    draw.rounded_rectangle(box(190, 360, 834, 432), radius=36 * scale, fill=colour)
    draw.ellipse(box(468, 286, 556, 374), fill=colour)


def canvas(size: int = S, fill=(0, 0, 0, 0)) -> Image.Image:
    return Image.new("RGBA", (size, size), fill)


def save(img: Image.Image, path: str, size: int | None = None) -> None:
    if size and size != img.width:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print(f"  {path} ({img.width}px)")


# ---- store icon: cream pot on plum -----------------------------------------
icon = canvas(fill=PLUM)
draw_pot(ImageDraw.Draw(icon), CREAM, scale=0.94, dy=-26)
save(icon, "assets/images/icon.png")
save(icon.copy(), "assets/images/favicon.png", 96)

# ---- Android adaptive: layers, with the mark inside the safe zone ----------
bg = canvas(fill=PLUM)
save(bg, "assets/images/android-icon-background.png")

fg = canvas()
draw_pot(ImageDraw.Draw(fg), CREAM, scale=0.62, dy=-18)
save(fg, "assets/images/android-icon-foreground.png")

mono = canvas()
draw_pot(ImageDraw.Draw(mono), WHITE, scale=0.62, dy=-18)
save(mono, "assets/images/android-icon-monochrome.png")

# ---- splash: the mark alone, the plugin paints the ground ------------------
splash = canvas()
draw_pot(ImageDraw.Draw(splash), CREAM, scale=0.80, dy=-22)
save(splash, "assets/images/splash-icon.png")

print("done")
