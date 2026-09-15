# Slack cookie reminders

Friday morning job for the SPAM `#group-meeting` cookie roster.

The live roster is the 🎂 column on the current academic-year tab of
[SPAM group meeting - organization](https://docs.google.com/spreadsheets/d/1FOjEjX98ChrvnJA_f4oI8cce1NjN0sk_yNIQqwY74eo/edit?gid=2061008549#gid=2061008549).
Do not use the Speaker column; that is often blank and is not cookie duty.

## What runs on Friday

1. Fetch the spreadsheet (in case names were swapped).
2. Look at the **next calendar week** (the week after the Friday run).
3. Use the Tuesday group meeting if that week has more than one row.
4. Direct-message the person in 🎂, or Daniel Pauli if that cell is empty.

```bash
python3 scripts/cookie_reminder.py --as-of 2026-09-18 --json
python3 scripts/test_cookie_reminder.py
```

Name to Slack user ids live in `config/slack_users.json`. First names are treated as unique in this Slack workspace, with `Ema` kept distinct from `Emma`.
