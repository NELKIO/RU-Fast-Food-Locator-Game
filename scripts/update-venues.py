#!/usr/bin/env python3
"""Build the browser's restaurant directory from the four official locator extracts."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
from pathlib import Path
import re
import ssl
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://data.alltheplaces.xyz/runs/latest/output"
BRANDS = {
    "bk": ("burger_king_ru", "Бургер Кинг"),
    "vkusno": ("vkusno_i_tochka_ru", "Вкусно — и точка"),
    "rostics": ("rostics_ru", "Rostic’s"),
    "dodo": ("dodo_pizza", "Додо Пицца"),
}
# All four feeds contained over 900 Russian restaurants in the first full release.
MINIMUM_PER_BRAND = 650
MAX_SOURCE_BYTES = 16 * 1024 * 1024
NON_PUBLIC = re.compile(
    r"(?:\bтест(?:\b|ов)|\btest\b|\bучебн|\bуц\b|для съезда|"
    r"^мастер деливери$|^магнит$|^яндекс доставка$)", re.I,
)


def clean(value):
    return " ".join(str(value).split()) if value is not None else ""


def address_of(props):
    city = clean(props.get("addr:city"))
    address = clean(props.get("addr:street_address") or props.get("addr:full"))
    if not address:
        address = ", ".join(filter(None, [clean(props.get("addr:street")), clean(props.get("addr:housenumber"))]))
    if not address:
        return ""
    address = re.sub(r"^\d{6}\s*[,;]\s*", "", address)
    # Feeds alternate between a street and a complete postal address.
    if city and city.casefold() not in address.casefold():
        return f"{address}, {city}"
    return address


def normalize_feed(brand, feed):
    spider, name = BRANDS[brand]
    if feed.get("type") != "FeatureCollection" or feed.get("dataset_attributes", {}).get("@spider") != spider:
        raise ValueError(f"Unexpected feed for {brand}: expected {spider}")
    by_id = {}
    for feature in feed["features"]:
        props = feature["properties"]
        if props.get("addr:country") != "RU":
            continue
        if any(NON_PUBLIC.search(clean(props.get(key))) for key in ("name", "branch")):
            continue
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2:
            continue
        lon, lat = coords[:2]
        if any(type(v) not in (float, int) or not math.isfinite(v) for v in (lon, lat)):
            continue
        # A country tag alone does not catch a missing or swapped coordinate pair.
        if not (41 <= lat <= 82 and (19 <= lon <= 180 or -180 <= lon <= -168)):
            continue
        ref = clean(props.get("ref")).lower()
        address = address_of(props)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,54}", ref) or not address:
            continue
        key = f"{brand}-{ref}"
        venue = dict(id=key, brand=brand, name=name, address=address, lat=round(lat, 6), lon=round(lon, 6))
        if key in by_id and venue != by_id[key]:
            raise ValueError(f"Conflicting coordinates or address for {key}")
        by_id[key] = venue

    positions = defaultdict(list)
    for venue in by_id.values():
        positions[(round(venue["lat"], 5), round(venue["lon"], 5))].append(venue)
    unique = []
    for group in positions.values():
        # Conflicting addresses on the same metre-scale pin include training/delivery offices
        # and source errors. Neither address is a trustworthy physical destination.
        if len({venue["address"].casefold() for venue in group}) == 1:
            unique.append(min(group, key=lambda venue: venue["id"]))
    return sorted(unique, key=lambda venue: venue["id"])


def validate_coverage(venues, previous):
    counts = Counter(v["brand"] for v in venues)
    for brand in BRANDS:
        before = {v["id"] for v in previous if v["brand"] == brand}
        after = {v["id"] for v in venues if v["brand"] == brand}
        if counts[brand] < MINIMUM_PER_BRAND:
            raise ValueError(f"{brand}: incomplete nationwide feed ({counts[brand]} destinations)")
        if before and len(after & before) < 0.85 * len(before):
            raise ValueError(f"{brand}: over 15% of the saved restaurant IDs disappeared")


def load_feed(brand, source_dir):
    spider, _ = BRANDS[brand]
    filename = f"{spider}.geojson"
    if source_dir:
        return json.loads((source_dir / filename).read_bytes())
    request = Request(f"{SOURCE}/{filename}", headers={"User-Agent": "RU-Fast-Food-Locator-Game/1.0"})
    trust = ssl.create_default_context()
    system_roots = Path("/etc/ssl/cert.pem")
    if not trust.cert_store_stats()["x509_ca"] and system_roots.is_file():
        trust.load_verify_locations(cafile=str(system_roots))
    with urlopen(request, timeout=45, context=trust) as response:
        raw = response.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError(f"{spider}: response exceeded the expected size")
    return json.loads(raw)


def rebuild(output, source_dir=None):
    previous = json.loads(output.read_bytes()) if output.exists() else []
    with ThreadPoolExecutor(max_workers=len(BRANDS)) as workers:
        futures = {brand: workers.submit(load_feed, brand, source_dir) for brand in BRANDS}
        venues = [v for brand, future in futures.items() for v in normalize_feed(brand, future.result())]
    validate_coverage(venues, previous)
    output.parent.mkdir(parents=True, exist_ok=True)
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as temp:
            path = Path(temp.name)
            # A line per destination also makes changes reviewable in Git.
            rows = (json.dumps(v, ensure_ascii=False, separators=(",", ":")) for v in venues)
            temp.write("[\n  " + ",\n  ".join(rows) + "\n]\n")
        path.chmod(0o644)
        os.replace(path, output)
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
    return Counter(v["brand"] for v in venues)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/venues.json")
    parser.add_argument("--source-dir", type=Path, help="Read saved All The Places GeoJSON extracts from this directory.")
    args = parser.parse_args()
    for brand, count in rebuild(args.output, args.source_dir).items():
        print(f"{brand}: {count}")
