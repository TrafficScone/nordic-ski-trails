"""Offline tests for sync_osm.py's geometry and naming.

    python3 tools/test_sync_osm.py
"""

import unittest

from sync_osm import clip_way, describe, in_polygon, name_key, stitch

SQUARE = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]


def way(nodes, coords=None):
    return {"nodes": nodes, "coords": coords or [[n, n] for n in nodes]}


class Stitch(unittest.TestCase):
    def test_joins_ways_in_any_order_and_direction(self):
        lines = stitch([way([3, 4]), way([1, 2]), way([3, 2])])  # last one reversed
        self.assertEqual(len(lines), 1)
        self.assertEqual([c[0] for c in lines[0]], [1, 2, 3, 4])

    def test_gap_gives_separate_lines(self):
        self.assertEqual(len(stitch([way([1, 2]), way([5, 6])])), 2)


class Clip(unittest.TestCase):
    def test_point_in_polygon(self):
        self.assertTrue(in_polygon([5, 5], SQUARE))
        self.assertFalse(in_polygon([15, 5], SQUARE))

    def test_way_leaving_and_reentering_splits(self):
        w = way([1, 2, 3, 4, 5], [[1, 1], [5, 5], [20, 5], [6, 6], [7, 7]])
        pieces = clip_way(w, [SQUARE])
        self.assertEqual([p["nodes"] for p in pieces], [[1, 2], [4, 5]])

    def test_way_outside_is_dropped(self):
        self.assertEqual(clip_way(way([1, 2], [[20, 20], [30, 30]]), [SQUARE]), [])


class Naming(unittest.TestCase):
    def test_apostrophes_and_case_match(self):
        self.assertEqual(name_key("Devils Thumb Trail"), name_key("Devil's Thumb  trail"))

    def test_grooming(self):
        self.assertEqual(describe({"piste:grooming": "classic+skating"}), "Groomed: classic and skate")
        self.assertEqual(describe({"piste:grooming": "classic;skating"}), "Groomed: classic and skate")
        self.assertEqual(describe({"piste:grooming": "backcountry"}), "Not groomed")


if __name__ == "__main__":
    unittest.main()
