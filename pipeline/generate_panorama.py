"""Generate a seamless 4K equirectangular panorama for a TimePortalVR experience.

Three ComfyUI passes, with image surgery in between:

  1. txt2img   FLUX.1-dev renders a 2048x1024 equirectangular frame.
  2. seam fix  The left and right edges of an equirect image meet in VR, but the
               model has no idea they do, so they never line up. We roll the
               image half its width -- putting that discontinuity in the middle
               -- and inpaint a vertical strip over it, then roll it back.
  3. upscale   RealESRGAN 4x -> 8192x4096, then Lanczos down to 4096x2048.
               Upscaling past the target and resampling back down is what kills
               the model's own texture artefacts; 8K itself is not worth
               shipping, since the Quest resamples it on texture upload anyway.

Finally the result is written as JPEG with GPano XMP metadata, which is what
tells Quest gallery / Google Photos to open it as a sphere rather than a
flat picture. Three.js ignores GPano and keys off the 2:1 aspect ratio, so
the Angular viewer works either way.

Usage:
    # ComfyUI must already be running (main.py) on port 8188.
    venv\\Scripts\\python.exe ..\\generate_panorama.py \\
        --slug d-day \\
        --prompt "Omaha Beach, June 6 1944, landing craft ramps down, ..."

    # quick low-res check, no seam fix, no upscale
    ... --width 1024 --height 512 --no-seam-fix --no-upscale
"""

from __future__ import annotations

import argparse
import io
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).parent.parent
WORKFLOWS = Path(__file__).parent / "workflows"
DEFAULT_OUT = ROOT / "public" / "panoramas"
SERVER = "http://127.0.0.1:8188"

# Write --prompt in English. FLUX is trained overwhelmingly on English captions
# and historical specificity is the first thing to go otherwise: the same seed
# and settings turned "barcacas de desembarque na arrebentacao" into a calm sunny
# beach, and the English wording into landing craft, troops and shellfire.
#
# The scene goes first and the projection terms last. Tested against the reverse
# ordering (projection first) on a fixed seed: it made no visible difference, so
# do not bother trying that again -- whatever is dropping the period detail out
# of long prompts, prompt position is not it. Content-first is kept only because
# it reads more naturally. FLUX does need telling plainly that it is a sphere:
# "360" alone tends to give a fisheye/little-planet look instead.
#
# "equirectangular 360 degree panorama" is the trigger phrase of the LoRA and has
# to appear verbatim -- an earlier version of this suffix said "360 degree
# spherical panorama", which reads the same to a human and misses the trigger.
#
# Base FLUX cannot do this projection at all: prompting for it yields a wide 2:1
# photograph, not a sphere -- flat sky at the top instead of a stretched zenith,
# receding ground at the bottom instead of a nadir, and maybe 90 degrees of
# content where 360 is needed. It looks fine as a picture and wrong in a headset.
# The LoRA is what supplies the projection; the words alone never did.
#
# Poles are where equirect projection stretches worst, so the suffix used to end
# with "open sky overhead, continuous ground below" to keep the smear on surfaces
# nobody looks at. Dropped after a fixed-seed comparison: the guards cost more
# than they bought, flattening the scene into a bare beach with an empty sky.
# The poles are no worse without them. Do not add them back.
EQUIRECT_SUFFIX = (
    ", equirectangular 360 degree panorama, full 360x180 view, "
    "seamless horizontal wrap, level horizon across the full width, "
    "photorealistic, natural lighting, no text, no watermark"
)


# --------------------------------------------------------------------------
# ComfyUI API
# --------------------------------------------------------------------------

def submit(workflow: dict) -> str:
    r = requests.post(f"{SERVER}/prompt", json={"prompt": workflow}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"ComfyUI rejected the workflow:\n{r.text}")
    return r.json()["prompt_id"]


