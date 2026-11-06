#!/usr/bin/env python3
"""Thin the CC0 archives from the Movebank Data Repository into the memory layer.

Input: a folder with the *-gps.csv or *-gps*.csv.zip files and the
*-reference-data.csv files of the LifeTrack and MPIAB packages.

Output:
  data/birds.json          one entry per bird: name, ring, sex, born, site, study
  data/memory/MM-DD.json   for each calendar day, the birds with a fix on that
                           date in any year: position and a 30 day trail,
                           one point per day (the fix closest to noon UTC)

Usage: python3 tools/archive.py ARCHIVE_DIR [--out data]
"""

import argparse
import csv
import io
import json
import os
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta

TRAIL_DAYS = 30
STUDIES = {
    "LifeTrack White Stork SW Germany": "sw-germany",
    "LifeTrack White Stork Oberschwaben": "oberschwaben",
    "LifeTrack White Stork Bavaria": "bavaria",
    "LifeTrack White Stork Vorarlberg": "vorarlberg",
    "LifeTrack White Stork Rheinland-Pfalz": "rheinland-pfalz",
    "MPIAB Argos white stork tracking (1991-2017)": "mpiab-argos",
}


def parse_name(local_id):
    if "/" in local_id:
        head, tail = local_id.split("/", 1)
    else:
        parts = local_id.split(" ", 1)
        head, tail = parts[0], (parts[1] if len(parts) > 1 else "")
    head = head.strip()
    dead = "+" in local_id.split("(")[0]
    name = head.rstrip("+ ").strip()
    ring = tail.split("(")[0].replace("+", "").strip()
    return name, ring, dead


def open_rows(path):
    """Yield csv rows from a .csv or a .csv.zip, streaming."""
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                if not info.filename.endswith(".csv"):
                    continue
                with z.open(info) as raw:
                    yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""))
    else:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            yield from csv.DictReader(f)


def study_slug(study_name):
    for k, v in STUDIES.items():
        if study_name.startswith(k):
            return v
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    files = sorted(os.listdir(args.folder))
    gps_files = [f for f in files if "-gps" in f and (f.endswith(".csv") or f.endswith(".zip"))]
    ref_files = [f for f in files if f.endswith("-reference-data.csv")]

    # bird id -> {date -> (seconds from noon, lon, lat)}
    daily = defaultdict(dict)
    birds = {}

    for f in gps_files:
        print(f"reading {f}", file=sys.stderr)
        n = 0
        for row in open_rows(os.path.join(args.folder, f)):
            n += 1
            if n % 1000000 == 0:
                print(f"  {n // 1000000}M rows", file=sys.stderr)
            if row.get("visible") == "false" or row.get("manually-marked-outlier") == "true":
                continue
            lon, lat = row.get("location-long"), row.get("location-lat")
            if not lon or not lat:
                continue
            slug = study_slug(row.get("study-name", ""))
            if not slug:
                continue
            local = row["individual-local-identifier"]
            if not local:
                continue
            bid = slug + ":" + local
            ts = datetime.strptime(row["timestamp"][:19], "%Y-%m-%d %H:%M:%S")
            d = ts.date()
            off = abs((ts - ts.replace(hour=12, minute=0, second=0)).total_seconds())
            cur = daily[bid].get(d)
            if cur is None or off < cur[0]:
                daily[bid][d] = (off, round(float(lon), 4), round(float(lat), 4))
            if bid not in birds:
                name, ring, dead = parse_name(local)
                birds[bid] = {"id": bid, "study": slug, "name": name, "ring": ring, "dead": dead, "local": local}

    for f in ref_files:
        print(f"reference {f}", file=sys.stderr)
        for row in open_rows(os.path.join(args.folder, f)):
            local = row.get("animal-id", "")
            # The study name is not in the reference file: match by local id.
            for bid, b in birds.items():
                if b["local"] == local:
                    b["sex"] = row.get("animal-sex") or None
                    b["born"] = (row.get("animal-latest-date-born") or row.get("animal-exact-date-of-birth") or "")[:10] or None
                    b["site"] = row.get("study-site") or None
                    b["stage"] = row.get("animal-life-stage") or None
                    b["deploy_on"] = (row.get("deploy-on-date") or "")[:10] or None
                    b["deploy_off"] = (row.get("deploy-off-date") or "")[:10] or None
                    b["death_date"] = (row.get("animal-mortality-date") or "")[:10] or None
                    b["notes"] = row.get("animal-comments") or None
                    b["death_notes"] = row.get("animal-death-comments") or None

    # Per calendar day files.
    os.makedirs(os.path.join(args.out, "memory"), exist_ok=True)
    by_day = defaultdict(list)
    for bid, days in daily.items():
        first, last = min(days), max(days)
        birds[bid]["first"] = first.isoformat()
        birds[bid]["last"] = last.isoformat()
        birds[bid]["days"] = len(days)
        for d, (_, lon, lat) in days.items():
            trail = []
            for k in range(TRAIL_DAYS, 0, -1):
                p = days.get(d - timedelta(days=k))
                if p:
                    trail.append([round(p[1], 3), round(p[2], 3)])
            by_day[d.strftime("%m-%d")].append({"id": bid, "year": d.year, "pos": [lon, lat], "trail": trail})

    for key, entries in by_day.items():
        entries.sort(key=lambda e: (e["year"], e["id"]))
        with open(os.path.join(args.out, "memory", key + ".json"), "w") as f:
            json.dump(entries, f, separators=(",", ":"))

    for b in birds.values():
        b.pop("local", None)
    with open(os.path.join(args.out, "birds.json"), "w") as f:
        json.dump(sorted(birds.values(), key=lambda b: b["id"]), f, ensure_ascii=False, separators=(",", ":"))

    total = sum(len(v) for v in by_day.values())
    print(f"{len(birds)} birds, {total} bird-days, {len(by_day)} day files", file=sys.stderr)


if __name__ == "__main__":
    main()
