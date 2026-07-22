"""Download the model weights needed by the TimePortalVR panorama pipeline.

Everything here is ungated: no HuggingFace login, no license acceptance.

  flux1-dev-fp8.safetensors   17.3 GB  -> models/checkpoints/
      All-in-one FLUX.1-dev repack (transformer + clip_l + t5xxl + VAE) in fp8.
      Chosen over the fp16 split weights because fp16 needs ~34 GB and the
      RX 7900 XTX has 25.8 GB -- fp16 would offload to system RAM every step.

  RealESRGAN_x4plus.pth       0.07 GB  -> models/upscale_models/
      4x upscaler, turns the 2048x1024 base render into 8192x4096.

Usage:
    venv\\Scripts\\python.exe ..\\download_models.py
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
from pathlib import Path

COMFY = Path(__file__).parent / "ComfyUI"

HF_FILES = [
    ("Comfy-Org/flux1-dev", "flux1-dev-fp8.safetensors", "checkpoints"),
]

URL_FILES = [
    (
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "upscale_models",
        "RealESRGAN_x4plus.pth",
    ),
]


def download_hf(repo: str, filename: str, subdir: str) -> None:
    from huggingface_hub import hf_hub_download

    dest_dir = COMFY / "models" / subdir
    dest = dest_dir / Path(filename).name
    if dest.exists():
        print(f"[skip] {dest.name} already present ({dest.stat().st_size / 1e9:.2f} GB)")
        return

    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"[get ] {repo}/{filename}")
    # Downloads into the HF cache first (resumable), then copies into place.
    cached = hf_hub_download(repo_id=repo, filename=filename, token=False)
    shutil.copy2(cached, dest)
    print(f"[done] {dest} ({dest.stat().st_size / 1e9:.2f} GB)")


def download_url(url: str, subdir: str, name: str) -> None:
    dest_dir = COMFY / "models" / subdir
    dest = dest_dir / name
    if dest.exists():
        print(f"[skip] {name} already present")
        return

    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"[get ] {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.rename(dest)
    print(f"[done] {dest} ({dest.stat().st_size / 1e6:.0f} MB)")


def main() -> int:
    if not COMFY.is_dir():
        print(f"ComfyUI not found at {COMFY}", file=sys.stderr)
        return 1

    for repo, filename, subdir in HF_FILES:
        download_hf(repo, filename, subdir)
    for url, subdir, name in URL_FILES:
        download_url(url, subdir, name)

    print("\nAll weights in place. Start ComfyUI, then run generate_panorama.py.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