def wait_for(prompt_id: str, label: str, timeout: int = 1800) -> dict:
    """Block until the prompt finishes, then return its history entry."""
    start = time.time()
    while True:
        if time.time() - start > timeout:
            raise TimeoutError(f"{label}: no result after {timeout}s")
        h = requests.get(f"{SERVER}/history/{prompt_id}", timeout=30).json()
        if prompt_id in h:
            entry = h[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"{label} failed:\n{json.dumps(status, indent=2)}")
            if status.get("completed"):
                return entry
        print(f"  {label}: {int(time.time() - start)}s", end="\r", flush=True)
        time.sleep(2)


def first_image(entry: dict) -> Image.Image:
    for node_out in entry["outputs"].values():
        for meta in node_out.get("images", []):
            r = requests.get(
                f"{SERVER}/view",
                params={
                    "filename": meta["filename"],
                    "subfolder": meta.get("subfolder", ""),
                    "type": meta.get("type", "output"),
                },
                timeout=120,
            )
            r.raise_for_status()
            return Image.open(io.BytesIO(r.content))
    raise RuntimeError("workflow produced no image")


def upload(img: Image.Image, name: str) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    r = requests.post(
        f"{SERVER}/upload/image",
        files={"image": (name, buf, "image/png")},
        data={"overwrite": "true"},
        timeout=300,
    )
    r.raise_for_status()
    return r.json()["name"]


def load_workflow(name: str) -> dict:
    return json.loads((WORKFLOWS / name).read_text(encoding="utf-8"))


def run(workflow: dict, label: str) -> Image.Image:
    print(f"[{label}] queued")
    entry = wait_for(submit(workflow), label)
    img = first_image(entry)
    print(f"[{label}] done -> {img.width}x{img.height}      ")
    return img


# --------------------------------------------------------------------------
# Seam handling
# --------------------------------------------------------------------------

def roll(img: Image.Image, shift: int) -> Image.Image:
    """Rotate the image horizontally, wrapping around. Lossless."""
    return Image.fromarray(np.roll(np.asarray(img.convert("RGB")), shift, axis=1))


def add_seam_mask(img: Image.Image, strip: int, feather: int) -> Image.Image:
    """Mark a vertical strip down the centre as the region to repaint.

    ComfyUI's LoadImage derives its MASK as (1 - alpha), so the area we want
    denoised has to be the *transparent* one. The feathered ramp keeps the
    repainted strip from showing hard vertical edges of its own.
    """
    w, h = img.size
    alpha = np.full(w, 255, dtype=np.float32)
    centre = w // 2
    half = strip // 2
    alpha[centre - half : centre + half] = 0.0
    for i in range(feather):
        v = 255.0 * (i + 1) / (feather + 1)
        alpha[centre - half - 1 - i] = v
        alpha[centre + half + i] = v

    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(np.tile(alpha, (h, 1)).astype(np.uint8), mode="L"))
    return out


# --------------------------------------------------------------------------
# GPano metadata
# --------------------------------------------------------------------------

def gpano_xmp(width: int, height: int) -> bytes:
    packet = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
    GPano:UsePanoramaViewer="True"
    GPano:ProjectionType="equirectangular"
    GPano:CroppedAreaImageWidthPixels="{width}"
    GPano:CroppedAreaImageHeightPixels="{height}"
    GPano:FullPanoWidthPixels="{width}"
    GPano:FullPanoHeightPixels="{height}"
    GPano:CroppedAreaLeftPixels="0"
    GPano:CroppedAreaTopPixels="0"
    GPano:PoseHeadingDegrees="0"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""
    return packet.encode("utf-8")


def save_jpeg_with_gpano(img: Image.Image, dest: Path, quality: int) -> None:
    """Write a JPEG with an XMP APP1 segment carrying the GPano tags."""
    buf = io.BytesIO()
    img.convert("RGB").save(
        buf, format="JPEG", quality=quality, subsampling=2, optimize=True
    )
    data = buf.getvalue()
    if data[:2] != b"\xff\xd8":
        raise RuntimeError("Pillow did not produce a JPEG")

    payload = b"http://ns.adobe.com/xap/1.0/\x00" + gpano_xmp(img.width, img.height)
    if len(payload) + 2 > 0xFFFF:
        raise RuntimeError("XMP packet too large for a single APP1 segment")
    segment = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data[:2] + segment + data[2:])


