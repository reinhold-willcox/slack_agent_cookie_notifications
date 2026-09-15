#!/usr/bin/env python3
from __future__ import annotations

import unittest
from datetime import date
from pathlib import Path

from cookie_reminder import (
    academic_year_sheet_name,
    build_plan,
    extract_first_names,
    next_iso_week_bounds,
)

CSV_PATH = Path("/tmp/sheet_by_name.csv")


class CookieReminderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.csv_text = CSV_PATH.read_text(encoding="utf-8")

    def test_next_week_from_friday(self) -> None:
        start, end = next_iso_week_bounds(date(2026, 9, 18))
        self.assertEqual(start, date(2026, 9, 21))
        self.assertEqual(end, date(2026, 9, 27))

    def test_academic_year_label(self) -> None:
        self.assertEqual(academic_year_sheet_name(date(2026, 9, 18)), "Academic year 2026-2027")
        self.assertEqual(academic_year_sheet_name(date(2027, 1, 8)), "Academic year 2026-2027")

    def test_extract_names(self) -> None:
        self.assertEqual(extract_first_names("Kunal + Jasmine"), ["kunal", "jasmine"])
        self.assertEqual(extract_first_names("Tinne (Annachiara forgot :( )"), ["tinne"])
        self.assertEqual(extract_first_names("Bethany?"), ["bethany"])
        self.assertEqual(extract_first_names("Gabriele & Emma"), ["gabriele", "emma"])

    def test_assigned_reinhold(self) -> None:
        plan = build_plan(date(2026, 9, 18), csv_text=self.csv_text)
        self.assertEqual(plan["status"], "assigned")
        self.assertEqual(plan["cookie_raw"], "Reinhold")
        self.assertEqual(plan["people"][0]["slack_id"], "U05Q1ED5NAU")
        self.assertEqual(plan["messages"][0]["channel"], "U05Q1ED5NAU")

    def test_assigned_ema_today_week(self) -> None:
        plan = build_plan(date(2026, 9, 11), csv_text=self.csv_text)
        self.assertEqual(plan["cookie_raw"], "Ema")
        self.assertEqual(plan["people"][0]["full_name"], "Ema Šipková")
        self.assertEqual(plan["messages"][0]["channel"], "C01AMNHQ8EL")

    def test_empty_cell_messages_daniel(self) -> None:
        plan = build_plan(date(2026, 10, 2), csv_text=self.csv_text)
        self.assertEqual(plan["status"], "unassigned")
        self.assertEqual(plan["meeting_date"], "2026-10-06")
        self.assertEqual(plan["messages"][0]["channel"], "U07PZ8YUCA3")
        self.assertIn("cookie column", plan["messages"][0]["text"])

    def test_prefers_tuesday_when_week_has_extra_meeting(self) -> None:
        plan = build_plan(date(2026, 8, 28), csv_text=self.csv_text)
        self.assertEqual(plan["meeting_date"], "2026-09-01")
        self.assertEqual(plan["cookie_raw"], "Kunal")


if __name__ == "__main__":
    unittest.main()
