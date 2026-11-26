from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))  # India has no DST


def today_ist() -> date:
    return datetime.now(timezone.utc).astimezone(IST).date()


def to_ist_date(value: date | datetime | None) -> date:
    """Convert a datetime (naive assumed UTC) or date to its IST calendar date."""
    if value is None:
        return today_ist()
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).date()
    return value
