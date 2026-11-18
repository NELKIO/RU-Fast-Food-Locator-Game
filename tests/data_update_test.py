import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("update_venues", Path(__file__).resolve().parents[1] / "scripts/update-venues.py")
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


def feature(ref, *, city="Москва", street="Тверская улица, 2", xy=(37.61, 55.75), country="RU", branch=""):
    return {
        "properties": {"ref": ref, "addr:city": city, "addr:street_address": street, "addr:country": country, "branch": branch},
        "geometry": {"type": "Point", "coordinates": list(xy)},
    }


def feed(spider, *rows):
    return {"type": "FeatureCollection", "dataset_attributes": {"@spider": spider}, "features": list(rows)}


class VenueUpdateTests(unittest.TestCase):
    def test_reference_survives_edits_and_country_scope_is_enforced(self):
        original = feed("dodo_pizza", feature("A16"), feature("B18", country="KZ"))
        [a] = catalog.normalize_feed("dodo", original)
        revised = feed("dodo_pizza", feature("a16", city="Казань", street="Кремлёвская улица, 2", xy=(49.11, 55.79)))
        [b] = catalog.normalize_feed("dodo", revised)
        self.assertEqual(a["id"], b["id"])
        self.assertEqual((b["lon"], b["lat"]), (49.11, 55.79))
        self.assertIn("Кремлёвская улица", b["address"])
        self.assertIn("Казань", b["address"])

    def test_non_public_invalid_and_ambiguous_destinations_are_excluded(self):
        rows = feed("dodo_pizza",
                    feature("1", branch="УЦ розницы"),
                    feature("2", branch="Тестовое подразделение"),
                    feature("3", xy=(0, 0)),
                    feature("4", street=""),
                    feature("5", street="Одна улица", xy=(37.64, 55.823260)),
                    feature("6", street="Другая улица", xy=(37.64, 55.823262)),
                    feature("7", xy=(37.61, 55.7)), feature("7", xy=(37.61, 55.7)))
        self.assertEqual([v["id"] for v in catalog.normalize_feed("dodo", rows)], ["dodo-7"])

    def test_feed_identity_and_conflicting_store_numbers_are_checked(self):
        with self.assertRaises(ValueError):
            catalog.normalize_feed("bk", feed("dodo_pizza", feature("1")))
        with self.assertRaises(ValueError):
            catalog.normalize_feed("bk", feed("burger_king_ru", feature("1"), feature("1", street="Другая улица")))

    def test_replacing_the_saved_id_space_is_rejected_even_if_counts_are_large(self):
        old = [{"brand": b, "id": f"{b}-old-{n}"} for b in catalog.BRANDS for n in range(800)]
        new = [{"brand": b, "id": f"{b}-new-{n}"} for b in catalog.BRANDS for n in range(800)]
        with self.assertRaises(ValueError):
            catalog.validate_coverage(new, old)

    def test_incomplete_refresh_leaves_previous_file_byte_identical(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            out = root / "venues.json"
            before = b'[{"brand":"bk","id":"bk-1"}]\n'
            out.write_bytes(before)
            for spider, _ in catalog.BRANDS.values():
                (root / f"{spider}.geojson").write_text(json.dumps(feed(spider, feature("1"))))
            with self.assertRaises(ValueError):
                catalog.rebuild(out, root)
            self.assertEqual(out.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
