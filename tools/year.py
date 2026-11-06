#!/usr/bin/env python3
"""Build data/year.json, the animated year, from the data/memory day files.

Every bird-year in the archive becomes one track on a single calendar year:
day index 0 (1 January) to 365, one position per day where the bird had a
fix, two decimals (about 1 km), enough for a comet on a continent-wide map.

Usage: python3 tools/year.py [--data data]
"""

import argparse
import json
import os
from collections import defaultdict
from datetime import date


def day_index(mmdd):
    m, d = int(mmdd[:2]), int(mmdd[3:])
    return (date(2024, m, d) - date(2024, 1, 1)).days  # 2024 is a leap year: 366 slots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    args = ap.parse_args()

    folder = os.path.join(args.data, "memory")
    tracks = defaultdict(dict)  # (id, year) -> {day: (lon, lat)}
    for f in sorted(os.listdir(folder)):
        if not f.endswith(".json"):
            continue
        idx = day_index(f[:5])
        with open(os.path.join(folder, f)) as fh:
            for e in json.load(fh):
                tracks[(e["id"], e["year"])][idx] = (round(e["pos"][0], 2), round(e["pos"][1], 2))

    birds = sorted({k[0] for k in tracks})
    bird_index = {b: i for i, b in enumerate(birds)}
    out = {"birds": birds, "tracks": []}
    for (bid, year), days in sorted(tracks.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if len(days) < 7:
            continue
        first, last = min(days), max(days)
        # Dense slot list from first to last day; null where no fix that day.
        p = []
        for d in range(first, last + 1):
            pt = days.get(d)
            p.append([pt[0], pt[1]] if pt else None)
        out["tracks"].append({"b": bird_index[bid], "y": year, "s": first, "p": p})

    path = os.path.join(args.data, "year.json")
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"{len(out['tracks'])} tracks, {len(birds)} birds, {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
