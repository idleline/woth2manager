#!/usr/bin/env python3
"""Extract the public New Laurentia map payload embedded in the Shackmaps page."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


SOURCE_URL = "https://www.shackmaps.com/way-of-the-hunter-2/new-laurentia"
PARENT_REFERENCE = re.compile(r"^\$5:1:props:pins:(\d+):parentPin$")


def nullish(value):
    return None if value == "$undefined" else value


def plain_text(value):
    value = nullish(value)
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        parts = [plain_text(item) for item in value]
    elif isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"].strip() or None
        parts = [plain_text(item) for item in value.get("children", [])]
    else:
        return None
    text = "\n".join(part for part in parts if part)
    return text or None


def load_props(source: Path) -> dict:
    text = source.read_text(encoding="utf-8")
    start = text.index("push(") + len("push(")
    outer = json.loads(text[start : text.rindex(")")])
    payload = json.loads(outer[1].split(":", 1)[1])
    return payload[1][3]


def simplify(props: dict) -> dict:
    map_info = props["map"]
    groups = props["groups"]
    pins = props["pins"]
    icons = props["icons"]

    referenced_icons = {
        value
        for value in [
            *(group.get("icon") for group in groups),
            *(pin.get("iconOverride") for pin in pins),
        ]
        if isinstance(value, int)
    }

    for item in props.get("game", {}).get("userPinAllowedIcons", []):
        if isinstance(item, int):
            referenced_icons.add(item)
        elif isinstance(item, dict) and isinstance(item.get("id"), int):
            referenced_icons.add(item["id"])

    icon_by_id = {icon["id"]: icon for icon in icons}
    selected_icons = []
    for icon_id in sorted(referenced_icons):
        icon = icon_by_id.get(icon_id)
        if not icon:
            continue
        selected_icons.append(
            {
                "id": icon_id,
                "filename": icon["filename"],
                "url": icon["url"],
                "width": icon.get("width"),
                "height": icon.get("height"),
            }
        )

    pin_counts = Counter(pin["group"] for pin in pins)
    simplified_groups = [
        {
            "id": group["id"],
            "title": group["title"],
            "slug": group["slug"],
            "parentGroup": group.get("parentGroup"),
            "icon": group.get("icon"),
            "color": group.get("color"),
            "count": pin_counts[group["id"]],
        }
        for group in groups
    ]

    def parent_pin_id(value, seen=None):
        if isinstance(value, dict):
            return value.get("id")
        if not isinstance(value, str):
            return None
        match = PARENT_REFERENCE.match(value)
        if not match:
            return None
        index = int(match.group(1))
        seen = seen or set()
        if index in seen or index >= len(pins):
            return None
        return parent_pin_id(pins[index].get("parentPin"), seen | {index})

    simplified_pins = []
    for pin in pins:
        parent = pin.get("parentPin")
        simplified_pins.append(
            {
                "id": pin["id"],
                "group": pin["group"],
                "title": pin.get("title") or "Untitled pin",
                "description": plain_text(pin.get("description")),
                "slug": nullish(pin.get("slug")),
                "location": pin["location"],
                "iconOverride": nullish(pin.get("iconOverride")),
                "colorOverride": nullish(pin.get("colorOverride")),
                "parentPin": parent_pin_id(parent),
                "type": pin.get("type", "pin"),
                "guideLink": nullish(pin.get("guideLink")),
                "youtubeUrl": nullish(pin.get("youtubeUrl")),
            }
        )

    config = dict(map_info["config"])
    config["minZoom"] = 3
    config["nativeMaxZoom"] = 5

    return {
        "source": {
            "url": SOURCE_URL,
            "mapUpdatedAt": map_info.get("updatedAt"),
            "usage": "Downloaded for personal, local use.",
        },
        "map": {
            "title": map_info["title"],
            "slug": map_info["slug"],
            "config": config,
        },
        "groups": simplified_groups,
        "icons": selected_icons,
        "pins": simplified_pins,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = simplify(load_props(args.source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Wrote {args.output}: {len(data['pins'])} pins, "
        f"{len(data['groups'])} groups, {len(data['icons'])} icons"
    )


if __name__ == "__main__":
    main()
