# New Laurentia Offline Map

A self-contained, personal-use map for **Way of the Hunter 2 — New Laurentia**.
It includes 3,606 locations, 39 marker icons, and the complete native raster tile
pyramid. Once downloaded, the map does not make network requests.

## Run it

From this directory:

```bash
.venv/bin/python serve.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

The map supports category filters, search, animal-specific eating/drinking/resting
need zones, herd descriptions and population tracking, Often/Rarely need-zone
visits, saved animal and need-zone relocation, infrastructure completion tracking,
animal-group and need-zone editing, custom personal pins, drag/keyboard navigation,
optional zoom locking, selected-animal or cursor-centered zooming, and zoom levels
3–7.
Personal map data and the last map view are stored in the browser's local storage.

## Offline assets

- `assets/tiles/` contains 1,344 PNG tiles (native zoom levels 3–5). Zoom levels
  6–7 use the highest-resolution tiles with browser over-zoom.
- `assets/icons/` contains the 39 icons referenced by this map.
- `data/map.json` contains the simplified category and pin dataset.
- `data/max-ages.json` contains the supplied per-species maximum ages and
  eating, drinking, and resting schedules.

To rebuild the data from a newly captured page payload:

```bash
.venv/bin/python scripts/extract_map_data.py /path/to/new-laurentia-rsc.txt data/map.json
.venv/bin/python scripts/download_assets.py --data data/map.json --root .
```

## Personal-use notice

Map imagery, marker artwork, and location data originate from
[Shackmaps](https://www.shackmaps.com/way-of-the-hunter-2/new-laurentia). This
local copy was created for personal use. Do not redistribute those assets without
permission from their respective rights holders.
