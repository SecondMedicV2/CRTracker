from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))  # India has no DST


def today_ist() -> date:
    return datetime.now(timezone.utc).astimezone(IST).date()
