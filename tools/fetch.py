#!/usr/bin/env python3
"""Fetch the public white stork data from Movebank and write data/storks.json.

Anonymous only: the script never logs in, so it sees exactly what the public
sees. One request at a time, with a pause, to respect Movebank's rate limit.

Usage: python3 tools/fetch.py [--days 60] [--out data/storks.json]
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://www.movebank.org/movebank/service/public/json"
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
UA = "ciguenas.lessane.es fetch (anonymous, public data only)"
LIVE_DAYS = 30
PAUSE = 1.5
LANGS = ("es", "en")
SETTLEMENT = ("village", "town", "city", "municipality", "hamlet")
GEOCACHE = "tools/work/geocache.json"


def load_cache():
    try:
        with open(GEOCACHE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_cache(cache):
    import os
    os.makedirs("tools/work", exist_ok=True)
    with open(GEOCACHE, "w") as f:
        json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)


def place(lat, lon, cache):
    """Settlement, province and country in each language, or None when there
    is no settlement: contested boundaries and empty land get no label.
    Cached on a 0.01 degree grid, one Nominatim request per second."""
    key = f"{lat:.2f},{lon:.2f}"
    if key in cache:
        return cache[key]
    def ask(lang):
        params = {"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 10}
        if lang:
            params["accept-language"] = lang
        req = urllib.request.Request(NOMINATIM + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            a = json.load(r).get("address", {})
        time.sleep(1.1)
        return a

    try:
        # No accept-language: OSM's own name tag, the official local name
        # (Lleida, not Lérida). Only the country is translated.
        local = ask("")
        settlement = next((local[k] for k in SETTLEMENT if k in local), None)
        if not settlement:
            out = None
        else:
            region = local.get("province") or local.get("state") or local.get("county")
            out = {}
            for lang in LANGS:
                a = ask(lang)
                out[lang] = {"place": settlement, "region": region, "country": a.get("country"), "cc": a.get("country_code")}
    except Exception as e:
        print(f"  nominatim failed: {e}", file=sys.stderr)
        return None
    cache[key] = out
    save_cache(cache)
    return out


def get(params, tries=4):
    url = BASE + "?" + urllib.parse.urlencode(params)
    wait = 2
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            time.sleep(PAUSE)
            return data
        except Exception as e:  # network resets are common through proxies
            if attempt == tries - 1:
                raise
            print(f"  retry in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
            wait *= 2


def is_stork(name):
    n = name.lower()
    return "white stork" in n or "ciconia" in n


def parse_name(local_id):
    """'Louis / DER AU050 (eobs 3264)' -> ('Louis', 'DER AU050', False).
    A '+' after the name marks a bird reported dead in the LifeTrack studies."""
    if "/" in local_id:
        head, tail = local_id.split("/", 1)
    else:
        # Loburg style: 'Mose XA122 (3994)'
        parts = local_id.split(" ", 1)
        head, tail = parts[0], (parts[1] if len(parts) > 1 else "")
    head = head.strip()
    dead = "+" in local_id.split("(")[0]
    name = head.rstrip("+ ").strip()
    ring = tail.split("(")[0].replace("+", "").strip()
    return name, ring, dead


def ms(dt):
    return int(dt.timestamp() * 1000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60, help="track window for live birds")
    ap.add_argument("--out", default="data/storks.json")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    live_since = now - timedelta(days=LIVE_DAYS)
    track_since = now - timedelta(days=args.days)

    print("studies", file=sys.stderr)
    studies = [s for s in get({"entity_type": "study"}) if is_stork(s["name"])]
    out = {"generated": now.isoformat(timespec="seconds"), "studies": [], "birds": []}
    cache = load_cache()

    for s in sorted(studies, key=lambda s: s["id"]):
        sid = s["id"]
        print(f"study {sid} {s['name']}", file=sys.stderr)
        latest = get({"study_id": sid, "sensor_type": "gps", "max_events_per_individual": 1})
        inds = latest.get("individuals", [])
        count = 0
        for ind in inds:
            locs = ind.get("locations", [])
            if not locs:
                continue
            last = locs[-1]
            t = datetime.fromtimestamp(last["timestamp"] / 1000, timezone.utc)
            if t < live_since:
                continue
            name, ring, dead = parse_name(ind["individual_local_identifier"])
            print(f"  live: {name} ({ring}) last fix {t:%Y-%m-%d %H:%M}", file=sys.stderr)
            track = get({
                "study_id": sid,
                "individual_local_identifiers": ind["individual_local_identifier"],
                "sensor_type": "gps",
                "timestamp_start": ms(track_since),
                "timestamp_end": ms(now),
            })
            pts = []
            for i2 in track.get("individuals", []):
                for l in i2.get("locations", []):
                    pts.append([round(l["location_long"], 5), round(l["location_lat"], 5), l["timestamp"] // 1000])
            pts.sort(key=lambda p: p[2])
            out["birds"].append({
                "id": f"{sid}:{ind['individual_id']}",
                "study": sid,
                "name": name,
                "ring": ring,
                "dead": dead,
                "last": {"lon": round(last["location_long"], 5), "lat": round(last["location_lat"], 5), "t": last["timestamp"] // 1000},
                "where": place(last["location_lat"], last["location_long"], cache),
                "track": pts,
            })
            count += 1
        out["studies"].append({"id": sid, "name": s["name"], "individuals": len(inds), "live": count})

    with open(args.out, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {args.out}: {len(out['birds'])} live birds in {len(out['studies'])} studies", file=sys.stderr)


if __name__ == "__main__":
    main()