# --------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--slug", required=True, help="experience slug, e.g. d-day")
    p.add_argument("--prompt", required=True,
                   help="scene description in English; no need to mention 360 or equirectangular")
    p.add_argument("--width", type=int, default=2048)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--guidance", type=float, default=3.5)
    p.add_argument("--seed", type=int, default=None, help="default: random")
    p.add_argument("--lora-strength", type=float, default=1.0,
                   help="equirect LoRA weight, 0.5-1.5; higher forces the projection harder")
    p.add_argument("--seam-strip", type=int, default=256, help="px repainted over the wrap seam")
    p.add_argument("--seam-feather", type=int, default=64)
    p.add_argument("--seam-denoise", type=float, default=0.6)
    p.add_argument("--no-seam-fix", action="store_true")
    p.add_argument("--no-upscale", action="store_true")
    p.add_argument("--max-width", type=int, default=4096,
                   help="downsample the finished panorama to this width; 0 keeps the 8K upscale")
    p.add_argument("--quality", type=int, default=92, help="output JPEG quality")
    p.add_argument("--out", type=Path, default=None, help=f"default: {DEFAULT_OUT}/<slug>.jpg")
    args = p.parse_args()

    if args.width != args.height * 2:
        print(f"warning: {args.width}x{args.height} is not 2:1 -- equirect needs 2:1",
              file=sys.stderr)

    try:
        requests.get(f"{SERVER}/system_stats", timeout=5)
    except requests.RequestException:
        print(f"ComfyUI is not answering on {SERVER}.\n"
              f"Start it first:  cd pipeline/ComfyUI && venv\\Scripts\\python.exe main.py",
              file=sys.stderr)
        return 1

    seed = args.seed if args.seed is not None else random.randint(0, 2**32 - 1)
    prompt = args.prompt.strip().rstrip(".") + EQUIRECT_SUFFIX
    print(f"slug={args.slug}  seed={seed}  base={args.width}x{args.height}")

    # --- pass 1: base render -------------------------------------------------
    wf = load_workflow("01_txt2img.json")
    wf["2"]["inputs"]["text"] = prompt
    wf["3"]["inputs"]["guidance"] = args.guidance
    wf["6"]["inputs"].update(width=args.width, height=args.height)
    wf["7"]["inputs"].update(seed=seed, steps=args.steps)
    wf["20"]["inputs"].update(strength_model=args.lora_strength,
                              strength_clip=args.lora_strength)
    img = run(wf, "1/3 txt2img")

    # --- pass 2: seam fix ----------------------------------------------------
    if not args.no_seam_fix:
        shift = img.width // 2
        masked = add_seam_mask(roll(img, shift), args.seam_strip, args.seam_feather)
        name = upload(masked, f"tpvr_{args.slug}_rolled.png")

        wf = load_workflow("02_seamfix.json")
        wf["2"]["inputs"]["image"] = name
        wf["3"]["inputs"]["text"] = prompt
        wf["4"]["inputs"]["guidance"] = args.guidance
        wf["9"]["inputs"].update(seed=seed + 1, steps=args.steps, denoise=args.seam_denoise)
        wf["20"]["inputs"].update(strength_model=args.lora_strength,
                                  strength_clip=args.lora_strength)
        # Roll back by the same amount to restore the original orientation.
        img = roll(run(wf, "2/3 seam fix"), -shift)

    # --- pass 3: upscale -----------------------------------------------------
    if not args.no_upscale:
        name = upload(img, f"tpvr_{args.slug}_seamless.png")
        wf = load_workflow("03_upscale.json")
        wf["1"]["inputs"]["image"] = name
        img = run(wf, "3/3 upscale")

    if args.max_width and img.width > args.max_width:
        target = (args.max_width, round(img.height * args.max_width / img.width))
        img = img.resize(target, Image.LANCZOS)
        print(f"[resample] -> {img.width}x{img.height}")

    dest = args.out or (DEFAULT_OUT / f"{args.slug}.jpg")
    save_jpeg_with_gpano(img, dest, args.quality)
    print(f"\n{dest}  {img.width}x{img.height}  {dest.stat().st_size / 1e6:.1f} MB  (seed {seed})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
