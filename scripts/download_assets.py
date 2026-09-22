#!/usr/bin/env python3
"""Download the New Laurentia tile pyramid and referenced icons for offline use."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


TILE_BASE = (
    "https://shackmaps-prod-media.s3.us-east-2.amazonaws.com/tiles/"
    "way-of-the-hunter-2/new-laurentia"
)
USER_AGENT = "Mozilla/5.0 (compatible; NewLaurentiaOffline/1.0; personal-use)"


def download(url: str, destination: Path, retries: int = 4) -> tuple[Path, str]:
    if destination.exists() and destination.stat().st_size:
        return destination, "cached"
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=45) as response, partial.open("wb") as out:
                shutil.copyfileobj(response, out)
            os.replace(partial, destination)
            return destination, "downloaded"
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            partial.unlink(missing_ok=True)
            if attempt == retries - 1:
                return destination, f"failed: {error}"
            time.sleep(0.5 * (2**attempt))
    return destination, "failed"


def build_jobs(data: dict, root: Path) -> list[tuple[str, Path]]:
    jobs = []
    min_zoom = data["map"]["config"].get("minZoom", 3)
    native_max = data["map"]["config"].get("nativeMaxZoom", 5)
    for zoom in range(min_zoom, native_max + 1):
        dimension = 2**zoom
        for x in range(dimension):
            for y in range(dimension):
                jobs.append(
                    (
                        f"{TILE_BASE}/{zoom}/{x}/{y}.png",
                        root / "assets" / "tiles" / str(zoom) / str(x) / f"{y}.png",
                    )
                )
    for icon in data["icons"]:
        jobs.append(
            (
                icon["url"],
                root / "assets" / "icons" / icon["filename"],
            )
        )
    return jobs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/map.json"))
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    data = json.loads(args.data.read_text(encoding="utf-8"))
    jobs = build_jobs(data, args.root)
    counts = {"cached": 0, "downloaded": 0, "failed": 0}
    failures = []

    print(f"Fetching {len(jobs)} assets with {args.workers} workers…")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(download, url, path): (url, path) for url, path in jobs}
        for index, future in enumerate(as_completed(futures), 1):
            url, path = futures[future]
            _, status = future.result()
            key = status if status in counts else "failed"
            counts[key] += 1
            if key == "failed":
                failures.append((url, path, status))
            if index % 100 == 0 or index == len(jobs):
                print(
                    f"{index}/{len(jobs)} — {counts['downloaded']} downloaded, "
                    f"{counts['cached']} cached, {counts['failed']} failed",
                    flush=True,
                )

    if failures:
        for url, path, status in failures[:20]:
            print(f"ERROR {path}: {status} ({url})", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
