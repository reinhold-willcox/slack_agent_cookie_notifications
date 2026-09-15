#!/usr/bin/env python3
"""Resolve next week's cookie duty from the SPAM group-meeting spreadsheet."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any

SHEET_ID = "1FOjEjX98ChrvnJA_f4oI8cce1NjN0sk_yNIQqwY74eo"
USER_AGENT = "Mozilla/5.0 (cookie-reminder/1.0)"
ROOT = Path(__file__).resolve().parents[1]
USERS_PATH = ROOT / "config" / "slack_users.json"
DATE_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$")
NAME_RE = re.compile(r"[A-Za-zÀ-ž]+")
SKIP_TOKENS = {
    "no",
    "none",
    "n",
    "na",
    "tbd",
    "cancelled",
    "canceled",
    "holiday",
    "christmas",
    "bloem",
}

COOKIE_REMINDER = (
    "Hi {first}, this is a reminder that you are on cookie duty for next "
    "week's group meeting on {meeting_date}. Thank you!"
)
DANIEL_REMINDER = (
    "Hi Daniel, next week's group meeting on {meeting_date} does not have "
    "anyone in the cookie column yet. Could you find someone to bring cookies?"
)


def academic_year_sheet_name(day: date) -> str:
    start_year = day.year if day.month >= 8 else day.year - 1
    return f"Academic year {start_year}-{start_year + 1}"


def next_iso_week_bounds(run_date: date) -> tuple[date, date]:
    monday_this_week = run_date - timedelta(days=run_date.weekday())
    monday_next = monday_this_week + timedelta(days=7)
    return monday_next, monday_next + timedelta(days=6)


def parse_sheet_date(value: str) -> date | None:
    match = DATE_RE.match(value.strip())
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def looks_like_person(value: str) -> bool:
    token = value.strip()
    if not token or token in {"/", "-", "—"}:
        return False
    if token.startswith(("🌸", "🎄", "⚔️", "🇧🇪", "🫂")):
        return False
    lowered = token.casefold()
    if lowered in SKIP_TOKENS:
        return False
    return bool(NAME_RE.search(token))


def extract_first_names(raw: str) -> list[str]:
    cleaned = re.split(r"[(\[]", raw, maxsplit=1)[0]
    parts = re.split(r"\s*(?:,|&|\+|and)\s*", cleaned, flags=re.IGNORECASE)
    names: list[str] = []
    for part in parts:
        match = NAME_RE.search(part)
        if match:
            names.append(match.group(0).casefold())
    return names


def fetch_sheet_csv(sheet_name: str) -> str:
    query = urllib.parse.urlencode({"tqx": "out:csv", "sheet": sheet_name})
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def load_users() -> dict[str, dict[str, Any]]:
    return json.loads(USERS_PATH.read_text(encoding="utf-8"))


def parse_rows(csv_text: str) -> list[dict[str, str]]:
    reader = csv.reader(io.StringIO(csv_text))
    header: list[str] | None = None
    rows: list[dict[str, str]] = []
    for raw in reader:
        cells = [cell.strip() for cell in raw]
        if header is None:
            if "Date" in cells and ("🎂" in cells or "Speaker" in cells):
                header = cells
            continue
        record = {header[i]: cells[i] if i < len(cells) else "" for i in range(len(header))}
        rows.append(record)
    if header is None:
        raise RuntimeError("Could not find the Date / 🎂 header row in the spreadsheet.")
    return rows


def meetings_in_range(rows: list[dict[str, str]], start: date, end: date) -> list[dict[str, Any]]:
    meetings: list[dict[str, Any]] = []
    for record in rows:
        meeting_date = parse_sheet_date(record.get("Date", ""))
        if meeting_date is None or meeting_date < start or meeting_date > end:
            continue
        meetings.append(
            {
                "date": meeting_date,
                "cookie_raw": record.get("🎂", "").strip(),
                "topic": record.get("Topic", "").strip(),
                "speaker": record.get("Speaker", "").strip(),
            }
        )
    meetings.sort(key=lambda item: item["date"])
    return meetings


def choose_weekly_meeting(meetings: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not meetings:
        return None
    tuesdays = [item for item in meetings if item["date"].weekday() == 1]
    return tuesdays[0] if tuesdays else meetings[0]


def resolve_people(raw: str, users: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if not looks_like_person(raw):
        return []
    resolved: list[dict[str, Any]] = []
    for first in extract_first_names(raw):
        profile = users.get(first, {})
        resolved.append(
            {
                "first": first,
                "full_name": profile.get("full_name") or first.title(),
                "slack_id": profile.get("slack_id"),
            }
        )
    return resolved


def format_day(day: date) -> str:
    return f"{day.strftime('%A')} {day.day} {day.strftime('%B %Y')}"


def build_plan(run_date: date, csv_text: str | None = None) -> dict[str, Any]:
    users = load_users()
    sheet_name = academic_year_sheet_name(run_date)
    week_start, week_end = next_iso_week_bounds(run_date)
    rows = parse_rows(csv_text if csv_text is not None else fetch_sheet_csv(sheet_name))
    meeting = choose_weekly_meeting(meetings_in_range(rows, week_start, week_end))
    daniel = users["daniel"]

    if meeting is None:
        return {
            "run_date": run_date.isoformat(),
            "sheet_name": sheet_name,
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "meeting_date": None,
            "cookie_raw": "",
            "status": "no_meeting_row",
            "people": [],
            "messages": [],
        }

    people = resolve_people(meeting["cookie_raw"], users)
    meeting_date_text = format_day(meeting["date"])
    messages: list[dict[str, str]] = []
    status = "assigned"

    if people:
        for person in people:
            channel = person["slack_id"] or "C01AMNHQ8EL"
            mention = f"<@{person['slack_id']}> " if person["slack_id"] else f"{person['full_name']} "
            text = COOKIE_REMINDER.format(first=person["first"].title(), meeting_date=meeting_date_text)
            if channel == "C01AMNHQ8EL":
                text = (
                    f"Hi {mention.strip()}, this is a reminder that you are on cookie duty "
                    f"for next week's group meeting on {meeting_date_text}. Thank you!"
                )
            messages.append({"channel": channel, "text": text, "reason": "cookie_duty"})
    else:
        status = "unassigned"
        messages.append(
            {
                "channel": daniel["slack_id"],
                "text": DANIEL_REMINDER.format(meeting_date=meeting_date_text),
                "reason": "empty_cookie_cell",
            }
        )

    return {
        "run_date": run_date.isoformat(),
        "sheet_name": sheet_name,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "meeting_date": meeting["date"].isoformat(),
        "cookie_raw": meeting["cookie_raw"],
        "topic": meeting["topic"],
        "speaker": meeting["speaker"],
        "status": status,
        "people": people,
        "messages": messages,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", help="Run as this YYYY-MM-DD date instead of today.")
    parser.add_argument("--csv", help="Optional local CSV snapshot for tests.")
    parser.add_argument("--json", action="store_true", help="Print the reminder plan as JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_date = date.fromisoformat(args.as_of) if args.as_of else date.today()
    csv_text = Path(args.csv).read_text(encoding="utf-8") if args.csv else None
    plan = build_plan(run_date, csv_text=csv_text)
    if args.json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    print(
        f"{plan['status']}: week {plan['week_start']} to {plan['week_end']} "
        f"meeting={plan.get('meeting_date')} cookies={plan.get('cookie_raw') or '(empty)'}"
    )
    for message in plan["messages"]:
        print(f"-> {message['channel']}: {message['text']}")


if __name__ == "__main__":
    main()
